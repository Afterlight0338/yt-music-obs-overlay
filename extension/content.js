/**
 * YouTube & YouTube Music OBS Broadcaster - Content Script
 * Captures live playback metadata and sends it to the extension background service worker
 */
(function () {
  console.log('[YT-OBS] Overlay broadcaster initialized on:', window.location.hostname);

  const CHANNEL_ID = 'yt-overlay';
  let theme = 'default';
  let accent = '#ff0055';
  let autohide = true;
  let upcomingCount = 3;
  let isWorkerConnected = false;
  let lastTrackData = null;

  // Cached metadata from injected MAIN world script (navigator.mediaSession)
  let cachedMediaSession = null;

  window.addEventListener('__yt_obs_media_update', (e) => {
    if (e.detail) {
      cachedMediaSession = e.detail;
      sendTrackInfo(true);
    }
  });

  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['theme', 'accent', 'autohide', 'upcomingCount'], (res) => {
        if (res) {
          if (res.theme) theme = res.theme;
          if (res.accent) accent = res.accent;
          if (res.autohide !== undefined) autohide = res.autohide;
          if (res.upcomingCount !== undefined) upcomingCount = parseInt(res.upcomingCount, 10);
        }
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (changes.theme) theme = changes.theme.newValue || 'default';
        if (changes.accent) accent = changes.accent.newValue || '#ff0055';
        if (changes.autohide !== undefined) autohide = changes.autohide.newValue;
        if (changes.upcomingCount !== undefined) upcomingCount = parseInt(changes.upcomingCount.newValue, 10);

        updateBadge();
        sendTrackInfo(true);
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'force_update') {
        if (msg.theme) theme = msg.theme;
        if (msg.accent) accent = msg.accent;
        if (msg.autohide !== undefined) autohide = msg.autohide;
        if (msg.upcomingCount !== undefined) upcomingCount = parseInt(msg.upcomingCount, 10);
        sendTrackInfo(true);
        sendResponse({ success: true });
      }
    });
  }

  function updateBadge() {
    let badge = document.getElementById('yt-obs-status-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-obs-status-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: rgba(18, 18, 24, 0.92);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        padding: 6px 12px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
        z-index: 9999999;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        cursor: pointer;
        user-select: none;
        transition: transform 0.2s ease;
      `;
      badge.onmouseover = () => { badge.style.transform = 'scale(1.05)'; };
      badge.onmouseout = () => { badge.style.transform = 'scale(1)'; };
      badge.onclick = () => {
        const title = lastTrackData?.title || '(None detected yet)';
        const artist = lastTrackData?.artist || '(None)';
        const isYTM = window.location.hostname.includes('music.youtube.com');
        alert(`📡 OBS Overlay Broadcaster\n\n` +
              `Status: ${isWorkerConnected ? '🟢 Connected to Cloud Broker' : '🟡 Connecting to Cloud Broker...'}\n` +
              `Platform: ${isYTM ? 'YouTube Music' : 'YouTube'} (Auto-detected)\n` +
              `Current Song: ${title}\n` +
              `Artist: ${artist}\n` +
              `Channel: ${CHANNEL_ID} (Universal)`);
      };
      document.body.appendChild(badge);
    }

    const isYTM = window.location.hostname.includes('music.youtube.com');
    badge.innerHTML = `
      <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isWorkerConnected ? '#10b981' : '#f59e0b'}; display: inline-block;"></span>
      <span>${isYTM ? 'YT Music' : 'YouTube'}</span>
    `;
  }

  function getUpcomingTracks(maxCount) {
    if (maxCount <= 0) return [];
    const upcoming = [];
    const isYTM = window.location.hostname.includes('music.youtube.com');

    if (isYTM) {
      const queueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
      if (queueItems.length > 0) {
        let activeIdx = queueItems.findIndex(el =>
          el.hasAttribute('selected') ||
          el.getAttribute('play-button-state') === 'playing' ||
          el.getAttribute('play-button-state') === 'paused'
        );
        if (activeIdx !== -1) {
          const nextSlice = queueItems.slice(activeIdx + 1, activeIdx + 1 + maxCount);
          nextSlice.forEach(item => {
            const t = item.querySelector('.song-title')?.textContent?.trim() || item.querySelector('.title')?.textContent?.trim() || '';
            const a = item.querySelector('.byline')?.textContent?.trim() || '';
            const img = item.querySelector('img')?.src || '';
            if (t) upcoming.push({ title: t, artist: a, artwork: img });
          });
        }
      }
    } else {
      const panelItems = Array.from(document.querySelectorAll('ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'));
      if (panelItems.length > 0) {
        let activeIdx = panelItems.findIndex(el => el.hasAttribute('selected') || el.classList.contains('selected') || el.querySelector('.selected'));
        if (activeIdx !== -1) {
          const nextSlice = panelItems.slice(activeIdx + 1, activeIdx + 1 + maxCount);
          nextSlice.forEach(item => {
            const t = item.querySelector('#video-title')?.textContent?.trim() || '';
            const a = item.querySelector('#byline')?.textContent?.trim() || item.querySelector('#channel-name')?.textContent?.trim() || '';
            const img = item.querySelector('img')?.src || '';
            if (t) upcoming.push({ title: t, artist: a, artwork: img });
          });
        }
      }
    }

    return upcoming;
  }

  function getTrackData() {
    const isYTM = window.location.hostname.includes('music.youtube.com');
    const video = document.querySelector('video.html5-main-video') ||
                  document.querySelector('#movie_player video') ||
                  document.querySelector('.html5-video-player video') ||
                  document.querySelector('video');

    let title = '';
    let artist = '';
    let album = '';
    let artwork = '';

    if (isYTM) {
      // 1. Check title from mediaSession or DOM elements
      const titleEl = document.querySelector('ytmusic-player-bar .title') ||
                      document.querySelector('ytmusic-player-bar yt-formatted-string.title') ||
                      document.querySelector('ytmusic-player-bar [title]');

      title = (titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '') ||
              (cachedMediaSession?.title || '');

      // 2. Check artist from mediaSession or DOM elements
      const bylineEl = document.querySelector('ytmusic-player-bar .byline') ||
                       document.querySelector('ytmusic-player-bar yt-formatted-string.byline') ||
                       document.querySelector('ytmusic-player-bar .subtitle yt-formatted-string');

      if (bylineEl) {
        const link = bylineEl.querySelector('a');
        artist = link ? link.textContent.trim() : bylineEl.textContent.trim();
        // Remove trailing album/views info if in single string: e.g. "Artist • Album • 2024"
        if (artist.includes(' • ')) {
          artist = artist.split(' • ')[0].trim();
        }
      }
      if (!artist && cachedMediaSession?.artist) {
        artist = cachedMediaSession.artist;
      }

      album = cachedMediaSession?.album || 'YouTube Music';

      // 3. Artwork from mediaSession or DOM thumbnail
      const imgEl = document.querySelector('ytmusic-player-bar yt-img-shadow img') ||
                    document.querySelector('ytmusic-player-bar .image img') ||
                    document.querySelector('ytmusic-player-bar img#img') ||
                    document.querySelector('#song-image img');

      if (cachedMediaSession?.artwork) {
        artwork = cachedMediaSession.artwork;
      } else if (imgEl && imgEl.src && !imgEl.src.startsWith('data:')) {
        artwork = imgEl.src;
      }
    } else {
      // YouTube video mode
      const ytTitleEl = document.querySelector('ytd-watch-metadata #title h1 yt-formatted-string') ||
                        document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                        document.querySelector('ytd-watch-metadata h1') ||
                        document.querySelector('#title h1 yt-formatted-string') ||
                        document.querySelector('h1.title.style-scope.ytd-video-primary-info-renderer yt-formatted-string') ||
                        document.querySelector('#container h1.ytd-watch-metadata');

      const ytChannelEl = document.querySelector('ytd-watch-metadata #channel-name #text a') ||
                          document.querySelector('ytd-watch-metadata ytd-channel-name yt-formatted-string a') ||
                          document.querySelector('#owner #channel-name a') ||
                          document.querySelector('#upload-info #channel-name a') ||
                          document.querySelector('ytd-video-owner-renderer #channel-name a');

      title = ytTitleEl ? ytTitleEl.textContent.trim() : (cachedMediaSession?.title || '');
      if (!title) {
        const docTitle = document.title || '';
        title = docTitle.replace(' - YouTube', '').replace(/^\(\d+\)\s*/, '').trim();
      }

      artist = ytChannelEl ? ytChannelEl.textContent.trim() : (cachedMediaSession?.artist || 'YouTube');
      album = 'YouTube';

      const vParam = new URLSearchParams(window.location.search).get('v');
      if (vParam) {
        artwork = `https://i.ytimg.com/vi/${vParam}/hqdefault.jpg`;
      } else if (window.location.pathname.includes('/shorts/')) {
        const shortId = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
        if (shortId) {
          artwork = `https://i.ytimg.com/vi/${shortId}/hqdefault.jpg`;
        }
      }

      if (!artwork && cachedMediaSession?.artwork) {
        artwork = cachedMediaSession.artwork;
      }
    }

    const currentTime = video ? video.currentTime : 0;
    const duration = video && !isNaN(video.duration) ? video.duration : 0;

    // Detect playing state with video and play button fallback
    let isPlaying = video ? (!video.paused && !video.ended && video.readyState > 0) : false;
    const playBtn = document.querySelector('ytmusic-player-bar #play-pause-button') ||
                    document.querySelector('#play-pause-button') ||
                    document.querySelector('.ytp-play-button');
    if (playBtn) {
      const label = (playBtn.getAttribute('title') || playBtn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('pause')) {
        isPlaying = true;
      } else if (label.includes('play')) {
        isPlaying = false;
      }
    }

    const upcoming = getUpcomingTracks(upcomingCount);

    return {
      title: title || '',
      artist: artist || '',
      album: album || '',
      artwork: artwork || '',
      currentTime: currentTime,
      duration: duration,
      isPlaying: isPlaying,
      upcoming: upcoming,
      theme: theme,
      accent: accent,
      autohide: autohide,
      source: isYTM ? 'ytmusic' : 'youtube',
      timestamp: Date.now()
    };
  }

  function sendTrackInfo(force = false) {
    const data = getTrackData();
    if (!data.title && !force) return;

    lastTrackData = data;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          action: 'track_update',
          data: data
        }, (res) => {
          if (chrome.runtime.lastError) {
            isWorkerConnected = false;
            updateBadge();
            return;
          }
          if (res) {
            isWorkerConnected = !!res.connected;
            updateBadge();
          }
        });
      } catch (e) {
        isWorkerConnected = false;
        updateBadge();
      }
    }
  }

  // Poll regularly while tab is active
  setInterval(() => sendTrackInfo(false), 800);

  function attachVideoListeners() {
    const video = document.querySelector('video.html5-main-video') ||
                  document.querySelector('#movie_player video') ||
                  document.querySelector('video');

    if (video && !video.__yt_obs_attached) {
      video.__yt_obs_attached = true;
      video.addEventListener('play', () => sendTrackInfo(true));
      video.addEventListener('pause', () => sendTrackInfo(true));
      video.addEventListener('seeked', () => sendTrackInfo(true));
      video.addEventListener('loadeddata', () => sendTrackInfo(true));
    }
  }

  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => {
      attachVideoListeners();
      sendTrackInfo(true);
    }, 400);
  });

  document.addEventListener('spfdone', () => {
    setTimeout(() => {
      attachVideoListeners();
      sendTrackInfo(true);
    }, 400);
  });

  setInterval(attachVideoListeners, 1500);

  // Initial load
  loadSettings(() => {
    updateBadge();
    setTimeout(() => {
      attachVideoListeners();
      sendTrackInfo(true);
    }, 500);
  });
})();
