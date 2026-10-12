import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { getSourceAttackProfile } from '../src/sourceMotion/catalogue.js';
import { sampleReferenceCurveMotion } from '../src/sourceMotion/sampler.js';

const weapons = ['dual-dao', 'tang-dao', 'great-dao', 'great-hammer'];
const sourceBones = rig => [rig.body, rig.chest, rig.head,
  ...rig.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.wrist]),
  ...rig.legs.flatMap(leg => [leg.hip, leg.knee, leg.foot])];
const transforms = rig => rig.bind.map(({ node }) => [
  ...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray(),
]);
const worldPose = node => ({ p: node.getWorldPosition(new THREE.Vector3()),
  q: node.getWorldQuaternion(new THREE.Quaternion()) });
const displacement = (node, origin) => node.getWorldPosition(new THREE.Vector3()).distanceTo(origin.p)
  + node.getWorldQuaternion(new THREE.Quaternion()).angleTo(origin.q);
function finiteRig(rig) {
  for (const { node } of rig.bind) {
    assert.ok([...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]
      .every(Number.isFinite), `${rig.weaponId}: ${node.name} has an invalid transform`);
    assert.ok(Math.abs(node.quaternion.length() - 1) < 1e-7,
      `${rig.weaponId}: ${node.name} rotation must stay normalized`);
  }
  assert.ok(rig.sourcePose.footMinY >= -1e-7, `${rig.weaponId}: a source pose penetrates the floor`);
}

test('retargeted dual and blade attacks preserve every original bone rotation', () => {
  const rig = createCharacter('hero');
  rig.group.rotation.y = .71;
  for (const id of ['dual-dao', 'tang-dao', 'great-dao']) {
    rig.setWeapon(id);
    for (let combo = 0; combo < 5; combo++) for (const phase of [0, .17, .39, .61, .83, 1]) {
      const profile = getSourceAttackProfile(id, combo);
      const expected = sampleReferenceCurveMotion(profile, phase).frame.slice();
      poseCharacter(rig, { state: 'attack', combo, phase, dt: 1 / 60, immediate: true });
      rig.group.updateMatrixWorld(true);
      const rootInverse = rig.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const [i, bone] of sourceBones(rig).entries()) {
        const native = new THREE.Quaternion().fromArray(expected, 3 + i * 4).normalize();
        const actual = rootInverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        assert.ok(native.angleTo(actual) < 1e-6,
          `${id} attack ${combo + 1} phase ${phase}: ${bone.name} differs from the original clip`);
      }
      finiteRig(rig);
    }
  }
});

test('walk and run animate torso, head, both arms and both legs for every weapon', () => {
  for (const id of weapons) for (const state of ['walk', 'run']) {
    const rig = createCharacter('hero');
    rig.setWeapon(id);
    // Let the source crossfade finish before measuring the actual gait cycle.
    for (let i = 0; i < 25; i++) poseCharacter(rig, { state, dt: 1 / 60, time: i / 60, speedFactor: 7 });
    const nodes = [rig.body, rig.chest, rig.head,
      ...rig.arms.map(arm => arm.wrist), ...rig.legs.map(leg => leg.foot)];
    const origins = nodes.map(worldPose);
    const movement = nodes.map(() => 0);
    for (let i = 25; i < 115; i++) {
      poseCharacter(rig, { state, dt: 1 / 60, time: i / 60, speedFactor: 7 });
      rig.group.updateMatrixWorld(true);
      nodes.forEach((node, j) => { movement[j] = Math.max(movement[j], displacement(node, origins[j])); });
      finiteRig(rig);
    }
    nodes.forEach((node, j) => assert.ok(movement[j] > .015,
      `${id} ${state}: ${node.name} remains frozen throughout the gait cycle`));
  }
});

test('all five ordinary attacks drive the complete body and stay finite', () => {
  for (const id of weapons) for (let combo = 0; combo < 5; combo++) {
    const rig = createCharacter('hero');
    rig.setWeapon(id);
    poseCharacter(rig, { state: 'attack', combo, phase: 0, dt: 1 / 60, immediate: true });
    const nodes = [rig.body, rig.chest, rig.head,
      ...rig.arms.map(arm => arm.wrist), ...rig.legs.map(leg => leg.foot)];
    const origins = nodes.map(worldPose);
    const movement = nodes.map(() => 0);
    for (let i = 1; i <= 60; i++) {
      poseCharacter(rig, { state: 'attack', combo, phase: i / 60, dt: 1 / 60, immediate: true });
      nodes.forEach((node, j) => { movement[j] = Math.max(movement[j], displacement(node, origins[j])); });
      finiteRig(rig);
    }
    nodes.forEach((node, j) => assert.ok(movement[j] > .03,
      `${id} attack ${combo + 1}: ${node.name} remains frozen throughout the attack`));
  }
});

