let pending = false;

export function requestMobileFullscreen() {
  const isPhone =
    navigator.userAgentData?.mobile ??
    /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
  if (
    !isPhone ||
    /iPad|Tablet/i.test(navigator.userAgent) ||
    pending ||
    document.fullscreenElement ||
    document.webkitFullscreenElement
  )
    return;

  // The HUD is attached to body, so fullscreen must include the whole page.
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;

  // Keep this synchronous with the start-button click to retain user activation.
  // Unsupported or denied fullscreen must never prevent the game from starting.
  try {
    pending = true;
    Promise.resolve(request.call(root)).then(
      () => { pending = false; },
      () => { pending = false; },
    );
  } catch {
    // Older browsers can throw before returning a promise.
    pending = false;
  }
}
