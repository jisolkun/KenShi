let pending = false;

export function isPhoneBrowser() {
  const agent = navigator.userAgent;
  if (/iPad|Tablet/i.test(agent)) return false;
  return navigator.userAgentData?.mobile ?? /iPhone|iPod|Android.*Mobile/i.test(agent);
}

export function requestMobileFullscreen() {
  if (!isPhoneBrowser() || pending) return;

  const orientation = screen.orientation;
  const lockLandscape = () => {
    try {
      if (typeof orientation?.lock !== 'function') return;
      Promise.resolve(orientation.lock('landscape')).catch(() => {});
    } catch {
      // Some mobile browsers expose the API but reject orientation locking.
    }
  };

  if (document.fullscreenElement || document.webkitFullscreenElement) {
    lockLandscape();
    return;
  }

  // The HUD is attached to body, so fullscreen must include the whole page.
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) {
    lockLandscape();
    return;
  }

  // Keep this synchronous with the start-button click to retain user activation.
  // Unsupported or denied fullscreen must never prevent the game from starting.
  try {
    pending = true;
    Promise.resolve(request.call(root)).then(
      () => { pending = false; lockLandscape(); },
      () => { pending = false; lockLandscape(); },
    );
  } catch {
    // Older browsers can throw before returning a promise.
    pending = false;
  }
}
