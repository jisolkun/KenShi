import assert from 'node:assert/strict';
import test from 'node:test';
import { greatDaoStepDelta, greatDaoTargetGap, resolveGreatDaoStep } from '../src/greatDaoMovement.js';
import { getWeapon } from '../src/weapons.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const frameSchedule = (duration, fps) => {
  const frames = [];
  for (let elapsed = 0; elapsed < duration - 1e-10;) {
    const dt = Math.min(1 / fps, duration - elapsed);
    frames.push(dt); elapsed += dt;
  }
  return frames;
};

// This simulation exercises only the pure travel/collision API. Input commands,
// facing, target selection and the main animation state machine are separate.
function simulate(combo, { frames = null, substeps = false, freezes = false,
  start = { x: 0, z: 0 }, resolve = {}, changeTargets = null } = {}) {
  const duration = getWeapon('great-dao').moves[combo].duration;
  frames ||= frameSchedule(duration, 60);
  let position = { ...start }, elapsed = 0, phase = 0;
  const positions = [{ ...position }];
  const step = dt => {
    const nextPhase = Math.min(1, (elapsed + dt) / duration);
    const delta = greatDaoStepDelta(combo, phase, nextPhase);
    const options = changeTargets ? { ...resolve, targets: changeTargets(nextPhase) } : resolve;
    position = resolveGreatDaoStep(position, { x: delta.lateral, z: delta.forward }, options);
    positions.push({ ...position }); elapsed += dt; phase = nextPhase;
  };
  for (const frame of frames) {
    if (freezes) for (let i = 0; i < 3; i++) step(0);
    for (let remaining = frame; remaining > 1e-10;) {
      const dt = substeps ? Math.min(remaining, 1 / 120) : remaining;
      step(dt); remaining -= dt;
    }
  }
  return { position, positions };
}

function assertClearSegment(start, end, { obstacles = [], targets = [], bounds = null, clearance = .5 }) {
  for (let sample = 0; sample <= 100; sample++) {
    const t = sample / 100, point = { x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t };
    if (bounds) assert.ok(point.x >= bounds.minX + clearance - 1e-6 &&
      point.x <= bounds.maxX - clearance + 1e-6 && point.z >= bounds.minZ + clearance - 1e-6 &&
      point.z <= bounds.maxZ - clearance + 1e-6, 'an intermediate root position leaves the battlefield');
    for (const obstacle of obstacles) assert.ok(distance(point, obstacle) >= obstacle.radius + clearance - 1e-6,
      'the physical root path intersects a stone prop');
    for (const target of targets) assert.ok(distance(point, target) >= greatDaoTargetGap(target.radius) - 1e-6,
      'the physical root path intersects an enemy');
  }
}

test('all four strokes move the real root forward with alternating side steps and a strongest final stomp', () => {
  const ends = [0, 1, 2, 3].map(combo => simulate(combo).position);
  for (const end of ends) assert.ok(end.z > .25 && Math.abs(end.x) > .04,
    'a local waist pose alone cannot satisfy actual root travel');
  assert.ok(ends[0].x > 0 && ends[1].x < 0 && ends[2].x > 0 && ends[3].x < 0);
  assert.ok(ends[3].z > Math.max(...ends.slice(0, 3).map(end => end.z)));
  for (let combo = 0; combo < 4; combo++) {
    const settled = simulate(combo, { frames: frameSchedule(getWeapon('great-dao').moves[combo].duration * 1.5, 60) });
    close(settled.position.x, ends[combo].x);
    close(settled.position.z, ends[combo].z);
    for (let i = 1; i < settled.positions.length; i++) assert.ok(
      settled.positions[i].z >= settled.positions[i - 1].z - 1e-8, 'recovery must not pull the character back');
  }
});

test('root travel starts slowly, accelerates into the step and brakes before the authored recovery ends', () => {
  const wind = greatDaoStepDelta(0, .06, .24).forward / (.24 - .06);
  const release = greatDaoStepDelta(0, .24, .55).forward / (.55 - .24);
  const brake = greatDaoStepDelta(0, .55, .76).forward / (.76 - .55);
  assert.ok(release > wind * 2 && release > brake * 2);
  const beforeRecoveryEnd = greatDaoStepDelta(0, 0, .8);
  const afterRecoveryEnd = greatDaoStepDelta(0, 0, 1);
  close(beforeRecoveryEnd.forward, afterRecoveryEnd.forward);
  close(beforeRecoveryEnd.lateral, afterRecoveryEnd.lateral);
});

test('30, 60, 120 Hz and 250 ms display frames with substeps reach the same root endpoint', () => {
  for (let combo = 0; combo < 4; combo++) {
    const duration = getWeapon('great-dao').moves[combo].duration;
    const reference = simulate(combo, { frames: frameSchedule(duration, 120) }).position;
    for (const fps of [30, 60, 120, 4]) {
      const result = simulate(combo, { frames: frameSchedule(duration, fps),
        substeps: fps === 4, freezes: true }).position;
      close(result.x, reference.x);
      close(result.z, reference.z);
    }
  }
});

