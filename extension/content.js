/**
 * YouTube & YouTube Music OBS Broadcaster - Content Script
 */
(function () {
  console.log('[YT-OBS] Overlay broadcaster initialized on:', window.location.hostname);

  let channelId = 'yt-overlay';
  let theme = 'default';
  let accent = '#ff0055';
  let autohide = true;
  let client = null;
  let isConnected = false;

  // Load settings from storage
  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['channelId', 'theme', 'accent', 'autohide'], (res) => {
        if (res) {
          if (res.channelId) channelId = res.channelId;
          if (res.theme) theme = res.theme;
          if (res.accent) accent = res.accent;
          if (res.autohide !== undefined) autohide = res.autohide;
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

        console.log('[YT-OBS] Live settings updated:', { channelId, theme, accent, autohide });
        createBadge();

        if (channelChanged && client) {
          client.end(true, () => initMQTT());
        } else {
          // Instantly send updated theme/accent to OBS!
          sendTrackInfo(true);
        }
      }
    });
  }

  // Listen for direct messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'force_update') {
        if (msg.theme) theme = msg.theme;
        if (msg.accent) accent = msg.accent;
        if (msg.autohide !== undefined) autohide = msg.autohide;
        sendTrackInfo(true);
        sendResponse({ success: true });
      }
    });
  }

  // Unobtrusive visual badge on bottom right
  function createBadge() {
    let badge = document.getElementById('yt-obs-status-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-obs-status-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: rgba(18, 18, 24, 0.9);
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
      badge.onclick = () => {
        alert(`📡 OBS Overlay Active\n\nPlatform: ${window.location.hostname}\nTheme: ${theme}\nStatus: ${isConnected ? '🟢 Connected to OBS' : '🟡 Connecting...'}\n\nChange themes anytime in the extension popup!`);
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
        reconnectPeriod: 4000
      });

      client.on('connect', () => {
        isConnected = true;
        createBadge();
        sendTrackInfo(true);
      });

      client.on('error', (err) => {
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

  function getTrackData() {
    const isYTM = window.location.hostname.includes('music.youtube.com');
    const video = document.querySelector('video.html5-main-video') ||
                  document.querySelector('#movie_player video') ||
                  document.querySelector('video');

    const meta = navigator.mediaSession ? navigator.mediaSession.metadata : null;

    let title = '';
    let artist = '';
    let album = '';
    let artwork = '';

    if (isYTM) {
      // YouTube Music Specific Selectors
      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const bylineEl = document.querySelector('ytmusic-player-bar .byline');
      const imgEl = document.querySelector('ytmusic-player-bar .image');

      title = meta && meta.title ? meta.title : (titleEl ? titleEl.textContent.trim() : '');
      artist = meta && meta.artist ? meta.artist : (bylineEl ? bylineEl.textContent.trim() : '');
      album = meta && meta.album ? meta.album : '';

      if (meta && meta.artwork && meta.artwork.length > 0) {
        artwork = meta.artwork[meta.artwork.length - 1].src;
      } else if (imgEl && imgEl.src) {
        artwork = imgEl.src;
      }
    } else {
      // Regular YouTube Specific Selectors
      const ytTitleEl = document.querySelector('ytd-watch-metadata #title h1 yt-formatted-string') ||
                        document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                        document.querySelector('#title h1 yt-formatted-string') ||
                        document.querySelector('h1.title yt-formatted-string') ||
                        document.querySelector('#container h1.ytd-watch-metadata');

      const ytChannelEl = document.querySelector('ytd-watch-metadata #channel-name #text a') ||
                          document.querySelector('#owner #channel-name a') ||
                          document.querySelector('ytd-channel-name yt-formatted-string a') ||
                          document.querySelector('#channel-name a');

      title = meta && meta.title ? meta.title : (ytTitleEl ? ytTitleEl.textContent.trim() : '');
      if (!title) {
        title = document.title.replace(' - YouTube', '').replace(/^\(\d+\)\s*/, '').trim();
      }

      artist = meta && meta.artist ? meta.artist : (ytChannelEl ? ytChannelEl.textContent.trim() : 'YouTube');
      album = 'YouTube';

      if (meta && meta.artwork && meta.artwork.length > 0) {
        artwork = meta.artwork[meta.artwork.length - 1].src;
      } else {
        const vParam = new URLSearchParams(window.location.search).get('v');
        if (vParam) {
          artwork = `https://i.ytimg.com/vi/${vParam}/hqdefault.jpg`;
        } else if (window.location.pathname.includes('/shorts/')) {
          const shortId = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
          if (shortId) {
            artwork = `https://i.ytimg.com/vi/${shortId}/hqdefault.jpg`;
          }
        }
      }
    }

    const currentTime = video ? video.currentTime : 0;
    const duration = video && !isNaN(video.duration) ? video.duration : 0;
    const isPlaying = video ? (!video.paused && !video.ended && video.readyState > 0) : false;

    return {
      title: title || '',
      artist: artist || '',
      album: album || '',
      artwork: artwork || '',
      currentTime: currentTime,
      duration: duration,
      isPlaying: isPlaying,
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

    // If nothing is playing and no title exists, don't spam unless forced
    if (!data.title && !data.isPlaying && !force) return;

    const payload = JSON.stringify(data);
    client.publish(`yt/overlay/${channelId}`, payload, { qos: 0, retain: true });
    client.publish(`ytm/overlay/${channelId}`, payload, { qos: 0, retain: true });
  }

  // Periodic updates while tab is active
  setInterval(() => sendTrackInfo(false), 800);

  // Hook into video playback events & SPA navigation on YouTube
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

  // Re-attach listeners on YouTube SPA navigation
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => {
      attachVideoListeners();
      sendTrackInfo(true);
    }, 500);
  });

  document.addEventListener('spfdone', () => {
    setTimeout(() => {
      attachVideoListeners();
      sendTrackInfo(true);
    }, 500);
  });

  setInterval(attachVideoListeners, 1500);

  loadSettings(() => {
    initMQTT();
    setTimeout(createBadge, 1000);
  });
})();
