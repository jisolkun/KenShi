let pendingRequest = null;

export function isPhoneBrowser() {
  const agent = navigator.userAgent || '';
  if (/iPad|Tablet/i.test(agent)) return false;

  // Prefer explicit phone identifiers. Some Android browsers report
  // userAgentData.mobile=false while using a phone's desktop-site mode.
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(agent)) return true;
  if (navigator.userAgentData?.mobile === true) return true;

  const platform = navigator.userAgentData?.platform || navigator.platform || agent;
  const narrowTouchPhone = matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width || innerWidth, screen.height || innerHeight) <= 520;
  return /Android/i.test(platform) && narrowTouchPhone;
}

export function isMobileFullscreen() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches,
  );
}

function syncMobileDisplayState() {
  const root = document.querySelector('.game-interface');
  if (!root) return;
  root.dataset.fullscreen = String(isMobileFullscreen());
  root.dataset.landscape = String(window.matchMedia('(orientation: landscape)').matches);
}

function lockLandscape() {
  try {
    const lock = screen.orientation?.lock;
    if (typeof lock !== 'function') return Promise.resolve(false);
    return Promise.resolve(lock.call(screen.orientation, 'landscape')).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

function currentLandscape() {
  return window.matchMedia('(orientation: landscape)').matches;
}

function enterFullscreen() {
  if (isMobileFullscreen()) return Promise.resolve({ requested: false, entered: true });

  const root = document.documentElement;
  if (typeof root.requestFullscreen === 'function') {
    try {
      // The start button is the user's gesture. Call this before any other
      // action can consume that activation.
      return Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).then(
        () => ({ requested: true, entered: isMobileFullscreen() }),
        error => ({ requested: true, entered: isMobileFullscreen(), error }),
      );
    } catch (error) {
      return Promise.resolve({ requested: true, entered: isMobileFullscreen(), error });
    }
  }

  if (typeof root.webkitRequestFullscreen === 'function') {
    try {
      return Promise.resolve(root.webkitRequestFullscreen()).then(
        () => ({ requested: true, entered: isMobileFullscreen() }),
        error => ({ requested: true, entered: isMobileFullscreen(), error }),
      );
    } catch (error) {
      return Promise.resolve({ requested: true, entered: isMobileFullscreen(), error });
    }
  }

  return Promise.resolve({ requested: false, entered: false, unsupported: true });
}

export function requestMobileFullscreen() {
  if (!isPhoneBrowser()) return null;
  if (pendingRequest) return pendingRequest;

  pendingRequest = enterFullscreen()
    .then(async result => {
      let orientationLocked = false;
      if (result.entered) orientationLocked = await lockLandscape();
      syncMobileDisplayState();
      return {
        ...result,
        orientationLocked,
        landscape: currentLandscape(),
      };
    })
    .finally(() => {
      pendingRequest = null;
      syncMobileDisplayState();
    });

  return pendingRequest;
}
