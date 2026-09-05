document.addEventListener('DOMContentLoaded', () => {
  const themeSelect = document.getElementById('theme');
  const accentInput = document.getElementById('accent');
  const accentHex = document.getElementById('accent-hex');
  const autohideCheck = document.getElementById('autohide');
  const channelInput = document.getElementById('channel');
  const copyBtn = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');

  // Load existing settings
  chrome.storage.sync.get(['theme', 'accent', 'autohide', 'channelId'], (res) => {
    if (res) {
      if (res.theme) themeSelect.value = res.theme;
      if (res.accent) {
        accentInput.value = res.accent;
        accentHex.textContent = res.accent;
      }
      if (res.autohide !== undefined) autohideCheck.checked = res.autohide;
      if (res.channelId) channelInput.value = res.channelId;
    }
  });

  function saveSettings() {
    const theme = themeSelect.value;
    const accent = accentInput.value;
    const autohide = autohideCheck.checked;
    const channelId = channelInput.value.trim() || 'yt-overlay';

    accentHex.textContent = accent;

    chrome.storage.sync.set({ theme, accent, autohide, channelId }, () => {
      statusEl.textContent = '✨ Synced to OBS in real-time!';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2000);
    });
  }

  themeSelect.addEventListener('change', saveSettings);
  accentInput.addEventListener('input', saveSettings);
  autohideCheck.addEventListener('change', saveSettings);
  channelInput.addEventListener('input', saveSettings);

  copyBtn.addEventListener('click', () => {
    const ch = channelInput.value.trim() || 'yt-overlay';
    // Clean default link with zero query params if default channel!
    const obsUrl = ch === 'yt-overlay'
      ? `https://afterlight0338.github.io/yt-music-obs-overlay/overlay.html`
      : `https://afterlight0338.github.io/yt-music-obs-overlay/overlay.html?channel=${encodeURIComponent(ch)}`;

    navigator.clipboard.writeText(obsUrl);
    statusEl.textContent = '✅ Copied OBS URL to clipboard!';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
  });
});
