/**
 * YouTube Music OBS Broadcaster Bookmarklet
 * Zero download, runs directly in browser tab at music.youtube.com
 */
(function() {
  const CHANNEL_ID = "yt-overlay"; // Default channel for overlay
  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const FALLBACK_BROKER = "wss://broker.hivemq.com:8884/mqtt";

  if (window.__ytm_obs_broadcaster) {
    if (window.__ytm_show_toast) {
      window.__ytm_show_toast("Broadcaster already active on channel: " + CHANNEL_ID);
    }
    return;
  }
  window.__ytm_obs_broadcaster = true;

  // Visual Notification Toast
  function showToast(msg, bg = "#ff0055") {
    let toast = document.getElementById("ytm-obs-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ytm-obs-toast";
      toast.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 24px;
        background: ${bg};
        color: white;
        padding: 12px 20px;
        border-radius: 12px;
        font-family: 'Roboto', sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 999999;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        transition: opacity 0.4s ease, transform 0.4s ease;
        display: flex;
        align-items: center;
        gap: 10px;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>📡</span> <span>${msg}</span>`;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
    }, 4000);
  }
  window.__ytm_show_toast = showToast;

  function loadScript(src, cb) {
    if (window.mqtt) return cb();
    const s = document.createElement("script");
    s.src = src;
    s.onload = cb;
    document.head.appendChild(s);
  }

  loadScript("https://unpkg.com/mqtt/dist/mqtt.min.js", () => {
    let client = null;
    const topic1 = `ytm/overlay/${CHANNEL_ID}`;
    const topic2 = `yt/overlay/${CHANNEL_ID}`;

    function initClient(broker) {
      client = window.mqtt.connect(broker, {
        clientId: "ytm_send_" + Math.random().toString(16).substr(2, 8),
        clean: true
      });

      client.on("connect", () => {
        showToast(`Connected to OBS Overlay (${CHANNEL_ID})!`, "#10b981");
        sendTrackInfo();
      });

      client.on("error", () => {
        if (broker !== FALLBACK_BROKER) {
          initClient(FALLBACK_BROKER);
        }
      });
    }

    initClient(BROKER_URL);

    function getTrackData() {
      const video = document.querySelector("video");
      const meta = navigator.mediaSession ? navigator.mediaSession.metadata : null;

      // Fallbacks from DOM
      const titleEl = document.querySelector("ytmusic-player-bar .title, ytmusic-player-bar yt-formatted-string.title");
      const bylineEl = document.querySelector("ytmusic-player-bar .byline, ytmusic-player-bar yt-formatted-string.byline");
      const imgEl = document.querySelector("ytmusic-player-bar yt-img-shadow img, ytmusic-player-bar .image img, ytmusic-player-bar img#img");

      let title = meta ? meta.title : (titleEl ? (titleEl.getAttribute("title") || titleEl.textContent) : "");
      let artist = meta ? meta.artist : (bylineEl ? (bylineEl.querySelector("a")?.textContent || bylineEl.textContent) : "");
      if (artist && artist.includes(" • ")) {
        artist = artist.split(" • ")[0].trim();
      }
      let album = meta ? meta.album : "YouTube Music";
      
      let artwork = "";
      if (meta && meta.artwork && meta.artwork.length > 0) {
        artwork = meta.artwork[meta.artwork.length - 1].src;
      } else if (imgEl && imgEl.src) {
        artwork = imgEl.src;
      }

      const currentTime = video ? video.currentTime : 0;
      const duration = video && !isNaN(video.duration) ? video.duration : 0;
      const isPlaying = video ? (!video.paused && !video.ended) : false;

      return {
        title: title || "",
        artist: artist || "",
        album: album || "",
        artwork: artwork || "",
        currentTime: currentTime,
        duration: duration,
        isPlaying: isPlaying,
        timestamp: Date.now()
      };
    }

    let lastPayload = "";

    function sendTrackInfo() {
      if (!client || !client.connected) return;
      const data = getTrackData();
      const payload = JSON.stringify(data);

      // Publish to both topics with retain
      client.publish(topic1, payload, { qos: 0, retain: true });
      client.publish(topic2, payload, { qos: 0, retain: true });
      lastPayload = payload;
    }

    // High frequency monitor for instant track/play/pause updates
    setInterval(sendTrackInfo, 1000);

    const video = document.querySelector("video");
    if (video) {
      video.addEventListener("play", sendTrackInfo);
      video.addEventListener("pause", sendTrackInfo);
      video.addEventListener("seeked", sendTrackInfo);
    }
  });
})();
