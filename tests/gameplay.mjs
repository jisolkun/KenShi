import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const port = Number(process.env.TEST_PORT || 4173);
const baseURL = process.env.TEST_URL || `http://127.0.0.1:${port}`;
const output = 'test-results';
const checks = [];
const errors = [];
let server;
let browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = (name, details = '') => {
  checks.push({ name, details });
  console.log(`PASS ${name}${details ? `: ${details}` : ''}`);
};

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {}
    if (server?.exitCode != null) throw new Error(`Vite stopped with code ${server.exitCode}`);
    await delay(200);
  }
  throw new Error(`Vite did not become ready at ${baseURL}`);
}

const snapshot = page => page.evaluate(() => window.__undeadSlayer.snapshot());
async function until(page, predicate, timeout = 15000, label = 'condition') {
  const started = Date.now();
  let state;
  while (Date.now() - started < timeout) {
    state = await snapshot(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__undeadSlayer, { timeout: 30000 });
  await page.locator('#start-screen').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return !!canvas && !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  }), 'Canvas must have an active WebGL context');
  return page;
}

async function start(page) {
  await page.locator('#start-button').click();
  await until(page, state => !['ready', 'menu', 'start'].includes(state.phase) && !state.paused, 5000, 'start');
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
}

async function restart(page, { touch = false } = {}) {
  const activate = locator => touch ? locator.tap() : locator.click();
  const state = await snapshot(page);
  if (await page.locator('#result-screen').isVisible()) {
    await activate(page.locator('#result-restart'));
  } else {
    if (!state.paused) await activate(page.locator('#pause-button'));
    await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await activate(page.locator('#restart-button'));
  }
  await until(page, state => state.hp === 100 && state.kills === 0 && !state.paused, 5000, 'restart');
  const reset = await snapshot(page);
  assert.equal(reset.sp, 100, 'Restart must restore SP');
  return reset;
}

async function clickWorld(page, x, z, { double = false, touch = false } = {}) {
  const screen = await page.evaluate(({ x, z }) => window.__undeadSlayer.worldToScreen(x, z), { x, z });
  const size = page.viewportSize();
  assert(screen.x >= 0 && screen.x <= size.width && screen.y >= 0 && screen.y <= size.height,
    `World coordinate must project into viewport: ${JSON.stringify(screen)}`);
  if (touch) await page.touchscreen.tap(screen.x, screen.y);
  else if (double) await page.mouse.dblclick(screen.x, screen.y, { delay: 70 });
  else await page.mouse.click(screen.x, screen.y);
}

// Controls can occupy different physical edges after the game root rotates.
// Inspect the actual hit target instead of reserving fixed desktop HUD margins.
async function canvasPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const point = window.__undeadSlayer.worldToScreen(x, z);
    const hit = document.elementFromPoint(point.x, point.y);
    return hit?.id === 'game-canvas' ? point : null;
  }, { x, z });
}

async function checkLayout(page, mode = 'play') {
  const selectors = mode === 'start' ? ['#start-button']
    : mode === 'pause' ? ['#resume-button', '#restart-button']
      : ['#audio-button', '#pause-button', '#help-button', ...['dash', 'whirl', 'burst', 'frost', 'blades'].map(name => `#skill-${name}`)];
  const layout = await page.evaluate(selectors => {
    const root = document.querySelector('#game');
    const bounds = root.getBoundingClientRect();
    const buttons = selectors.map(selector => {
      const node = document.querySelector(selector);
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { selector, x: box.x, y: box.y, width: box.width, height: box.height, accessible: node === hit || node.contains(hit) };
    });
    return { logical: window.__undeadSlayer.viewport, physical: { width: innerWidth, height: innerHeight },
      rotated: root.classList.contains('is-rotated'), transform: getComputedStyle(root).transform,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, buttons };
  }, selectors);
  assert(layout.logical.width >= layout.logical.height, 'The game viewport must default to landscape');
  assert.equal(layout.logical.width, Math.max(layout.physical.width, layout.physical.height), 'Logical viewport width must use the physical long edge');
  assert.equal(layout.logical.height, Math.min(layout.physical.width, layout.physical.height), 'Logical viewport height must use the physical short edge');
  assert.equal(layout.rotated, layout.physical.height > layout.physical.width, 'Portrait must rotate the entire game root');
  if (layout.rotated) assert.notEqual(layout.transform, 'none', 'Portrait landscape emulation needs a CSS transform');
  assert(!layout.overflow, `The physical viewport must not scroll: ${JSON.stringify({ physical: layout.physical, scroll: layout.scroll })}`);
  assert(Math.abs(layout.bounds.width - layout.physical.width) < 1 && Math.abs(layout.bounds.height - layout.physical.height) < 1,
    `The rotated root must fill the physical display: ${JSON.stringify(layout)}`);
  for (const button of layout.buttons) {
    assert(button.width >= 43.9 && button.height >= 43.9, `${button.selector} needs a 44px touch target: ${JSON.stringify(button)}`);
    assert(button.x >= -.5 && button.y >= -.5 && button.x + button.width <= layout.physical.width + .5 && button.y + button.height <= layout.physical.height + .5,
      `${button.selector} must be wholly inside the screen`);
    assert(button.accessible, `${button.selector} must not be obscured by HUD or menu content`);
  }
  for (let a = 0; a < layout.buttons.length; a++) for (let b = a + 1; b < layout.buttons.length; b++) {
    const one = layout.buttons[a], two = layout.buttons[b];
    const overlapX = Math.min(one.x + one.width, two.x + two.width) - Math.max(one.x, two.x);
    const overlapY = Math.min(one.y + one.height, two.y + two.height) - Math.max(one.y, two.y);
    assert(overlapX <= .5 || overlapY <= .5, `${one.selector} and ${two.selector} must not overlap`);
  }
  return layout;
}

