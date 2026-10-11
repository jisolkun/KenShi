import test from 'node:test';
import assert from 'node:assert/strict';
import { HAMMER_STEPS, GREAT_DAO_STEPS, getHeavyWeaponSteps, heavyWeaponStepDelta,
  heavyWeaponStepProgress, hammerStepDelta, greatDaoStepDelta, greatDaoStepProgress,
  greatDaoTargetGap, resolveGreatDaoStep } from '../src/greatDaoMovement.js';
import {getReviewedAttack} from '../src/choreography/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} differs from ${b}`);
function travel(combo, rate, { frozen = false, obstacles = [], targets = [] } = {}) {
  let position = { x: 0, z: 0 }, phase = 0;
  const path = [position];
  while (phase < 1 - 1e-10) {
    if (frozen) {
      const freeze = heavyWeaponStepDelta('great-hammer', combo, phase, phase);
      assert.deepEqual(resolveGreatDaoStep(position, { x: freeze.lateral, z: freeze.forward }), position);
    }
    const next = Math.min(1, phase + 1 / rate), step = hammerStepDelta(combo, phase, next);
    position = resolveGreatDaoStep(position, { x: step.lateral, z: step.forward }, { obstacles, targets });
    path.push(position); phase = next;
  }
  return { position, path };
}

test('hammer chain uses a broad entry sweep, short ground step, wide pivot and planted final stomp', () => {
  const positions = [0, 1, 2, 3].map(combo => travel(combo, 120).position);
  for (const position of positions) assert.ok(position.z > .05);
  assert.ok(positions[0].x > .1 && positions[2].x < -.1,
    'the diagonal entry and broad return sweep step to opposing sides');
  assert.ok(Math.abs(positions[1].x)<Math.abs(positions[0].x),
    'the diagonal ground step is shorter sideways than the broad opening sweep');
  close(positions[3].x, 0);
  assert.ok(positions[1].z < positions[0].z && positions[1].z < positions[2].z,
    'the quick ground follow-up stays compact instead of repeating the broad sweep step');
  assert.ok(positions[2].z > positions[0].z && positions[2].z > positions[3].z,
    'the body pivot has a visibly wider travel budget than the planted finisher');
  const advance=positions.reduce((total,position)=>total+position.z,0);
  assert.ok(advance>=1.4&&advance<=1.7,'the fast four-stroke chain visibly advances into the crowd');
});

test('each hammer root step settles before its area pulse or ground impact', () => {
  for (let combo = 0; combo < 4; combo++) {
    const action = getReviewedAttack('great-hammer', combo);
    const start = action.contact;
    const preparation = hammerStepDelta(combo, 0, start);
    assert.ok(preparation.forward > .05, 'there is a visible step into the loaded attack');
    close(preparation.forward, HAMMER_STEPS[combo].forward);
    close(preparation.lateral, HAMMER_STEPS[combo].lateral);
    const impact = hammerStepDelta(combo, start, 1), settled = hammerStepDelta(combo, 1, 1.5);
    assert.ok(impact.forward === 0 && impact.lateral === 0,
      'the hammer does not drag its planted feet forward during active impact');
    assert.ok(settled.forward === 0 && settled.lateral === 0);
  }
});

test('hammer root movement is consistent across sample rates and contact freezes', () => {
  for (let combo = 0; combo < 4; combo++) {
    const reference = travel(combo, 120).position;
    for (const rate of [30, 60, 120]) {
      const actual = travel(combo, rate, { frozen: true }).position;
      close(actual.x, reference.x); close(actual.z, reference.z);
    }
  }
});

test('every hammer root step stays outside stone lamps and the enemy body gap', () => {
  const obstacles = [{ x: .5, z: .8, radius: .2 }];
  const targets = [{ x: -.1, z: 1.7, radius: .45 }];
  for (let combo = 0; combo < 4; combo++) {
    const { path } = travel(combo, 30, { obstacles, targets });
    for (let i = 1; i < path.length; i++) for (let sample = 0; sample <= 10; sample++) {
      const t = sample / 10, p = { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        z: path[i - 1].z + (path[i].z - path[i - 1].z) * t };
      for (const obstacle of obstacles) assert.ok(Math.hypot(p.x - obstacle.x, p.z - obstacle.z) >= obstacle.radius + .5 - 1e-6);
      for (const target of targets) assert.ok(Math.hypot(p.x - target.x, p.z - target.z) >= greatDaoTargetGap(target.radius) - 1e-6);
    }
  }
});

test('generic heavy movement APIs preserve every existing great dao step and phase exactly', () => {
  assert.equal(getHeavyWeaponSteps('great-dao'), GREAT_DAO_STEPS);
  assert.equal(getHeavyWeaponSteps('great-hammer'), HAMMER_STEPS);
  for (let combo = 0; combo < 4; combo++) for (const phase of [0, .06, .24, .40, .55, .76, 1]) {
    assert.deepEqual(heavyWeaponStepDelta('great-dao', combo, 0, phase), greatDaoStepDelta(combo, 0, phase));
    assert.equal(heavyWeaponStepProgress('great-dao', phase), greatDaoStepProgress(phase));
  }
  assert.equal(getHeavyWeaponSteps('dual-dao'), null);
  assert.deepEqual(heavyWeaponStepDelta('dual-dao', 0, 0, 1), { forward: 0, lateral: 0 });
});
