/* youtube-upcoming.js
   Widget for upcoming (scheduled) YouTube live streams.
   Includes stale-event filtering, CTA fallback, and robust thumbnail fallback.
*/

(() => {
  const mount = document.getElementById('youtube-upcoming');
  if (!mount) return;

  const API_KEY = mount.getAttribute('data-api-key');
  const CHANNEL_ID = mount.getAttribute('data-channel-id');
  const MAX_RESULTS = Math.min(parseInt(mount.getAttribute('data-max-results') || '12', 10), 50);
  const OPEN_IN = (mount.getAttribute('data-open-in') || 'modal').toLowerCase();
  const TZ = mount.getAttribute('data-timezone') || undefined;
  const CHANNEL_HANDLE = mount.getAttribute('data-channel-handle') || null;
  const HIDE_PAST_HOURS = Math.max(0, parseInt(mount.getAttribute('data-hide-past-hours') || '6', 10));

  if (!API_KEY || !CHANNEL_ID) {
    mount.innerHTML = `<div class="yt-error">Missing data-api-key or data-channel-id.</div>`;
    return;
  }

  mount.classList.add('yt-grid-wrap');
  mount.innerHTML = `
    <h2 class="yt-grid-title">Upcoming Live Streams</h2>
    <div class="yt-grid" role="list" aria-label="Upcoming live streams"></div>
    <div class="yt-status" aria-live="polite"></div>
  `;
  const grid = mount.querySelector('.yt-grid');
  const status = mount.querySelector('.yt-status');

  const modal = document.getElementById('ytModal');
  const player = document.getElementById('ytPlayer');
  const closeBtn = modal ? modal.querySelector('.close') : null;

  const openVideo = (videoId) => {
    const url = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    if (OPEN_IN === 'newtab' || !modal || !player) {
      window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank', 'noopener');
      return;
    }
    player.setAttribute('src', url);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeModal = () => {
    if (!modal || !player) return;
    player.setAttribute('src', '');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  };

  closeBtn && closeBtn.addEventListener('click', closeModal);
  modal && modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal(); });

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, s => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]
  ));
  const bestThumb = (item) => {
    const t = item?.snippet?.thumbnails || {};
    const pick = (t.maxres || t.standard || t.high || t.medium || t.default || {}).url;
    // If API doesn't return a thumbnail (rare for scheduled placeholders), fall back to i.ytimg.com
    return pick || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
  };
  const toLocalTime = (iso) => {
    try {
      const d = new Date(iso);
      const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
      return TZ ? d.toLocaleString([], {...opts, timeZone: TZ}) : d.toLocaleString([], opts);
    } catch { return iso; }
  };

  const CACHE_KEY = `yt_upcoming_${CHANNEL_ID}`;
  const CACHE_MS = 5 * 60 * 1000;

  const readCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_MS) return null;
      return data;
    } catch { return null; }
  };
  const writeCache = (data) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
  };

  const renderGrid = (videos) => {
    grid.innerHTML = '';
    if (!videos.length) {
      const liveUrl = CHANNEL_HANDLE
        ? `https://www.youtube.com/${CHANNEL_HANDLE}/live`
        : `https://www.youtube.com/channel/${CHANNEL_ID}/live`;

      grid.innerHTML = `
        <div class="yt-cta">
          <h3>No upcoming live streams are scheduled</h3>
          <p>We stream live every Sunday at 9:30 AM and 10:30 AM (ET). Visit our live page for past services and subscribe for updates.</p>
          <div class="cta-buttons">
            <a class="btn primary" href="${liveUrl}" target="_blank" rel="noopener">Go to VUMC Live</a>
            <a class="btn" href="https://www.youtube.com/${CHANNEL_HANDLE ? CHANNEL_HANDLE : 'channel/' + CHANNEL_ID}?sub_confirmation=1" target="_blank" rel="noopener">Subscribe on YouTube</a>
          </div>
        </div>
      `;
      return;
    }
    for (const v of videos) {
      const card = document.createElement('article');
      card.className = 'yt-card';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="yt-thumb-wrap">
          <img class="yt-thumb" src="${bestThumb(v.raw)}" alt="${escapeHtml(v.title)} thumbnail" loading="lazy" />
          <span class="yt-badge">Live Soon</span>
        </div>
        <div class="yt-meta">
          <h3 class="yt-title">${escapeHtml(v.title)}</h3>
          <p class="yt-time">${v.scheduled ? 'Starts: ' + escapeHtml(toLocalTime(v.scheduled)) : 'Scheduled time TBA'}</p>
        </div>
        <button class="yt-play" aria-label="Open ${escapeHtml(v.title)}">Watch</button>
      `;
      const open = () => openVideo(v.id);
      card.querySelector('.yt-thumb-wrap')?.addEventListener('click', open);
      card.querySelector('.yt-title')?.addEventListener('click', open);
      card.querySelector('.yt-play')?.addEventListener('click', open);
      grid.appendChild(card);
    }
  };

  const loadFromCache = () => {
    const cached = readCache();
    if (cached) {
      renderGrid(cached);
      status.textContent = 'Loaded from cache.';
      return true;
    }
    return false;
  };

  const fetchUpcoming = async () => {
    status.textContent = 'Loading upcoming streams…';
    try {
      const searchURL = new URL('https://www.googleapis.com/youtube/v3/search');
      searchURL.searchParams.set('key', API_KEY);
      searchURL.searchParams.set('channelId', CHANNEL_ID);
      searchURL.searchParams.set('part', 'snippet');
      searchURL.searchParams.set('type', 'video');
      searchURL.searchParams.set('eventType', 'upcoming');
      searchURL.searchParams.set('order', 'date');
      searchURL.searchParams.set('maxResults', MAX_RESULTS);

      const searchRes = await fetch(searchURL.toString());
      if (!searchRes.ok) throw new Error(`YouTube API (search) ${searchRes.status}`);
      const searchData = await searchRes.json();
      const ids = (searchData.items || []).map(i => i.id?.videoId).filter(Boolean);
      if (!ids.length) {
        renderGrid([]);
        status.textContent = 'No upcoming live streams scheduled.';
        writeCache([]);
        return;
      }

      const videosURL = new URL('https://www.googleapis.com/youtube/v3/videos');
      videosURL.searchParams.set('key', API_KEY);
      videosURL.searchParams.set('id', ids.join(','));
      videosURL.searchParams.set('part', 'snippet,liveStreamingDetails');

      const videosRes = await fetch(videosURL.toString());
      if (!videosRes.ok) throw new Error(`YouTube API (videos) ${videosRes.status}`);
      const videosData = await videosRes.json();

      const now = Date.now();
      const hidePastMs = HIDE_PAST_HOURS * 60 * 60 * 1000;

      const detailed = (videosData.items || []).map(v => {
        const lsd = v?.liveStreamingDetails || {};
        return {
          id: v.id,
          title: v?.snippet?.title || 'Untitled',
          scheduled: lsd?.scheduledStartTime || null,
          actualStart: lsd?.actualStartTime || null,
          actualEnd: lsd?.actualEndTime || null,
          raw: v // keep raw item for robust thumbnail fallback
        };
      })
      .filter(ev => {
        if (ev.actualEnd) return false;
        if (ev.scheduled) {
          const schedMs = new Date(ev.scheduled).getTime();
          if (!ev.actualStart && (schedMs + hidePastMs) < now) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ta = a.scheduled ? new Date(a.scheduled).getTime() : Infinity;
        const tb = b.scheduled ? new Date(b.scheduled).getTime() : Infinity;
        return ta - tb;
      });

      renderGrid(detailed);
      writeCache(detailed);
      status.textContent = '';
    } catch (err) {
      console.error(err);
      status.textContent = 'Error loading streams.';
      grid.innerHTML = `<div class="yt-error">Problem fetching data. Please try again later.</div>`;
    }
  };

  const hadCache = loadFromCache();
  fetchUpcoming().then(() => { if (hadCache) status.textContent = ''; });
})();
