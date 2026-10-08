import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { equipWeapon } from '../src/weaponModels.js';
import { getReviewedAttack } from '../src/choreography/index.js';
import { WEAPONS } from '../src/weapons.js';

const vector = () => new THREE.Vector3();
const worldPosition = node => node.getWorldPosition(vector());
const worldQuaternion = node => node.getWorldQuaternion(new THREE.Quaternion());
const degrees = radians => THREE.MathUtils.radToDeg(radians);
const EPSILON = 1e-5; // Numerical tolerance for exact IK targets and floor contact.

// These conservative envelopes include the visible torso and head. Sampling the
// whole blade segment catches collisions that checking just the tip would miss.
const bodyEnvelopes = rig => [
  { node: rig.chest, center: new THREE.Vector3(0, .22, 0), radius: new THREE.Vector3(.30, .33, .185) },
  { node: rig.head, center: new THREE.Vector3(0, .11, .025), radius: new THREE.Vector3(.165, .219, .156) },
];

// Action phase and travelling gait are independent. A timeline-only test can
// miss a leg that becomes unreachable when a foot lands during the recovery.
for (const weapon of WEAPONS.slice(0, 5)) {
  if (!getReviewedAttack(weapon.id, 0)) continue;
  test(`${weapon.id}: independent action and travelling gait remain reachable`, () => {
    const rig = createCharacter('hero');
    equipWeapon(rig, weapon.id);
    for (const state of ['attack', 'skill']) {
      for (let action = 0; action < (state === 'attack' ? 4 : 5); action++) {
        for (const carry of [.25, .5, 1]) {
          for (const phase of [0, .1, .2, .3, .4, .5, .6, .7, .714, .8, .9, 1]) {
            for (const gait of [0, .07, .13, .3, .5, .57, .63, .8, .99]) {
              poseCharacter(rig, {state, combo: action, skill: action, phase,
                time: 0, speed: carry, attackCarry: carry, gaitPhase: gait * Math.PI * 2,
                dt: 1 / 60, immediate: true, transition: false});
              rig.group.updateMatrixWorld(true);
              rig.legs.forEach((leg, index) => {
                const target = rig.reviewedAttackSample.stance.feet[index];
                const expected = rig.group.localToWorld(new THREE.Vector3(target.x, target.y, target.z));
                const length = leg.knee.position.length() + leg.foot.position.length();
                const context = `${state} ${action}, carry=${carry}, phase=${phase}, gait=${gait}, leg=${index}`;
                assert.ok(expected.distanceTo(worldPosition(leg.hip)) <= length + EPSILON, `unreachable foot: ${context}`);
                assert.ok(expected.distanceTo(worldPosition(leg.foot)) < EPSILON, `foot target missed: ${context}`);
                assert.ok(worldPosition(leg.foot).y >= .075 - EPSILON, `foot below floor: ${context}`);
              });
            }
          }
        }
      }
    }
  });
}

