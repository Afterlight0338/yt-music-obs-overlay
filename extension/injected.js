/**
 * YouTube & YouTube Music OBS Broadcaster - Main World Helper
 * Runs in the page's MAIN execution context with direct access to navigator.mediaSession
 */
(function() {
  let lastMetaJson = '';

  function checkMediaSession() {
    if (typeof navigator === 'undefined' || !navigator.mediaSession || !navigator.mediaSession.metadata) {
      return;
    }

    const meta = navigator.mediaSession.metadata;
    let artworkUrl = '';
    if (meta.artwork && meta.artwork.length > 0) {
      // Pick the last artwork in the list (typically the highest resolution)
      artworkUrl = meta.artwork[meta.artwork.length - 1].src;
    }

    const currentMeta = {
      title: meta.title || '',
      artist: meta.artist || '',
      album: meta.album || '',
      artwork: artworkUrl
    };

    const asJson = JSON.stringify(currentMeta);
    if (asJson !== lastMetaJson && (currentMeta.title || currentMeta.artist)) {
      lastMetaJson = asJson;
      window.dispatchEvent(new CustomEvent('__yt_obs_media_update', {
        detail: currentMeta
      }));
    }
  }

  // Poll mediaSession periodically to catch track changes immediately
  setInterval(checkMediaSession, 400);

  // Hook into setActionHandler or metadata if writable
  try {
    const origSetActionHandler = navigator.mediaSession?.setActionHandler;
    if (origSetActionHandler) {
      navigator.mediaSession.setActionHandler = function(action, handler) {
        setTimeout(checkMediaSession, 50);
        return origSetActionHandler.apply(this, arguments);
      };
    }
  } catch (e) {}
})();