async function checkProjection(page) {
  const samples = await page.evaluate(() => {
    const api = window.__undeadSlayer;
    const origin = api.snapshot().playerPosition;
    return [[0, 0], [2, 0], [-2, 1], [1, -2]].map(([dx, dz]) => {
      const world = { x: origin.x + dx, z: origin.z + dz };
      const screen = api.worldToScreen(world.x, world.z);
      return { world, screen, inverse: api.screenToWorld(screen.x, screen.y) };
    });
  });
  const physical = page.viewportSize();
  for (const { world, screen, inverse } of samples) {
    assert(screen.x >= 0 && screen.x < physical.width && screen.y >= 0 && screen.y < physical.height, 'Nearby world points must project into the physical viewport');
    assert(inverse && Math.hypot(world.x - inverse.x, world.z - inverse.z) < .0001,
      `World/client projection must round-trip through the rotated camera: ${JSON.stringify({ world, screen, inverse })}`);
  }
}

async function touchGesture(page, points, hold = 0) {
  const session = await page.context().newCDPSession(page);
  const point = p => ({ x: p.x, y: p.y, radiusX: 2, radiusY: 2, force: 1, id: 1 });
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(points[0])] });
    if (hold) await page.waitForTimeout(hold);
    for (const next of points.slice(1)) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(next)] });
      await page.waitForTimeout(35);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

