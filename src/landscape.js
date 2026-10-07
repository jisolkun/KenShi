/** Keep the canvas and its touch controls in one logical landscape viewport. */
export function initLandscape() {
  const game = document.getElementById('game');
  let viewport = { width: 1, height: 1 };
  let rotated = false;
  let requesting = false;

  function resize() {
    const physicalWidth = Math.max(1, window.innerWidth);
    const physicalHeight = Math.max(1, window.innerHeight);
    rotated = physicalHeight > physicalWidth;
    viewport = rotated
      ? { width: physicalHeight, height: physicalWidth }
      : { width: physicalWidth, height: physicalHeight };
    game.style.width = `${viewport.width}px`;
    game.style.height = `${viewport.height}px`;
    game.style.setProperty('--physical-width', `${physicalWidth}px`);
    game.classList.toggle('is-rotated', rotated);
    game.classList.toggle('game-compact', viewport.height <= 540);
    game.classList.toggle('game-small', viewport.width <= 760);
    game.classList.toggle('game-narrow', viewport.width <= 600);
    game.classList.toggle('game-tiny', viewport.height <= 360);
    document.documentElement.classList.toggle('landscape-emulated', rotated);
  }

  function getViewport() {
    return { ...viewport };
  }

  // Bounding rectangles are physical pixels; clientWidth/Height stay logical.
  function clientToNDC(x, y, canvas) {
    const rect = canvas.getBoundingClientRect();
    const localX = rotated ? y - rect.top : x - rect.left;
    const localY = rotated ? rect.right - x : y - rect.top;
    const width = rotated ? rect.height : rect.width;
    const height = rotated ? rect.width : rect.height;
    return { x: localX / Math.max(1, width) * 2 - 1, y: 1 - localY / Math.max(1, height) * 2 };
  }

  function ndcToClient(x, y, canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = rotated ? rect.height : rect.width;
    const height = rotated ? rect.width : rect.height;
    const localX = (x + 1) * width / 2;
    const localY = (1 - y) * height / 2;
    return rotated
      ? { x: rect.right - localY, y: rect.top + localX }
      : { x: rect.left + localX, y: rect.top + localY };
  }

  function requestLandscape() {
    if (requesting) return;
    requesting = true;
    const orientation = window.screen?.orientation;
    const lock = () => {
      try { return Promise.resolve(orientation?.lock?.('landscape')).catch(() => {}); }
      catch { return Promise.resolve(); }
    };
    let fullscreen;
    try {
      fullscreen = document.fullscreenElement
        ? Promise.resolve()
        : Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }));
    } catch { fullscreen = Promise.resolve(); }
    // Some browsers require fullscreen; others allow the first lock immediately.
    lock();
    fullscreen.catch(() => {}).then(lock).finally(() => {
      requesting = false;
      resize();
      window.dispatchEvent(new Event('resize'));
    });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.addEventListener('fullscreenchange', resize);
  resize();
  return { getViewport, clientToNDC, ndcToClient, requestLandscape };
}
