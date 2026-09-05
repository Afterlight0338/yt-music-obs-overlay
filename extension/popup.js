document.addEventListener('DOMContentLoaded', () => {
  const themeSelect = document.getElementById('theme');
  const upcomingSelect = document.getElementById('upcoming-count');
  const accentInput = document.getElementById('accent');
  const accentHex = document.getElementById('accent-hex');
  const autohideCheck = document.getElementById('autohide');
  const copyBtn = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');

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
              if (chrome.runtime.lastError) {
                // Ignore dormant tabs
              }
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