// Discover only registry entries: adding another reviewed weapon automatically
// adds its four normal attacks and five skills without touching this test.
for (const weapon of WEAPONS.slice(0, 5)) {
  if (!getReviewedAttack(weapon.id, 0, 'attack')) continue;
  for (const state of ['attack', 'skill']) {
    for (let combo = 0; combo < (state === 'attack' ? 4 : 5); combo++) {
      for (const carry of [0, 1]) {
        test(`${weapon.id} ${state} ${combo} carry=${carry}: rendered motion at 60 Hz`, () => {
          const spec = getReviewedAttack(weapon.id, combo, state);
          assert.ok(spec, 'every registered weapon must expose all nine actions');
          assert.ok(Number.isFinite(spec.duration) && spec.duration > 0, 'positive finite duration');
          assert.ok(spec.contacts.length > 0, 'authored contact windows exist');
          const rig = createCharacter('hero');
          equipWeapon(rig, weapon.id);
          const joints = [rig.body, rig.chest, rig.head,
            ...rig.arms.flatMap(a => [a.shoulder, a.elbow, a.wrist]),
            ...rig.legs.flatMap(l => [l.hip, l.knee, l.foot])];
          const failures = new Map();
          const seenContacts = new Set();
          let previous;
          const times = Array.from({ length: Math.ceil(spec.duration * 60) + 1 }, (_, i) => Math.min(i / 60, spec.duration));
          for (const time of times) {
            const phase = time / spec.duration;
            const check = (condition, key, detail) => {
              if (!condition && !failures.has(key)) failures.set(key, `t=${time.toFixed(4)}s phase=${phase.toFixed(4)}: ${detail}`);
            };
            const gaitPhase = time * Math.PI * 2 * 1.5;
            poseCharacter(rig, { state, combo, skill: combo, phase, time, attackCarry: carry, speed: carry, gaitPhase,
              dt: previous ? time - previous.time : 1 / 60, immediate: true, transition: false });
            rig.group.updateMatrixWorld(true);
            rig.group.traverse(node => check(node.matrixWorld.elements.every(Number.isFinite), `finite:${node.name}`, `${node.name || node.type} has nonfinite world matrix`));
            const sample = rig.reviewedAttackSample;
            assert.ok(sample, 'poseCharacter must consume the reviewed registry');
            const quaternions = joints.map(node => node.quaternion.clone());
            joints.forEach((node, index) => {
              if (previous) {
                const delta = degrees(quaternions[index].angleTo(previous.quaternions[index]));
                check(delta < 30, `joint:${index}`, `${node.name || index} quaternion delta ${delta.toFixed(3)}° >= 30°`);
              }
            });
          rig.arms.forEach((arm, hand) => {
            const target = rig.chest.localToWorld(new THREE.Vector3(...sample.hands[hand].grip));
            const error = target.distanceTo(worldPosition(arm.wrist));
            check(error < EPSILON, `grip:${hand}`, `hand ${hand} grip error ${error.toFixed(6)}m`);
          });
          if (weapon.grip === 'twohand') {
            check(!!rig.offhandGrip, 'support-marker', 'two hand weapon lacks a support grip marker');
            if (rig.offhandGrip) {
              const error = worldPosition(rig.offhandGrip).distanceTo(worldPosition(rig.arms[0].wrist));
              check(error < EPSILON, 'support-grip', `support hand is ${error.toFixed(6)}m from rendered hilt marker`);
            }
          } else {
            check(!rig.offhandGrip, 'support-marker', 'single or dual weapon has an unexpected support grip');
          }
          for (const [index, leg] of rig.legs.entries()) {
            const reach = worldPosition(leg.hip).distanceTo(worldPosition(leg.foot));
            const chainLength = leg.knee.position.length() + leg.foot.position.length();
            check(reach <= chainLength + EPSILON, `leg:${index}`, `leg ${index} reach ${reach.toFixed(6)}m exceeds chain ${chainLength.toFixed(6)}m`);
            const ankle = worldPosition(leg.foot);
            // Authored feet are ankle targets in character (group) space,
            // indexed like rig.legs: left=0, right=1. Steps may lift either foot.
            const authored = sample.stance.feet?.[index];
            if (authored) {
              const target = rig.group.localToWorld(new THREE.Vector3(authored.x, authored.y, authored.z));
              const requestedReach = target.distanceTo(worldPosition(leg.hip));
              check(requestedReach <= chainLength + EPSILON, `target-reach:${index}`, `leg ${index} target reach ${requestedReach.toFixed(6)}m exceeds chain ${chainLength.toFixed(6)}m`);
              const error = ankle.distanceTo(target);
              check(error < EPSILON, `plant:${index}`, `ankle ${index} misses authored foot target by ${error.toFixed(6)}m`);
            } else {
              // The existing carry gait has a .62 stance fraction and .10m
              // swing lift. At carry=0 this strictly checks the .075m plant.
              const gait = ((gaitPhase / (Math.PI * 2) + (leg.side === -1 ? .5 : 0)) % 1 + 1) % 1;
              const swing = THREE.MathUtils.clamp((gait - .62) / (1 - .62), 0, 1);
              const height = .075 + Math.sin(Math.PI * swing) * .10 * carry;
              check(Math.abs(ankle.y - height) < EPSILON, `plant:${index}`, `ankle ${index} misses gait height ${height.toFixed(6)}m: actual ${ankle.y.toFixed(6)}m`);
            }
            const bootBounds = new THREE.Box3().setFromObject(leg.foot, true);
            check(bootBounds.min.y >= -EPSILON, `foot:${index}`, `boot ${index} penetrates floor by ${(-bootBounds.min.y).toFixed(6)}m`);
          }
          const blades = rig.weaponBlades();
          check(blades.length === (weapon.grip === 'dual' ? 2 : 1), 'blade-count', 'incorrect number of rendered blades');
          const bladeFrames = new Map();
          for (const blade of blades) {
            const { hand, heel, tip } = blade;
            const mid = heel.clone().lerp(tip, .5);
            const orientation = worldQuaternion(rig.arms[hand].weapon);
            const axis = tip.clone().sub(heel).normalize();
            bladeFrames.set(hand, { mid, tip: tip.clone(), orientation });
            check(Math.min(heel.y, tip.y) >= .05, `floor-blade:${hand}`, `blade ${hand} minimum height ${Math.min(heel.y, tip.y).toFixed(6)}m < .05m`);
            for (const [bodyIndex, envelope] of bodyEnvelopes(rig).entries()) {
              for (let section = 0; section <= 40; section++) {
                const local = envelope.node.worldToLocal(heel.clone().lerp(tip, section / 40)).sub(envelope.center).divide(envelope.radius);
                check(local.length() > 1, `clearance:${hand}:${bodyIndex}`, `blade ${hand} intersects ${bodyIndex === 0 ? 'torso' : 'head'} envelope (normalized clearance ${local.length().toFixed(4)})`);
              }
            }
            const before = previous?.bladeFrames.get(hand);
            if (!before) continue;
            const delta = degrees(orientation.angleTo(before.orientation));
            check(delta < 30, `blade-turn:${hand}`, `blade ${hand} world orientation delta ${delta.toFixed(3)}° >= 30°`);
            spec.contacts.forEach((contact, index) => {
              if (contact.hand !== hand || phase < contact.start || phase > contact.end) return;
              seenContacts.add(index);
              if (contact.kind === 'thrust') {
                const velocity = tip.clone().sub(before.tip);
                const forward = new THREE.Vector3(0, 0, 1).transformDirection(rig.group.matrixWorld);
                check(axis.dot(forward) > .75, `point-axis:${index}`, `thrust ${index} forward axis dot ${axis.dot(forward).toFixed(4)} <= .75`);
                check(velocity.length() > EPSILON && axis.dot(velocity.normalize()) > .75, `point-velocity:${index}`, `thrust ${index} point velocity does not follow blade axis`);
              } else {
                const transverse = mid.clone().sub(before.mid);
                transverse.addScaledVector(axis, -transverse.dot(axis));
                check(transverse.length() > EPSILON, `cut-velocity:${index}`, `cut ${index} has no transverse blade velocity`);
                if (transverse.length() <= EPSILON) return;
                transverse.normalize();
                const edge = blade.edge.dot(transverse), face = Math.abs(blade.normal.dot(transverse));
                check(edge > .75, `edge:${index}`, `cut ${index} hand ${hand} edge/velocity dot ${edge.toFixed(4)} <= .75`);
                check(face < .25, `face:${index}`, `cut ${index} hand ${hand} face leakage ${face.toFixed(4)} >= .25`);
              }
            });
          }
          previous = { time, quaternions, bladeFrames };
        }
        assert.equal(seenContacts.size, spec.contacts.length, '60 Hz sampling must exercise every authored contact');
        assert.equal(failures.size, 0, [...failures].map(([key, detail]) => `${key}: ${detail}`).join('\n'));
      });
      }
    }
  }
}

