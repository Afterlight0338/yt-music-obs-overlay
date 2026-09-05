document.addEventListener('DOMContentLoaded', () => {
  const themeSelect = document.getElementById('theme');
  const upcomingSelect = document.getElementById('upcoming-count');
  const accentInput = document.getElementById('accent');
  const accentHex = document.getElementById('accent-hex');
  const autohideCheck = document.getElementById('autohide');
  const copyBtn = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');
  const connBadge = document.getElementById('conn-badge');
  const platformBadge = document.getElementById('platform-badge');
  const nowPlayingBox = document.getElementById('now-playing-box');
  const nowPlayingTitle = document.getElementById('now-playing-title');
  const nowPlayingArtist = document.getElementById('now-playing-artist');
  const nowPlayingArt = document.getElementById('now-playing-art');

  // Load stored preferences
  chrome.storage.sync.get(['theme', 'upcomingCount', 'accent', 'autohide'], (res) => {
    if (res) {
      if (res.theme) themeSelect.value = res.theme;
      if (res.upcomingCount !== undefined) upcomingSelect.value = res.upcomingCount;
      if (res.accent) {
        accentInput.value = res.accent;
        accentHex.textContent = res.accent;
      }
      if (res.autohide !== undefined) autohideCheck.checked = res.autohide;
    }
  });

  // Query background service worker for status and current song
  function checkStatus() {
    chrome.runtime.sendMessage({ action: 'get_status' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        connBadge.textContent = 'Offline';
        connBadge.className = 'badge';
        platformBadge.style.display = 'none';
        return;
      }

      if (res.connected) {
        connBadge.textContent = '🟢 Connected';
        connBadge.className = 'badge connected';
      } else {
        connBadge.textContent = '🟡 Connecting...';
        connBadge.className = 'badge';
      }

      if (res.lastTrack && res.lastTrack.title) {
        nowPlayingBox.style.display = 'flex';
        nowPlayingTitle.textContent = res.lastTrack.title;
        nowPlayingArtist.textContent = res.lastTrack.artist || 'YouTube';
        
        // Auto-detected platform
        platformBadge.style.display = 'inline-block';
        platformBadge.textContent = res.lastTrack.source === 'ytmusic' ? 'YT Music' : 'YouTube';

        if (res.lastTrack.artwork) {
          nowPlayingArt.src = res.lastTrack.artwork;
          nowPlayingArt.style.display = 'block';
        } else {
          nowPlayingArt.style.display = 'none';
        }
      }
    });
  }

  checkStatus();
  setInterval(checkStatus, 1500);

  function broadcastChange() {
    const theme = themeSelect.value;
    const upcomingCount = parseInt(upcomingSelect.value, 10);
    const accent = accentInput.value;
    const autohide = autohideCheck.checked;

    accentHex.textContent = accent;

    // Save to storage
    chrome.storage.sync.set({ theme, upcomingCount, accent, autohide }, () => {
      statusEl.textContent = '✨ Settings synced live!';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 1500);
    });

    // Notify background service worker directly
    chrome.runtime.sendMessage({
      action: 'force_update',
      theme,
      upcomingCount,
      accent,
      autohide
    }, () => {
      if (chrome.runtime.lastError) {}
    });

    // Notify all active YouTube & YT Music tabs immediately
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://youtube.com/*", "*://music.youtube.com/*"] }, (tabs) => {
        if (tabs) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'force_update',
              theme,
              upcomingCount,
              accent,
              autohide
            }, () => {
              if (chrome.runtime.lastError) {}
            });
          });
        }
      });
    }
  }

  themeSelect.addEventListener('change', broadcastChange);
  upcomingSelect.addEventListener('change', broadcastChange);
  accentInput.addEventListener('input', broadcastChange);
  autohideCheck.addEventListener('change', broadcastChange);

  copyBtn.addEventListener('click', () => {
    const localOverlayPath = `file:///home/afterlight/yt-music-obs-overlay/overlay.html`;
    navigator.clipboard.writeText(localOverlayPath);
    statusEl.textContent = '✅ Copied local OBS URL!';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
  });
});
