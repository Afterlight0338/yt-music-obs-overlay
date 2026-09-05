/**
 * YouTube & YouTube Music OBS Broadcaster - Content Script
 * Pure native WebSocket implementation (Zero WebWorkers / Zero Blob URLs / 100% CSP Safe)
 */
(function () {
  console.log('[YT-OBS] Overlay broadcaster initialized on:', window.location.hostname);

  // Minimal Native WebSocket MQTT v3.1.1 Client (Zero dependencies, Zero blob workers)
  class NativeMQTTClient {
    constructor(brokers, channelId) {
      this.brokers = brokers;
      this.brokerIdx = 0;
      this.channelId = channelId;
      this.ws = null;
      this.connected = false;
      this.pingTimer = null;
      this.reconnectTimer = null;
      this.connect();
    }

    connect() {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
      }

      const brokerUrl = this.brokers[this.brokerIdx];
      try {
        this.ws = new WebSocket(brokerUrl, ['mqtt']);
        this.ws.binaryType = 'arraybuffer';
      } catch (e) {
        console.warn('[YT-OBS] WebSocket creation error:', e);
        this.retry();
        return;
      }

      this.ws.onopen = () => {
        this.sendConnect();
      };

      this.ws.onmessage = (evt) => {
        const data = new Uint8Array(evt.data);
        const packetType = data[0] >> 4;
        if (packetType === 2) { // CONNACK
          this.connected = true;
          console.log('[YT-OBS] Connected to MQTT broker!');
          if (this.onConnect) this.onConnect();

          // Heartbeat ping every 30 seconds
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => {
            if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
            }
          }, 30000);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        if (this.onClose) this.onClose();
        this.retry();
      };

      this.ws.onerror = (err) => {
        this.connected = false;
      };
    }

    retry() {
      this.brokerIdx = (this.brokerIdx + 1) % this.brokers.length;
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }

    sendConnect() {
      const clientId = 'yt_send_' + Math.random().toString(16).substring(2, 8);
      const protocol = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54]; // "MQTT" (3.1.1)
      const version = 0x04; // 3.1.1
      const flags = 0x02; // Clean Session
      const keepAlive = [0x00, 0x3c]; // 60s

      const clientIdBytes = new TextEncoder().encode(clientId);
      const idLen = [clientIdBytes.length >> 8, clientIdBytes.length & 0xff];

      const payload = [...protocol, version, flags, ...keepAlive, ...idLen, ...clientIdBytes];
      
      let x = payload.length;
      const encodedLen = [];
      do {
        let digit = x % 128;
        x = Math.floor(x / 128);
        if (x > 0) digit = digit | 0x80;
        encodedLen.push(digit);
      } while (x > 0);

      const packet = new Uint8Array([0x10, ...encodedLen, ...payload]);
      this.ws.send(packet);
    }

    publish(topic, messageStr, retain = true) {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const topicBytes = new TextEncoder().encode(topic);
      const msgBytes = new TextEncoder().encode(messageStr);

      const varLen = 2 + topicBytes.length + msgBytes.length;
      const encodedLen = [];
      let x = varLen;
      do {
        let digit = x % 128;
        x = Math.floor(x / 128);
        if (x > 0) digit = digit | 0x80;
        encodedLen.push(digit);
      } while (x > 0);

      const packet = new Uint8Array(1 + encodedLen.length + 2 + topicBytes.length + msgBytes.length);
      let offset = 0;
      packet[offset++] = 0x30 | (retain ? 0x01 : 0x00);
      for (let b of encodedLen) packet[offset++] = b;
      packet[offset++] = (topicBytes.length >> 8) & 0xff;
      packet[offset++] = topicBytes.length & 0xff;
      packet.set(topicBytes, offset);
      offset += topicBytes.length;
      packet.set(msgBytes, offset);

      this.ws.send(packet);
    }
  }

  let channelId = 'yt-overlay';
  let theme = 'default';
  let accent = '#ff0055';
  let autohide = true;
  let upcomingCount = 3;
  let client = null;

  const brokers = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

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

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (changes.channelId) channelId = changes.channelId.newValue || 'yt-overlay';
        if (changes.theme) theme = changes.theme.newValue || 'default';
        if (changes.accent) accent = changes.accent.newValue || '#ff0055';
        if (changes.autohide !== undefined) autohide = changes.autohide.newValue;
        if (changes.upcomingCount !== undefined) upcomingCount = parseInt(changes.upcomingCount.newValue, 10);

        createBadge();
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
        alert(`📡 OBS Overlay Active\n\nPlatform: ${window.location.hostname}\nTheme: ${theme}\nStatus: ${client && client.connected ? '🟢 Connected to OBS' : '🟡 Connecting...'}`);
      };
      document.body.appendChild(badge);
    }

    const isConn = client && client.connected;
    badge.innerHTML = `
      <span style="width: 7px; height: 7px; border-radius: 50%; background: ${isConn ? '#10b981' : '#f59e0b'}; display: inline-block;"></span>
      <span>OBS: ${theme}</span>
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
    if (!client || !client.connected) return;
    const data = getTrackData();
    if (!data.title && !force) return;

    const payload = JSON.stringify(data);
    client.publish(`yt/overlay/${channelId}`, payload, true);
    client.publish(`ytm/overlay/${channelId}`, payload, true);
  }

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

  loadSettings(() => {
    client = new NativeMQTTClient(brokers, channelId);
    client.onConnect = () => {
      createBadge();
      sendTrackInfo(true);
    };
    client.onClose = () => {
      createBadge();
    };
    setTimeout(createBadge, 1000);
  });
})();
