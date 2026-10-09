import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldCombat, sweptPropContact } from '../src/worldCombat.js';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { getReviewedAttack } from '../src/choreography/index.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const blade = (heel, tip) => ({ heel: vector(...heel), tip: vector(...tip) });
const props = [{ id: 'stone-lamp', type: 'stone-lamp', volumes: [
  { x: 2, z: 0, radius: .3, minY: .1, maxY: 1.8 },
] }];
const combat = () => createWorldCombat(new THREE.Group(), { props, random: () => .5 });
const slash = { previous: blade([0, 1, -1], [3, 1, -1]),
  current: blade([0, 1, 1], [3, 1, 1]), combo: 0, strikeId: 1 };

test('actual middle-of-blade sweep contacts a prop even when both endpoint poses miss', () => {
  assert.equal(sweptPropContact(null, slash.previous, props[0].volumes[0]), null);
  assert.equal(sweptPropContact(null, slash.current, props[0].volumes[0]), null);
  const contact = sweptPropContact(slash.previous, slash.current, props[0].volumes[0]);
  assert.ok(contact, 'the intervening physical blade surface passes through the lamp');
  assert.ok(Math.hypot(contact.x - 2, contact.z) <= .4 + 1e-5);
  assert.ok(contact.y >= .1 && contact.y <= 1.8);
});

test('scenery outside the blade path or above the blade produces no prop contact', () => {
  assert.equal(sweptPropContact(slash.previous, slash.current,
    { x: 7, z: 0, radius: .3, minY: .1, maxY: 1.8 }), null);
  assert.equal(sweptPropContact(slash.previous, slash.current,
    { x: 2, z: 0, radius: .3, minY: 3, maxY: 4 }), null);
});

test('a swept strike emits dust and struck-stone chips once per actual prop and strike', () => {
  const fx = combat();
  fx.reactToBlade(slash);
  const first = fx.getCombatState();
  assert.equal(first.dustSweeps, 1);
  assert.equal(first.propHits, 1);
  assert.equal(first.groundHits, 0);
  assert.equal(first.lastContact.prop, 'stone-lamp');
  assert.ok(first.poolCounts['struck-stone-chips'] > 0);
  assert.ok(first.poolCounts['struck-stone-sparks'] > 0);
  fx.reactToBlade(slash);
  assert.equal(fx.getCombatState().propHits, 1, '120 Hz substeps do not duplicate one collision burst');
  fx.reactToBlade({ ...slash, strikeId: 2 });
  assert.equal(fx.getCombatState().propHits, 2, 'another real stroke can contact the same object again');
});

test('a high overhead swing creates neither ground dust nor a ground mark', () => {
  const fx = combat();
  fx.reactToBlade({ previous: blade([0, 2.4, 0], [1, 2.5, 0]),
    current: blade([0, 2.4, .1], [1, 2.5, .2]), combo: 3, strikeId: 1 });
  assert.equal(fx.getCombatState().activeParticles, 0);
  assert.equal(fx.getCombatState().activeMarks, 0);
});

test('the finisher grounds its short dust burst and slash mark at the real low blade tip', () => {
  const fx = combat();
  const nearGround = { previous: blade([0, 1.2, 0], [1, .6, .5]),
    current: blade([0, 1.2, .1], [1.2, .13, .8]), combo: 3, strikeId: 1 };
  fx.reactToBlade(nearGround);
  const state = fx.getCombatState();
  assert.equal(state.groundHits, 1);
  assert.equal(state.activeMarks, 1);
  assert.deepEqual(state.lastGround, { x: 1.2, y: .068, z: .8 });
  fx.reactToBlade(nearGround);
  assert.equal(fx.getCombatState().groundHits, 1);
  const ordinary = combat();
  ordinary.reactToBlade({ ...nearGround, combo: 0 });
  assert.equal(ordinary.getCombatState().activeMarks, 0, 'an ordinary low sweep does not masquerade as a finisher');
});

test('a finisher above the physical ground envelope raises dust without leaving a slash mark', () => {
  const fx = combat();
  const almostGround = { previous: blade([0, 1.2, 0], [1, .2, .5]),
    current: blade([0, 1.2, .1], [1.2, .16001, .8]), combo: 3, strikeId: 1 };
  fx.reactToBlade(almostGround);
  assert.equal(fx.getCombatState().dustSweeps, 1, 'nearby airflow can still lift loose dust');
  assert.equal(fx.getCombatState().groundHits, 0);
  assert.equal(fx.getCombatState().activeMarks, 0);
  fx.reactToBlade({ ...almostGround, current: blade([0, 1.2, .1], [1.2, .16, .8]) });
  assert.equal(fx.getCombatState().groundHits, 1, 'a blade at the physical envelope can touch the paving');
});