async function touchDoubleTap(page, point) {
  const session = await page.context().newCDPSession(page);
  try {
    // Queue both contacts in protocol order without waiting for a software GL
    // frame acknowledgment between them. These remain native touch events.
    const touchPoints = [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
    await Promise.all([
      session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
      session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
      session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
  } finally { await session.detach(); }
}

async function touchMovement(page) {
  const before = await snapshot(page);
  const destination = { x: before.playerPosition.x + 3, z: before.playerPosition.z - 1 };
  const point = await canvasPoint(page, destination.x, destination.z);
  assert(point, 'Touch movement target must hit the battlefield rather than the HUD');
  await page.touchscreen.tap(point.x, point.y);
  const after = await until(page, state => Math.hypot(state.playerPosition.x - destination.x, state.playerPosition.z - destination.z) < .35,
    10000, 'touch reaches the projected world destination');
  assert(Math.hypot(after.playerPosition.x - before.playerPosition.x, after.playerPosition.z - before.playerPosition.z) > 2,
    'Touch must travel in the correct world direction');
}

async function mobileChecks(context, label) {
  const page = await open(context);
  await checkLayout(page, 'start');
  await page.locator('#start-button').tap();
  await page.locator('#start-screen').waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  await checkLayout(page);
  await checkProjection(page);
  await touchMovement(page);
  await page.screenshot({ path: `${output}/gameplay-${label}.png`, fullPage: true });
  record(`${label}: landscape layout, 44px controls, projection round-trip and real touch destination`);

  await restart(page, { touch: true });
  // Restart resets camera focus; allow the follow camera to settle before
  // projecting a point that will be reused by both real touch contacts.
  await page.waitForTimeout(650);
  const beforeRoll = await snapshot(page);
  const rollPoint = await canvasPoint(page, beforeRoll.playerPosition.x + .4, beforeRoll.playerPosition.z);
  assert(rollPoint, 'Double tap must hit the canvas');
  await touchDoubleTap(page, rollPoint);
  await until(page, state => state.sp < beforeRoll.sp - 3 && state.rollCooldown > 0, 4000, 'real touch double-tap roll');

  await restart(page, { touch: true });
  const beforeHold = await snapshot(page);
  const holdPoint = await canvasPoint(page, beforeHold.playerPosition.x, beforeHold.playerPosition.z);
  assert(holdPoint, 'Touch hold must hit the canvas');
  await touchGesture(page, [holdPoint], 800);
  await until(page, state => state.sp < beforeHold.sp - 3, 5000, 'real touch long press heavy attack');

  await restart(page, { touch: true });
  const beforeSwipe = await snapshot(page);
  const swipe = await page.evaluate(() => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    const rotated = document.querySelector('#game').classList.contains('is-rotated');
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return rotated ? [{ x, y: y - 70 }, { x, y }, { x, y: y + 70 }] : [{ x: x - 70, y }, { x, y }, { x: x + 70, y }];
  });
  await touchGesture(page, swipe);
  const afterSwipe = await until(page, state => state.sp < beforeSwipe.sp - 3, 5000, 'real touch swipe finisher');
  assert.equal(afterSwipe.cooldowns.burst, 0, 'Touch swipe must have its own cooldown');

  await restart(page, { touch: true });
  await skillButton(page, 'frost').tap();
  await until(page, state => state.cooldowns.frost > 0 && state.sp < 100, 5000, 'touch skill');
  await page.locator('#pause-button').tap();
  await page.locator('#pause-screen').waitFor({ state: 'visible' });
  await checkLayout(page, 'pause');
  const paused = await snapshot(page);
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.height, height: size.width });
  await page.waitForTimeout(700);
  await checkLayout(page, 'pause');
  await checkProjection(page);
  const resized = await snapshot(page);
  assert.equal(resized.elapsed, paused.elapsed, 'Resize must preserve paused simulation time');
  assert.deepEqual(resized.playerPosition, paused.playerPosition, 'Resize must preserve paused player position');
  assert.equal(resized.hp, paused.hp, 'Resize must preserve paused combat state');
  assert.equal(resized.sp, paused.sp, 'Resize must not regenerate SP while paused');
  assert.deepEqual(resized.cooldowns, paused.cooldowns, 'Resize must not tick skill cooldowns while paused');
  await page.locator('#resume-button').tap();
  await until(page, state => !state.paused && state.elapsed > paused.elapsed + .1, 5000, 'touch resume after rotation');
  await checkLayout(page);
  await restart(page, { touch: true });
  await page.screenshot({ path: `${output}/gameplay-${label}-resized.png`, fullPage: true });
  record(`${label}: touch double tap, long hold, swipe, skill, pause, physical rotation, resume and restart`);
  await context.close();
}

function skillButton(page, skill) {
  return page.locator(`[data-skill="${skill}"], #skill-${skill}`).first();
}