test('zero phase advance during a contact freeze preserves the exact root position', () => {
  const position = simulate(2, { frames: [.18] }).position;
  const phase = .18 / getWeapon('great-dao').moves[2].duration;
  const frozen = greatDaoStepDelta(2, phase, phase);
  for (let step = 0; step < 30; step++) assert.deepEqual(resolveGreatDaoStep(position,
    { x: frozen.lateral, z: frozen.forward }), position);
});

test('every intermediate position respects battlefield edges and nearby props or enemies', () => {
  const cases = [
    { start: { x: -3, z: -2 }, displacement: { x: 8, z: 6 }, bounds: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 } },
    { start: { x: -4, z: 0 }, displacement: { x: 10, z: .3 }, obstacles: [{ x: 0, z: 0, radius: .57 }] },
    { start: { x: 0, z: -4 }, displacement: { x: .3, z: 10 }, targets: [{ x: 0, z: 0, radius: 1 }] },
    { start: { x: -4, z: -3 }, displacement: { x: 9, z: 5 },
      obstacles: [{ x: -1, z: -1, radius: .93 }, { x: 2, z: 1, radius: .57 }],
      targets: [{ x: 0, z: 0, radius: .75 }], bounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 4 } },
  ];
  for (const scenario of cases) {
    const end = resolveGreatDaoStep(scenario.start, scenario.displacement, scenario);
    assertClearSegment(scenario.start, end, scenario);
    assert.ok(distance(scenario.start, end) <= Math.hypot(scenario.displacement.x, scenario.displacement.z) + 1e-6);
  }
});

test('a fast root step stops on the original side of a lamp instead of projecting through it', () => {
  const options = { obstacles: [{ x: 0, z: 0, radius: .57 }] };
  for (const side of [-1, 1]) {
    const start = { x: side * 3, z: 0 }, displacement = { x: -side * 7, z: 0 };
    const end = resolveGreatDaoStep(start, displacement, options);
    assert.ok(end.x * side > 1, 'the root must remain on its original side of the stone lamp');
    assertClearSegment(start, end, options);
  }
});

test('an enemy already overlapping the hero permits escape or tangent motion but never a path through its centre', () => {
  const target = { x: 0, z: 0, radius: .45 }, start = { x: .5, z: 0 };
  for (const displacement of [{ x: 2, z: .3 }, { x: 0, z: 1 }]) {
    const end = resolveGreatDaoStep(start, displacement, { targets: [target] });
    assert.ok(distance(end, target) > distance(start, target));
    let previousDistance = distance(start, target);
    for (let sample = 1; sample <= 100; sample++) {
      const t = sample / 100, point = { x: start.x + (end.x - start.x) * t, z: end.z * t };
      assert.ok(distance(point, target) >= previousDistance - 1e-8, 'escaping must never deepen the overlap');
      previousDistance = distance(point, target);
    }
  }
  assert.deepEqual(resolveGreatDaoStep(start, { x: -2, z: .1 }, { targets: [target] }), start);
});

test('a planted hero at the target gap still has room for lateral footwork', () => {
  const target = { x: 0, z: 0, radius: .45 };
  const start = { x: 0, z: -greatDaoTargetGap(target.radius) };
  for (const side of [-1, 1]) {
    const end = resolveGreatDaoStep(start, { x: side * .2, z: 0 }, { targets: [target] });
    assert.ok(Math.abs(end.x) > .15, 'being in range must not prevent a safe sideways step');
    assertClearSegment(start, end, { targets: [target] });
  }
});

test('target knockback opens space for following steps and a removed target does not change the stored step direction', () => {
  const target = { x: 0, z: 1.25, radius: .45 };
  const blocked = simulate(3, { resolve: { targets: [target] } });
  const knocked = simulate(3, { changeTargets: phase => [{ ...target, z: phase < .45 ? target.z : 2.8 }] });
  const removed = simulate(3, { changeTargets: phase => phase < .45 ? [target] : [] });
  assert.ok(knocked.position.z > blocked.position.z + .15, 'actual enemy displacement frees room to advance');
  assert.ok(removed.position.z > blocked.position.z + .15, 'a dead target no longer blocks the ongoing step');
  for (const result of [knocked, removed]) {
    for (let i = 1; i < result.positions.length; i++) {
      assert.ok(result.positions[i].z >= result.positions[i - 1].z - 1e-8);
      assert.ok(result.positions[i].x <= result.positions[i - 1].x + 1e-8, 'the ongoing left stomp does not reverse direction');
    }
  }
});
