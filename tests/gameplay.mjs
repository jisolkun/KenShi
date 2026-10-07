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

async function restart(page) {
  const state = await snapshot(page);
  if (await page.locator('#result-screen').isVisible()) {
    await page.locator('#result-restart').click();
  } else {
    if (!state.paused) await page.locator('#pause-button').click();
    await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.locator('#restart-button').click();
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

function skillButton(page, skill) {
  return page.locator(`[data-skill="${skill}"], #skill-${skill}`).first();
}

async function fight(page, timeout = 210000) {
  const began = Date.now();
  let lastAttack = 0;
  let lastReport = 0;
  let lastState;
  while (Date.now() - began < timeout) {
    const state = await snapshot(page);
    lastState = state;
    if (Date.now() - lastReport > 15000) {
      console.log(`COMBAT wave ${state.wave}, kills ${state.kills}, HP ${state.hp}, SP ${state.sp}, elapsed ${state.elapsed}s`);
      lastReport = Date.now();
    }
    if (await page.locator('#result-screen').isVisible()) return state;
    const enemies = await page.evaluate(() => window.__undeadSlayer.enemyPositions());
    if (enemies.length) {
      const p = state.playerPosition;
      enemies.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const target = enemies[0];
      const point = await page.evaluate(({ x, z }) => window.__undeadSlayer.worldToScreen(x, z), target);
      const size = page.viewportSize();
      if (point.x > 20 && point.x < size.width - 180 && point.y > 130 && point.y < size.height - 80) {
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
  await until(page, state => state.sp < beforeHold.sp - 3, 5000, 'long press EX attack');
  record('Long press EX attack consumes SP');

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

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobilePage = await open(mobile);
  await mobilePage.locator('#start-button').tap();
  await mobilePage.locator('#start-screen').waitFor({ state: 'hidden' });
  const mobileBefore = await snapshot(mobilePage);
  await clickWorld(mobilePage, 2, 2, { touch: true });
  await until(mobilePage, state => Math.hypot(state.playerPosition.x - mobileBefore.playerPosition.x, state.playerPosition.z - mobileBefore.playerPosition.z) > .75, 10000, 'touch movement');
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Mobile viewport must not overflow');
  await mobilePage.screenshot({ path: `${output}/gameplay-mobile.png`, fullPage: true });
  record('Mobile touch moves player and viewport has no overflow');
  await mobile.close();
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