async function fight(page, timeout = 210000) {
  const began = Date.now();
  let lastAttack = 0;
  let lastReport = 0;
  let lastState;
  let bossSeen = false;
  while (Date.now() - began < timeout) {
    const state = await snapshot(page);
    lastState = state;
    if (Date.now() - lastReport > 15000) {
      console.log(`COMBAT wave ${state.wave}, kills ${state.kills}, HP ${state.hp}, SP ${state.sp}, elapsed ${state.elapsed}s`);
      lastReport = Date.now();
    }
    if (await page.locator('#result-screen').isVisible()) {
      assert(bossSeen, 'The complete combat run must encounter a live boss');
      return state;
    }
    const enemies = await page.evaluate(() => window.__undeadSlayer.enemyPositions());
    bossSeen ||= enemies.some(enemy => enemy.type === 'boss');
    if (enemies.length) {
      const p = state.playerPosition;
      enemies.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const target = enemies[0];
      let point = await canvasPoint(page, target.x, target.z);
      if (!point) {
        const length = Math.hypot(target.x - p.x, target.z - p.z);
        for (const step of [5, 3, 1.5]) {
          point = await canvasPoint(page, p.x + (target.x - p.x) / length * Math.min(step, length), p.z + (target.z - p.z) / length * Math.min(step, length));
          if (point) break;
        }
      }
      if (point) {
        await page.mouse.click(point.x, point.y);
      }
      // Read positions and cooldowns; all actions use the same real controls as a player.
      const distance = Math.hypot(target.x - p.x, target.z - p.z);
      if (Date.now() - lastAttack > 550 && (!state.action || state.action === 'attack')) {
        const candidates = distance < 4 ? ['burst', 'whirl', 'frost', 'blades', 'dash'] : distance < 6.3 ? ['burst', 'frost', 'blades', 'dash'] : ['blades', 'dash'];
        for (const skill of candidates) {
          const button = skillButton(page, skill);
          if ((state.cooldowns[skill] || 0) <= 0 && await button.isEnabled()) {
            await button.click();
            lastAttack = Date.now();
            break;
          }
        }
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`No settlement after real gameplay: ${JSON.stringify(lastState)}`);
}

try {
  await mkdir(output, { recursive: true });
  if (!process.env.TEST_URL) {
    // A separate Vite server with watching disabled keeps collaborators' edits
    // from reloading a browser in the middle of a gesture or combat run.
    const serverCode = `import { createServer } from 'vite'; const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: ${port}, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } } }); await server.listen();`;
    server = spawn(process.execPath, ['--input-type=module', '-e', serverCode], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', data => process.stderr.write(data));
  }
  await waitForServer();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(desktop);
  record('Desktop WebGL and start screen');
  await start(page);
  record('Start button begins gameplay');

  const beforeMove = await snapshot(page);
  await clickWorld(page, 4, 2);
  await until(page, state => Math.hypot(state.playerPosition.x - beforeMove.playerPosition.x, state.playerPosition.z - beforeMove.playerPosition.z) > 1, 10000, 'ground movement');
  record('Ground click moves player');

  await restart(page);
  const beforeRoll = await snapshot(page);
  await clickWorld(page, 4, 1, { double: true });
  await until(page, state => state.sp < beforeRoll.sp - 3, 4000, 'roll SP cost');
  await until(page, state => Math.hypot(state.playerPosition.x - beforeRoll.playerPosition.x, state.playerPosition.z - beforeRoll.playerPosition.z) > 1.5, 5000, 'roll movement');
  record('Double click rolls and consumes SP');

  await restart(page);
  const beforeHold = await snapshot(page);
  const holdPoint = await page.evaluate(() => window.__undeadSlayer.worldToScreen(0, 0));
  await page.mouse.move(holdPoint.x, holdPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(850);
  await page.mouse.up();
  const heavy = await until(page, state => state.sp < beforeHold.sp - 3, 5000, 'long press EX attack');
  for (const joint of ['body', 'head', 'leftArm', 'rightArm', 'leftForearm', 'rightForearm', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin']) {
    assert(heavy.pose[joint], `The character needs an articulated ${joint} joint`);
  }
  const poseDifference = ['body', 'rightArm', 'rightForearm', 'leftLeg', 'rightLeg'].reduce((sum, joint) =>
    sum + ['x', 'y', 'z'].reduce((difference, axis) => difference + Math.abs(heavy.pose[joint][axis] - beforeHold.pose[joint][axis]), 0), 0);
  assert(poseDifference > .4, 'Heavy attack must animate the articulated body and limbs');
  const impact = heavy.action === 'heavy' && heavy.actionProgress >= .55 && heavy.effects > 0 ? heavy
    : await until(page, state => state.action === 'heavy' && state.actionProgress >= .55 && state.effects > 0, 5000, 'heavy attack impact effects');
  assert(impact.effects > 0, 'Heavy attack must produce visible effects at impact');
  assert(heavy.renderInfo.calls > 0 && heavy.renderInfo.triangles > 0, 'Character and battlefield must render real mesh geometry');
  record('Long press EX attack consumes SP, animates the skeleton and produces effects', `${heavy.renderInfo.calls} draw calls, ${heavy.renderInfo.triangles} triangles`);

  await restart(page);
  const beforeSwipe = await snapshot(page);
  const swipePoint = await page.evaluate(() => window.__undeadSlayer.worldToScreen(0, 0));
  await page.mouse.move(swipePoint.x - 75, swipePoint.y);
  await page.mouse.down();
  await page.mouse.move(swipePoint.x + 75, swipePoint.y);
  await page.mouse.up();
  const afterSwipe = await until(page, state => state.sp < beforeSwipe.sp - 3, 5000, 'swipe finisher');
  assert.equal(afterSwipe.cooldowns.burst, 0, 'Swipe finisher must be independent of the burst skill cooldown');
  record('150px swipe finisher consumes SP without starting burst cooldown');

  for (const skill of ['dash', 'whirl', 'burst', 'frost', 'blades']) {
    await restart(page);
    const before = await snapshot(page);
    if (skill === 'dash') await page.keyboard.press('q');
    else await skillButton(page, skill).click();
    const after = await until(page, state => state.cooldowns[skill] > 0, 5000, `${skill} cooldown`);
    assert(after.sp < before.sp, `${skill} must consume SP`);
    record(`Skill ${skill} consumes SP and starts cooldown`, `${after.cooldowns[skill].toFixed(1)}s${skill === 'dash' ? ', keyboard Q' : ''}`);
  }

  await restart(page);
  await page.locator('#pause-button').click();
  await page.locator('#pause-screen').waitFor({ state: 'visible' });
  const paused = await snapshot(page);
  assert(paused.paused, 'Pause state must be set');
  await page.waitForTimeout(1200);
  const stillPaused = await snapshot(page);
  assert.equal(stillPaused.elapsed, paused.elapsed, 'Pause must freeze game time');
  assert.equal(stillPaused.hp, paused.hp, 'Pause must freeze combat');
  await page.locator('#resume-button').click();
  await until(page, state => !state.paused && state.elapsed > paused.elapsed + .1, 10000, 'resume');
  record('Pause freezes elapsed and HP; resume continues time');

  const soundBefore = await page.locator('#audio-button').getAttribute('aria-pressed');
  await page.locator('#audio-button').click();
  const soundAfter = await page.locator('#audio-button').getAttribute('aria-pressed');
  assert.notEqual(soundAfter, soundBefore, 'Sound button must expose a changed pressed state');
  await page.locator('#audio-button').click();
  record('Sound toggle changes accessible state');

  await restart(page);
  await until(page, state => state.enemies > 0, 10000, 'enemy wave spawn');
  const enemiesBefore = await page.evaluate(() => window.__undeadSlayer.enemyPositions());
  assert(enemiesBefore.length > 0, 'Start must spawn enemies');
  const combatStart = await snapshot(page);
  await until(page, state => state.hp < combatStart.hp || state.kills > 0, 35000, 'enemy pursuit/combat');
  const combat = await snapshot(page);
  record('Enemies pursue and produce combat damage or kills', `HP ${combat.hp}, kills ${combat.kills}`);
  await page.screenshot({ path: `${output}/gameplay-desktop.png`, fullPage: true });

  await restart(page);
  const result = await fight(page);
  assert(result.kills > 0, 'Real gameplay must defeat enemies');
  assert(['won', 'victory', 'success', 'complete', 'completed'].includes(result.phase), `Real gameplay must win the level: ${JSON.stringify(result)}`);
  assert.equal(result.wave, 3, 'Victory must complete all three waves');
  assert.equal(result.kills, 19, 'Victory must defeat all 19 enemies including the boss');
  const expectedStars = 1 + Number(result.elapsed <= 180) + Number(result.hits < 2);
  assert.equal(result.stars, expectedStars, 'Star rating must match completion, time, and hits');
  assert.equal(await page.locator('#result-stars').textContent(), '★'.repeat(expectedStars) + '☆'.repeat(3 - expectedStars));
  await page.locator('#result-screen').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/result.png`, fullPage: true });
  record('Real combat wins all 3 waves and boss with correct star rating', `phase ${result.phase}, wave ${result.wave}, kills ${result.kills}, HP ${result.hp}, ${result.stars} stars, hits ${result.hits}`);
  await restart(page);
  record('Result restart restores HP 100, SP 100 and kills 0');
  await desktop.close();

  for (const [label, viewport] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }]]) {
    const mobile = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await mobileChecks(mobile, label);
  }
  assert.deepEqual(errors, [], 'Browser must not report JavaScript or console errors');
  record('No browser JavaScript or console errors');
  console.log(`\n${checks.length} browser checks passed. Screenshots saved in ${output}/.`);
} catch (error) {
  console.error(error.stack || error);
  if (errors.length) console.error('Browser errors:', errors);
  const failedPage = browser?.contexts().flatMap(context => context.pages()).find(page => !page.isClosed());
  if (failedPage) await failedPage.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
