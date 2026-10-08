import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';

const range = values => Math.max(...values) - Math.min(...values);
const snapshot = rig => rig.bind.map(({ node }) => [
  ...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray(),
]);

test('running moves the pelvis, torso and arms together', () => {
  const rig = createCharacter();
  const samples = [];
  for (let i = 0; i < 240; i++) {
    poseCharacter(rig, {
      state: 'run', speed: 1, moveBlend: 1, gaitPhase: i * Math.PI / 120,
      time: i / 240, dt: 1 / 240, immediate: true,
    });
    const chest = new THREE.Euler().setFromQuaternion(rig.chest.getWorldQuaternion(new THREE.Quaternion()));
    samples.push({
      x: rig.body.position.x, y: rig.body.position.y, twist: chest.y,
      shoulder: rig.arms[0].shoulder.rotation.x, elbow: rig.arms[0].elbow.rotation.x,
      handZ: rig.arms[1].wrist.getWorldPosition(new THREE.Vector3()).z,
      footZ: rig.legs[1].foot.getWorldPosition(new THREE.Vector3()).z,
    });
  }
  assert.ok(range(samples.map(p => p.x)) > .03, 'weight shifts between supporting legs');
  assert.ok(range(samples.map(p => p.y)) > .025, 'the body compresses and rises with each step');
  assert.ok(range(samples.map(p => p.twist)) > .08, 'torso motion is visible after pelvis counterrotation');
  assert.ok(range(samples.map(p => p.shoulder)) > .2, 'shoulders swing with the stride');
  assert.ok(range(samples.map(p => p.elbow)) > .05, 'elbows follow the shoulders');
  const mean = key => samples.reduce((sum, p) => sum + p[key], 0) / samples.length;
  const handMean = mean('handZ'), footMean = mean('footZ');
  const opposition = samples.reduce((sum, p) => sum + (p.handZ - handMean) * (p.footZ - footMean), 0);
  assert.ok(opposition < 0, 'the arm counterbalances the leg on the same side');
});

test('support feet stay grounded without sliding at walking and running speeds', () => {
  for (const speed of [.3, .6, 1]) {
    const rig = createCharacter();
    const cycleDistance = .85 + (2.9 - .85) * speed;
    const stance = Math.min(.58, Math.max(.20, 2 * (.235 + .085 * speed) / cycleDistance));
    const contacts = [[], []];
    for (let i = 0; i <= 240; i++) {
      const phase = i / 240;
      rig.group.position.z = phase * cycleDistance;
      poseCharacter(rig, {
        state: 'run', speed, moveBlend: speed, gaitPhase: phase * Math.PI * 2,
        time: phase, dt: 1 / 240, immediate: true,
      });
      rig.legs.forEach((leg, index) => {
        const u = (phase + (leg.side === -1 ? .5 : 0)) % 1;
        if (u > .01 && u < stance - .01) {
          contacts[index].push(leg.foot.getWorldPosition(new THREE.Vector3()));
        }
      });
    }
    for (const foot of contacts) {
      assert.ok(foot.length > 10, 'a support phase was sampled');
      assert.ok(range(foot.map(p => p.y)) < .0001, `ground contact at speed ${speed}`);
      assert.ok(range(foot.map(p => p.z)) < .0001, `no ground slip at speed ${speed}`);
    }
  }
});

test('idle weight shifts and breathing keep both feet planted', () => {
  const rig = createCharacter();
  const samples = [];
  for (let i = 0; i <= 600; i++) {
    poseCharacter(rig, {
      state: 'idle', speed: 0, moveBlend: 0, time: i / 60, dt: 1 / 60,
      idleAge: 1 + i / 60, lookYaw: 0, immediate: true,
    });
    samples.push({
      x: rig.body.position.x, chestY: rig.chest.position.y,
      feet: rig.legs.map(leg => leg.foot.getWorldPosition(new THREE.Vector3())),
    });
  }
  assert.ok(range(samples.map(p => p.x)) > .025, 'idle posture shifts weight');
  assert.ok(range(samples.map(p => p.chestY)) > .03, 'breathing comes from the chest');
  for (const index of [0, 1]) {
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(range(samples.map(p => p.feet[index][axis])) < .0001, `idle foot ${index} stays planted`);
    }
  }
});

test('zero delta freezes locomotion and its follow-through', () => {
  const rig = createCharacter();
  poseCharacter(rig, { state: 'run', speed: 1, moveBlend: 1, time: 1, dt: 1 / 60, gaitPhase: 1 });
  const before = snapshot(rig);
  const drive = rig.motion.drive;
  poseCharacter(rig, { state: 'idle', speed: 0, moveBlend: 0, time: 2, dt: 0, gaitPhase: 2 });
  assert.deepEqual(snapshot(rig), before);
  assert.equal(rig.motion.drive, drive);
});

test('starting leans forward and stopping settles back', () => {
  const rig = createCharacter();
  const pose = (speed, dt) => poseCharacter(rig, {
    state: speed ? 'run' : 'idle', speed, moveBlend: speed,
    gaitPhase: 0, time: 1, dt, immediate: true,
  });
  for (let i = 0; i < 30; i++) pose(0, 1 / 60);
  pose(1, 1 / 60);
  assert.ok(rig.motion.drive > 0, 'acceleration adds forward drive');
  const acceleratingPitch = rig.body.rotation.x;
  for (let i = 0; i < 120; i++) pose(1, 1 / 60);
  assert.ok(acceleratingPitch > rig.body.rotation.x, 'the starting lean settles during a steady run');
  pose(0, 1 / 60);
  assert.ok(rig.motion.drive < 0, 'deceleration adds a braking response');
  for (let i = 0; i < 120; i++) pose(0, 1 / 60);
  assert.ok(Math.abs(rig.motion.drive) < .0001, 'no residual drive after settling');
});
