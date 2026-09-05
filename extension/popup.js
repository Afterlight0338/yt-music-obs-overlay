document.addEventListener('DOMContentLoaded', () => {
  const themeSelect = document.getElementById('theme');
  const accentInput = document.getElementById('accent');
  const accentHex = document.getElementById('accent-hex');
  const autohideCheck = document.getElementById('autohide');
  const copyBtn = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');

  // Load existing settings
  chrome.storage.sync.get(['theme', 'accent', 'autohide'], (res) => {
    if (res) {
      if (res.theme) themeSelect.value = res.theme;
      if (res.accent) {
        accentInput.value = res.accent;
        accentHex.textContent = res.accent;
      }
      if (res.autohide !== undefined) autohideCheck.checked = res.autohide;
    }
  });

  function broadcastChange() {
    const theme = themeSelect.value;
    const accent = accentInput.value;
    const autohide = autohideCheck.checked;

    accentHex.textContent = accent;

    // Save to storage
    chrome.storage.sync.set({ theme, accent, autohide }, () => {
      statusEl.textContent = '✨ Theme synced to OBS!';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 1500);
    });

    // Send direct runtime message to any open YouTube/YTM tabs
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://youtube.com/*", "*://music.youtube.com/*"] }, (tabs) => {
        if (tabs) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'force_update',
              theme,
              accent,
              autohide
            }, () => {
              if (chrome.runtime.lastError) {
                // Tab might be in background or dormant
              }
            });
          });
        }
      });
    }
  }

  themeSelect.addEventListener('change', broadcastChange);
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
