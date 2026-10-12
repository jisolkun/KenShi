import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import {
  SOURCE_HERO_RULES, createHeroControl, resetHeroControl, resetHeroAttackFamily,
  sampleHeroMovement, stepHeroMovement, selectHeroAttack, startHeroAttack,
  stepHeroCombo, clearHeroCombo, setHeroLocomotion, disableHeroSensor,
} from '../src/referenceHeroControl.js';

const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const origin = { x: 0, z: 0 };

test('a released far tap coasts to a stop without following the saved point', () => {
  const control = createHeroControl(), position = { ...origin };
  sampleHeroMovement(control, position, { x: 0, z: 100 });
  let angle = 0;
  for (let i = 0; i < 600; i++) {
    const step = stepHeroMovement(control, angle, 1 / 60, 6);
    position.x += step.direction.x * step.distance;
    position.z += step.direction.z * step.distance;
    angle = step.angle;
  }
  assert.ok(position.z > 2 && position.z < 20,
    'a single sample spends its speed factor rather than running 100 units');
  assert.equal(control.locomotion, 'idle');
  assert.deepEqual(control.direction, { x: 0, z: 0 });
  assert.equal(stepHeroMovement(control, angle, 1, 6).distance, 0);
});

test('near input stops and the closed middle band preserves direction and factor', () => {
  const control = createHeroControl();
  sampleHeroMovement(control, origin, { x: 3, z: 4 });
  assert.deepEqual(control.direction, { x: .6, z: .8 });
  assert.equal(control.speedFactor, 6.5);
  control.speedFactor = 3;
  for (const distance of [.625, .8, 1]) {
    sampleHeroMovement(control, origin, { x: -distance, z: 0 });
    assert.deepEqual(control.direction, { x: .6, z: .8 });
    assert.equal(control.speedFactor, 3);
  }
  sampleHeroMovement(control, origin, { x: .624, z: 0 });
  assert.deepEqual(control.direction, { x: 0, z: 0 });
  assert.equal(control.speedFactor, 3, 'stopping does not reset or decay the factor');
  stepHeroMovement(control, 0, 1, 6);
  assert.equal(control.speedFactor, 3);
});

test('run/walk threshold uses the old factor and walk speed uses the decremented factor', () => {
  const control = createHeroControl();
  control.direction = { x: 0, z: 1 };
  control.speedFactor = 4.6;
  const lastRun = stepHeroMovement(control, 0, .1, 6);
  assert.equal(lastRun.action, 'run');
  assert.equal(lastRun.speed, 6);
  close(control.speedFactor, 4.4);
  const walk = stepHeroMovement(control, 0, .1, 6);
  assert.equal(walk.action, 'walk');
  close(walk.speed, 4.2 / 12 * 12.5);
  close(walk.distance, walk.speed * .1);
  control.speedFactor = SOURCE_HERO_RULES.stopThreshold;
  assert.equal(stepHeroMovement(control, 0, .01, 6).action, 'walk');
  assert.deepEqual(control.direction, { x: 0, z: 0 });
  assert.equal(stepHeroMovement(control, 0, .01, 6).action, 'idle');
});

test('turning matches independently normalized yaw quaternions across the angle boundary', () => {
  const control = createHeroControl();
  const start = 170 * Math.PI / 180, target = -150 * Math.PI / 180;
  control.direction = { x: Math.sin(target), z: Math.cos(target) };
  const mix = .4, dt = mix / SOURCE_HERO_RULES.turnRate;
  const axis = new Vector3(0, 1, 0);
  const from = new Quaternion().setFromAxisAngle(axis, start);
  const to = new Quaternion().setFromAxisAngle(axis, target);
  if (from.dot(to) < 0) to.set(-to.x, -to.y, -to.z, -to.w);
  const blended = new Quaternion(
    from.x * (1 - mix) + to.x * mix,
    from.y * (1 - mix) + to.y * mix,
    from.z * (1 - mix) + to.z * mix,
    from.w * (1 - mix) + to.w * mix,
  ).normalize();
  const forward = new Vector3(0, 0, 1).applyQuaternion(blended);
  close(stepHeroMovement(control, start, dt, 6).angle, Math.atan2(forward.x, forward.z));
  close(stepHeroMovement(control, start, 1, 6).angle, target);
});

test('only run/walk state entries re-enable an interrupted attack sensor', () => {
  const control = createHeroControl();
  control.sensorInside.add(7);
  disableHeroSensor(control);
  assert.equal(control.sensorEnabled, false);
  assert.equal(control.sensorInside.size, 0);
  setHeroLocomotion(control, 'idle');
  assert.equal(control.sensorEnabled, false);
  setHeroLocomotion(control, 'run');
  assert.equal(control.sensorEnabled, true);
  control.sensorInside.add(7);
  setHeroLocomotion(control, 'run');
  assert.deepEqual([...control.sensorInside], [7], 'observing the same run does not reset entry history');
  setHeroLocomotion(control, 'walk');
  assert.equal(control.sensorInside.size, 0);
  disableHeroSensor(control);
  setHeroLocomotion(control, 'walk');
  assert.equal(control.sensorEnabled, true);
});