for (const weapon of WEAPONS.slice(0, 5)) {
  if (!getReviewedAttack(weapon.id, 0)) continue;
  test(`${weapon.id}: travelling support feet stay fixed in world space`, () => {
    const rig = createCharacter('hero');
    equipWeapon(rig, weapon.id);
    for (const carry of [.25, .5, 1]) {
      const cycle = .85 + 2.05 * carry;
      let previous, supportedPairs = 0;
      for (let frame = 0; frame <= 120; frame++) {
        const time = frame / 60, distance = time * 5.8 * carry;
        rig.group.position.z = distance;
        poseCharacter(rig, {state: 'attack', combo: 0, phase: .45, time,
          speed: carry, attackCarry: carry, gaitPhase: distance * Math.PI * 2 / cycle,
          dt: 1 / 60, immediate: true, transition: false});
        rig.group.updateMatrixWorld(true);
        const feet = rig.legs.map(leg => worldPosition(leg.foot));
        const gait = rig.legs.map(leg => ((distance / cycle + (leg.side === -1 ? .5 : 0)) % 1 + 1) % 1);
        feet.forEach((foot, index) => {
          if (!previous || gait[index] <= previous.gait[index]) return;
          if (Math.abs(foot.y - .075) > EPSILON || Math.abs(previous.feet[index].y - .075) > EPSILON) return;
          assert.ok(foot.distanceTo(previous.feet[index]) < EPSILON, `support foot slides: carry=${carry}, frame=${frame}, leg=${index}`);
          supportedPairs++;
        });
        previous = {feet, gait};
      }
      assert.ok(supportedPairs > 0, `no support frames exercised: carry=${carry}`);
    }
  });
  if (weapon.grip !== 'twohand') continue;
  test(`${weapon.id}: both hands stay on the hilt during state changes`, () => {
    for (const opening of ['idle', 'run']) {
      for (const state of ['attack', 'skill']) {
        for (let action = 0; action < (state === 'attack' ? 4 : 5); action++) {
          const rig = createCharacter('hero');
          equipWeapon(rig, weapon.id);
          let time = 0;
          const pose = options => {
            poseCharacter(rig, {...options, time, dt: 1 / 60});
            time += 1 / 60;
            rig.group.updateMatrixWorld(true);
            const error = worldPosition(rig.arms[0].wrist).distanceTo(worldPosition(rig.offhandGrip));
            assert.ok(error < EPSILON, `${opening}→${state} ${action}: hilt gap ${error}m`);
            for (const blade of rig.weaponBlades()) assert.ok(Math.min(blade.heel.y, blade.tip.y) >= 0, 'blade penetrates the ground during state blend');
          };
          for (let frame = 0; frame < 8; frame++) pose({state: opening, speed: opening === 'run' ? 1 : 0, gaitPhase: frame * .15});
          const spec = getReviewedAttack(weapon.id, action, state);
          for (let frame = 0; frame <= Math.ceil(spec.duration * 60); frame++) pose({state, combo: action, skill: action, phase: Math.min(1, frame / (60 * spec.duration))});
          for (let frame = 0; frame < 8; frame++) pose({state: 'idle', speed: 0});
        }
      }
    }
  });
}

