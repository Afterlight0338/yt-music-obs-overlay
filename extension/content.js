/**
 * YouTube & YouTube Music OBS Broadcaster - Content Script
 */
(function () {
  console.log('[YT-OBS] Overlay broadcaster active on:', window.location.hostname);

  let channelId = 'yt-overlay';
  let theme = 'default';
  let accent = '#ff0055';
  let autohide = true;
  let upcomingCount = 3; // Default 3 upcoming songs
  let client = null;
  let isConnected = false;

  // Load preferences from storage
  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['channelId', 'theme', 'accent', 'autohide', 'upcomingCount'], (res) => {
        if (res) {
          if (res.channelId) channelId = res.channelId;
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

  // Real-time settings listener
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        let channelChanged = false;
        if (changes.channelId) {
          channelId = changes.channelId.newValue || 'yt-overlay';
          channelChanged = true;
        }
        if (changes.theme) theme = changes.theme.newValue || 'default';
        if (changes.accent) accent = changes.accent.newValue || '#ff0055';
        if (changes.autohide !== undefined) autohide = changes.autohide.newValue;
        if (changes.upcomingCount !== undefined) upcomingCount = parseInt(changes.upcomingCount.newValue, 10);

        createBadge();

        if (channelChanged && client) {
          client.end(true, () => initMQTT());
        } else {
          sendTrackInfo(true);
        }
      }
    });
  }

  // Runtime message listener from popup
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

  // Status badge on bottom right
  function createBadge() {
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
      `;
      badge.onclick = () => {
        alert(`📡 OBS Overlay Active\n\nPlatform: ${window.location.hostname}\nTheme: ${theme}\nStatus: ${isConnected ? '🟢 Connected to OBS' : '🟡 Connecting...'}`);
      };
      document.body.appendChild(badge);
    }

    badge.innerHTML = `
      <span style="width: 7px; height: 7px; border-radius: 50%; background: ${isConnected ? '#10b981' : '#f59e0b'}; display: inline-block;"></span>
      <span>OBS: ${theme}</span>
    `;
  }

  function initMQTT() {
    const brokers = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    let brokerIdx = 0;

    function connect() {
      const brokerUrl = brokers[brokerIdx];
      client = mqtt.connect(brokerUrl, {
        clientId: 'yt_send_' + Math.random().toString(16).substring(2, 8),
        clean: true,
        reconnectPeriod: 3000
      });

      client.on('connect', () => {
        isConnected = true;
        createBadge();
        sendTrackInfo(true);
      });

      client.on('error', () => {
        isConnected = false;
        createBadge();
        client.end();
        brokerIdx = (brokerIdx + 1) % brokers.length;
        setTimeout(connect, 3000);
      });

      client.on('close', () => {
        isConnected = false;
        createBadge();
      });
    }

    connect();
  }

  // Extract playlist/queue upcoming items
  function getUpcomingTracks(maxCount) {
    if (maxCount <= 0) return [];
    const upcoming = [];
    const isYTM = window.location.hostname.includes('music.youtube.com');

    if (isYTM) {
      // YouTube Music Queue
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
            if (t) {
              upcoming.push({ title: t, artist: a, artwork: img });
            }
          });
        }
      }
    } else {
      // Regular YouTube Playlist / Mix Panel
      const panelItems = Array.from(document.querySelectorAll('ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'));
      if (panelItems.length > 0) {
        let activeIdx = panelItems.findIndex(el => el.hasAttribute('selected') || el.classList.contains('selected') || el.querySelector('.selected'));
        if (activeIdx !== -1) {
          const nextSlice = panelItems.slice(activeIdx + 1, activeIdx + 1 + maxCount);
          nextSlice.forEach(item => {
            const t = item.querySelector('#video-title')?.textContent?.trim() || '';
            const a = item.querySelector('#byline')?.textContent?.trim() || item.querySelector('#channel-name')?.textContent?.trim() || '';
            const img = item.querySelector('img')?.src || '';
            if (t) {
              upcoming.push({ title: t, artist: a, artwork: img });
            }
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
      // YouTube Music Specific Selectors
      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const bylineEl = document.querySelector('ytmusic-player-bar .byline');
      const imgEl = document.querySelector('ytmusic-player-bar .image');

      title = (titleEl ? titleEl.textContent.trim() : '') || (navigator.mediaSession?.metadata?.title || '');
      artist = (bylineEl ? bylineEl.textContent.trim() : '') || (navigator.mediaSession?.metadata?.artist || '');
      album = navigator.mediaSession?.metadata?.album || 'YouTube Music';

      if (imgEl && imgEl.src) {
        artwork = imgEl.src;
      } else if (navigator.mediaSession?.metadata?.artwork?.length > 0) {
        artwork = navigator.mediaSession.metadata.artwork[navigator.mediaSession.metadata.artwork.length - 1].src;
      }
    } else {
      // Regular YouTube - Universal Exhaustive Fallback Hierarchy
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

      title = ytTitleEl ? ytTitleEl.textContent.trim() : '';
      if (!title) {
        const docTitle = document.title || '';
        title = docTitle.replace(' - YouTube', '').replace(/^\(\d+\)\s*/, '').trim();
      }

      artist = ytChannelEl ? ytChannelEl.textContent.trim() : 'YouTube';
      album = 'YouTube';

      // Thumbnail extraction
      const vParam = new URLSearchParams(window.location.search).get('v');
      if (vParam) {
        artwork = `https://i.ytimg.com/vi/${vParam}/hqdefault.jpg`;
      } else if (window.location.pathname.includes('/shorts/')) {
        const shortId = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
        if (shortId) {
          artwork = `https://i.ytimg.com/vi/${shortId}/hqdefault.jpg`;
        }
      }

      if (!artwork && navigator.mediaSession?.metadata?.artwork?.length > 0) {
        artwork = navigator.mediaSession.metadata.artwork[navigator.mediaSession.metadata.artwork.length - 1].src;
      }
    }

    const currentTime = video ? video.currentTime : 0;
    const duration = video && !isNaN(video.duration) ? video.duration : 0;
    const isPlaying = video ? (!video.paused && !video.ended && video.readyState > 0) : false;

    // Detect upcoming tracks from playlist / mix
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
    if (!client || !isConnected) return;
    const data = getTrackData();

    // If no title exists and not forced, skip
    if (!data.title && !force) return;

    const payload = JSON.stringify(data);
    client.publish(`yt/overlay/${channelId}`, payload, { qos: 0, retain: true });
    client.publish(`ytm/overlay/${channelId}`, payload, { qos: 0, retain: true });
  }

  // Fast polling loop to detect any video/page changes
  setInterval(() => sendTrackInfo(false), 800);

  // Attach event listeners
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
      video.addEventListener('timeupdate', () => {
        // Periodic time tick
      });
    }
  }

  // SPA navigation hooks
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

  loadSettings(() => {
    initMQTT();
    setTimeout(createBadge, 1000);
  });
})();