test('the shared four-stroke cursor advances only at selection and preserves its input gate', () => {
  const control = createHeroControl();
  control.direction = { x: -1, z: 0 };
  assert.equal(selectHeroAttack(control), 1);
  assert.deepEqual(control.direction, { x: -1, z: 0 });
  assert.equal(control.sensorEnabled, false);
  startHeroAttack(control, 1, Math.PI / 2);
  close(control.direction.x, 1);
  close(control.direction.z, 0);
  assert.equal(control.speedFactor, 5.2);
  assert.deepEqual([selectHeroAttack(control), selectHeroAttack(control), selectHeroAttack(control)], [2, 3, 0]);
  assert.equal(control.cursor, 0);
  stepHeroCombo(control, .1, { attacking: true, combo: 0 });
  assert.equal(control.cursor, 0, 'ticking an animation never selects another attack');
});

test('active ordinary strokes refresh the shared half-second clock and the final stroke does not', () => {
  const control = createHeroControl();
  control.comboTime = .1;
  stepHeroCombo(control, .2, { attacking: true, combo: 1 });
  assert.equal(control.comboTime, 1);
  stepHeroCombo(control, .25, { attacking: true, combo: 1, recovering: true });
  close(control.comboTime, .5);
  assert.equal(selectHeroAttack(control), 1, 'cursor started at 0 and remains inside the combo window');
  stepHeroCombo(control, .25, { recovering: true });
  assert.equal(control.comboTime, 0);
  assert.equal(selectHeroAttack(control), 0, 'the exact half-second boundary returns to the first stroke');
  control.comboTime = .4;
  stepHeroCombo(control, .2, { attacking: true, combo: 3 });
  close(control.comboTime, .4);
  stepHeroCombo(control, .5, { attacking: true, combo: 3, recovering: true });
  assert.ok(control.comboTime < 0, 'the source clock remains signed');
});

test('damage clears only combo time, weapon changes reset only the cursor, and a game reset clears all state', () => {
  const control = createHeroControl();
  control.cursor = 3;
  clearHeroCombo(control);
  assert.equal(control.cursor, 3);
  assert.equal(control.comboTime, 0);
  control.comboTime = .4;
  resetHeroAttackFamily(control);
  assert.equal(control.cursor, 0);
  assert.equal(control.comboTime, .4);
  disableHeroSensor(control);
  control.direction = { x: 1, z: 0 };
  resetHeroControl(control);
  assert.deepEqual(control, createHeroControl());
  assert.equal(createHeroControl({ comboCount: 5 }).comboCount, 5);
});

// When the user's extracted archive is available, compare an entire released
// tap trajectory with its actual standalone movement module. Replacing only
// the punch-pose import avoids importing the unrelated Unity rig subsystem.
let originalMovement;
try {
  const source = await readFile(new URL('../../original-src/src/reference-player-movement.js', import.meta.url), 'utf8');
  const isolated = source.replace(
    "import {lerpReferencePunchRootPose} from './reference-punch-clock.js';",
    'const lerpReferencePunchRootPose = () => false;',
  );
  originalMovement = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

test('ordinary input and movement stay frame-identical to the uploaded original module', {
  skip: originalMovement ? false : 'the uploaded reference archive is not part of this repository',
}, () => {
  const control = createHeroControl();
  const source = { ...originalMovement.createPlayerMovementState(),
    x: 0, z: 0, facing: 2.8, speed: 6, action: 'idle' };
  const position = { x: 0, z: 0 };
  let angle = source.facing;
  const samples = new Map([[0, { x: 9, z: -10 }], [80, { x: 1, z: 2 }],
    [160, { x: .8, z: 0 }], [170, { x: .624, z: 0 }], [190, { x: -20, z: 3 }]]);
  for (let frame = 0; frame < 500; frame++) {
    const relative = samples.get(frame);
    if (relative) {
      const point = { x: position.x + relative.x, z: position.z + relative.z };
      sampleHeroMovement(control, position, point);
      originalMovement.samplePlayerMovement(source, point);
    }
    const dt = frame % 3 === 0 ? 1 / 30 : 1 / 60;
    const actual = stepHeroMovement(control, angle, dt, 6);
    const expected = originalMovement.playerMovementStep(source, dt);
    assert.equal(actual.action, expected.action, `frame ${frame}`);
    close(actual.speed, expected.speed);
    close(actual.distance, expected.distance);
    close(actual.angle, source.facing);
    close(control.speedFactor, source.speedFactor);
    assert.deepEqual(control.direction, source.moveDirection);
    position.x += actual.direction.x * actual.distance;
    position.z += actual.direction.z * actual.distance;
    source.x = position.x;
    source.z = position.z;
    source.action = expected.action;
    angle = actual.angle;
  }
});