test('nine loose rings stay attached, follow the blade and freeze on pause', () => {
  const rig = createCharacter('hero');
  equipWeapon(rig, 'ring-dao');
  assert.equal(rig.weaponArticulation.length, 9);
  poseCharacter(rig, {state: 'attack', combo: 0, phase: .2, time: .2, dt: 1 / 60, immediate: true});
  const before = rig.weaponArticulation.map(part => part.node.quaternion.clone());
  for (let frame = 1; frame <= 12; frame++) poseCharacter(rig, {state: 'attack', combo: 0, phase: .2 + frame / 40, time: .2 + frame / 60, dt: 1 / 60, immediate: true});
  assert.ok(rig.weaponArticulation.some((part, index) => part.node.quaternion.angleTo(before[index]) > .01), 'loose rings never respond to the blade');
  for (const part of rig.weaponArticulation) {
    assert.equal(part.node.parent, rig.arms[1].weapon);
    assert.ok(part.node.quaternion.toArray().every(Number.isFinite));
  }
  const frozen = rig.weaponArticulation.map(part => part.node.quaternion.toArray());
  poseCharacter(rig, {state: 'idle', time: 20, dt: 0});
  assert.deepEqual(rig.weaponArticulation.map(part => part.node.quaternion.toArray()), frozen);
});