test('pause freezes source joints and blend clocks, and weapon switches reset them', () => {
  const rig = createCharacter('hero');
  poseCharacter(rig, { state: 'run', time: 1, dt: .2, speedFactor: 7 });
  poseCharacter(rig, { state: 'run', time: 1.2, dt: .2, speedFactor: 7 });
  const before = transforms(rig);
  const debug = structuredClone(rig.sourceMotionDebug);
  const runtime = rig.sourceMotionState;
  for (let i = 0; i < 5; i++) poseCharacter(rig, { state: 'run', time: 10 + i, dt: 0, speedFactor: 7 });
  assert.deepEqual(transforms(rig), before);
  assert.deepEqual(rig.sourceMotionDebug, debug);
  rig.setWeapon('great-hammer');
  assert.notEqual(rig.sourceMotionState, runtime);
  assert.equal(rig.sourceMotionDebug.state, 'idle');
  assert.equal(rig.sourceMotionDebug.rawTime, 0);
  finiteRig(rig);
  poseCharacter(rig, { state: 'run', time: 20, dt: .2, speedFactor: 7 });
  poseCharacter(rig, { state: 'run', time: 20.2, dt: .2, speedFactor: 7 });
  assert.ok(rig.sourceMotionDebug.locomotion.some(clip => clip.rawTime > 0));
});

test('hurt and roll release source ownership and locomotion resumes afterward', () => {
  const rig = createCharacter('hero');
  for (const state of ['hurt', 'roll']) {
    poseCharacter(rig, { state: 'attack', combo: 1, phase: .4, dt: 1 / 60, immediate: true });
    poseCharacter(rig, { state, phase: .1, time: 1, dt: 1 / 60 });
    assert.equal(rig.sourcePose.active, false);
    assert.equal(rig.sourceMotionDebug.active, false);
    poseCharacter(rig, { state, phase: .5, time: 1.1, dt: 1 / 60 });
    poseCharacter(rig, { state: 'run', time: 1.2, dt: 1 / 60, speedFactor: 7 });
    assert.equal(rig.sourcePose.active, true);
    assert.equal(rig.sourceMotionDebug.state, 'run');
    finiteRig(rig);
  }
});

test('authored hammer keeps both hands on its shaft and the solid head above the floor', () => {
  const rig = createCharacter('hero');
  rig.setWeapon('great-hammer');
  for (const state of ['idle', 'walk', 'run', 'attack']) {
    for (const combo of state === 'attack' ? [0, 1, 2, 3, 4] : [0]) {
      for (let i = 0; i <= 100; i++) {
        poseCharacter(rig, { state, combo, phase: i / 100, time: i / 60,
          dt: 1 / 60, speedFactor: 7, immediate: true });
        assert.equal(rig.sourceMotionDebug.authored, true);
        assert.ok(rig.sourcePose.offhandGap < .005,
          `hammer ${state} ${combo + 1} phase ${i / 100}: support hand leaves the shaft`);
        const head = rig.weaponBlades().find(frame => frame.headCenter);
        assert.ok(head.headMinY >= -.001,
          `hammer ${state} ${combo + 1} phase ${i / 100}: solid head penetrates the floor`);
        finiteRig(rig);
      }
    }
  }
});

test('hammer authoring retains source spine and legs without altering the shared evaluator cache', () => {
  const rig = createCharacter('hero');
  rig.setWeapon('great-hammer');
  for (let combo = 0; combo < 5; combo++) for (const phase of [.13, .4, .67, .91]) {
    const profile = getSourceAttackProfile('great-hammer', combo);
    const cached = sampleReferenceCurveMotion(profile, phase);
    const frame = cached.frame.slice(), attachments = cached.attachments.slice();
    poseCharacter(rig, { state: 'attack', combo, phase, dt: 1 / 60, immediate: true });
    assert.deepEqual(cached.frame, frame, 'authored hands must not mutate cached source frames');
    assert.deepEqual(cached.attachments, attachments, 'authored shaft must not mutate cached source mounts');
    for (const i of [0, 1, 2, 9, 10, 11, 12, 13, 14]) {
      const expected = new THREE.Quaternion().fromArray(frame, 3 + i * 4).normalize();
      assert.ok(expected.angleTo(rig.sourcePose.world[i]) < 1e-6,
        `hammer attack ${combo + 1}: authored shaft changes native spine or legs`);
    }
  }
});