test('new scenery effects are visible immediately and survive substeps until their first presentation', () => {
  const fx = combat();
  fx.reactToBlade(slash);
  const count = fx.getCombatState().activeParticles;
  assert.ok(count > 0);
  for (let step = 0; step < 60; step++) fx.update(1 / 120);
  assert.equal(fx.getCombatState().activeParticles, count, 'a half-second unseen effect retains its first presentation');
  fx.presentedCombat();
  fx.update(1.2);
  assert.equal(fx.getCombatState().activeParticles, 0, 'presented particles recycle after their bounded lifetime');
});

test('a purely vertical cleave still contacts the floor at its physical tip', () => {
  const fx = combat();
  fx.reactToBlade({ previous: blade([1, 1.8, 0], [1, .8, 0]),
    current: blade([1, 1.2, 0], [1, .13, 0]), combo: 3, strikeId: 1,
    origin: vector(0, 0, 0) });
  assert.equal(fx.getCombatState().groundHits, 1);
  assert.equal(fx.getCombatState().lastGround.x, 1);
});

test('the actual authored great dao finisher reaches the scene floor during its released swing', () => {
  const fx = combat(), rig = createCharacter('hero');
  rig.setWeapon('great-dao');
  const action = getReviewedAttack('great-dao', 3);
  let previous = null;
  let actualImpactHeight = null;
  for (let frame = 0; frame <= 120; frame++) {
    const phase = frame / 120;
    poseCharacter(rig, { state: 'attack', combo: 3, phase, time: 0,
      immediate: true, transition: false });
    const current = rig.weaponBlades()[0];
    if (phase >= action.swing[0] && phase <= action.brake) {
      const before = fx.getCombatState().groundHits;
      fx.reactToBlade({ previous, current, combo: 3, strikeId: 1, origin: rig.group.position, phase });
      if (fx.getCombatState().groundHits > before) actualImpactHeight = Math.min(
        current.heel.y, current.tip.y, previous.heel.y, previous.tip.y);
    }
    previous = current;
  }
  const state = fx.getCombatState();
  assert.equal(state.groundHits, 1, 'the feature is reachable through the actual authored action');
  assert.equal(state.activeMarks, 1);
  assert.ok(actualImpactHeight > .10 && actualImpactHeight <= .16,
    'the real authored blade enters the physical floor envelope before the effect fires');
  assert.ok(state.lastGround.z > .5, 'the real impact is at the forward low blade, not under the hero');
});

test('pause leaves particle transforms, mark opacity and active counts unchanged', () => {
  const fx = combat();
  fx.reactToBlade({ ...slash, combo: 3, current: blade([0, 1, .2], [3, .13, .3]) });
  fx.update(.05);
  const before = fx.group.children.map(mesh => mesh.isInstancedMesh
    ? [...mesh.instanceMatrix.array] : [mesh.material.opacity, ...mesh.position.toArray()]);
  const state = fx.getCombatState();
  for (let i = 0; i < 10; i++) fx.update(0);
  const after = fx.group.children.map(mesh => mesh.isInstancedMesh
    ? [...mesh.instanceMatrix.array] : [mesh.material.opacity, ...mesh.position.toArray()]);
  assert.deepEqual(after, before);
  assert.equal(fx.getCombatState().activeParticles, state.activeParticles);
});

test('particle, mark and strike tracking budgets stay fixed and clear resets a new battlefield', () => {
  const fx = combat(), objectCount = fx.group.children.length;
  for (let strikeId = 0; strikeId < 100; strikeId++) fx.reactToBlade({ ...slash,
    current: blade([0, 1, .2], [3, .13, .3]), combo: 3, strikeId });
  const state = fx.getCombatState();
  assert.ok(state.activeParticles <= state.particleBudget);
  assert.ok(state.activeMarks <= state.markBudget);
  assert.ok(state.activeMarks > 0, 'the stress case exercises the real low-blade mark pool');
  assert.ok(state.trackedStrikes <= 32);
  assert.equal(fx.group.children.length, objectCount, 'no per-strike mesh or material allocations');
  fx.clearCombat();
  assert.equal(fx.getCombatState().activeParticles, 0);
  assert.equal(fx.getCombatState().activeMarks, 0);
  assert.equal(fx.getCombatState().propHits, 0);
  fx.reactToBlade(slash);
  assert.equal(fx.getCombatState().propHits, 1);
});
