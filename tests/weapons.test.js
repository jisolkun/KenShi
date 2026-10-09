import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { WEAPONS, DEFAULT_WEAPON_ID, getWeapon, SKILL_CONTACTS, isWeaponUnlocked, UNLOCKED_WEAPON_IDS } from '../src/weapons.js';
import { WEAPON_COMBOS } from '../src/weaponMotion.js';
import { getReviewedAttack } from '../src/choreography/index.js';

const vector = () => new THREE.Vector3();
const assertFinite = (rig, label) => {
  for (const { node } of rig.bind) {
    assert.ok([...node.position, ...node.quaternion, ...node.scale].every(Number.isFinite), `${label}: ${node.name}`);
  }
  for (const tip of rig.weaponTips()) assert.ok(tip.toArray().every(Number.isFinite), `${label}: tip`);
};
const signature = rig => [rig.body, rig.chest, ...rig.arms.flatMap(a => [a.shoulder, a.elbow, a.wrist])]
  .flatMap(n => [...n.position, ...n.quaternion]).map(n => n.toFixed(5)).join(',');

test('27 unique catalog entries expose 108 valid contact windows and supported shapes', () => {
  assert.equal(WEAPONS.length, 27);
  assert.equal(new Set(WEAPONS.map(w => w.id)).size, 27);
  const shapes = new Set(['arc', 'thrust', 'crush', 'radial', 'chain', 'hook']);
  for (const weapon of WEAPONS) {
    assert.equal(getWeapon(weapon.id), weapon);
    assert.equal(weapon.moves.length, 4);
    assert.equal(weapon.skillNames.length, 5);
    assert.equal(WEAPON_COMBOS[weapon.id].length, 4);
    for (const move of weapon.moves) {
      assert.ok(move.duration > 0);
      assert.ok(move.active[0] >= 0 && move.active[1] <= 1 && move.active[0] < move.active[1]);
      assert.ok(move.contact >= move.active[0] && move.contact <= move.active[1], `${weapon.id}/${move.name}`);
      assert.ok(shapes.has(move.shape), move.shape);
      assert.ok([move.damage, move.reach, move.width, move.halfAngle].every(n => Number.isFinite(n) && n > 0));
    }
  }
});

test('each weapon has distinct sampled four-hit choreography and bounded new finishers', () => {
  const weaponSignatures = new Set();
  for (const weapon of WEAPONS) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    const hits = [];
    for (let combo = 0; combo < 4; combo++) {
      poseCharacter(rig, { state: 'attack', combo, phase: weapon.moves[combo].contact, time: .5, immediate: true });
      hits.push(signature(rig));
      if (weapon.id !== DEFAULT_WEAPON_ID) assert.ok(Math.abs(rig.body.rotation.y) < 1.5, `${weapon.id}: torso is bounded`);
    }
    assert.equal(new Set(hits).size, 4, `${weapon.id}: four distinct contacts`);
    weaponSignatures.add(hits.join('|'));
  }
  assert.equal(weaponSignatures.size, 27);
});

test('all equipped poses, four attacks and five skills keep finite body and tip transforms', () => {
  for (const weapon of WEAPONS) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    for (const state of ['idle', 'guard', 'run', 'hurt', 'dodge', 'attack', 'skill']) {
      const count = state === 'skill' ? 5 : state === 'attack' ? 4 : 1;
      for (let action = 0; action < count; action++) {
        for (let step = 0; step <= 10; step++) {
          poseCharacter(rig, { state, combo: action, skill: action, phase: step / 10, time: step / 10, immediate: true });
          assertFinite(rig, `${weapon.id}/${state}/${action}/${step}`);
        }
      }
    }
    // These are authored damaging marker positions, not a mesh collision test.
    poseCharacter(rig, { state: 'idle', time: .4, immediate: true });
    assert.ok(rig.weaponTips().every(tip => tip.y >= 0), `${weapon.id}: idle tip markers clear the floor`);
  }
});

test('legacy weapon attacks keep reachable ankles on the ground through all four contacts', () => {
  for (const weapon of WEAPONS.filter(w => w.id !== DEFAULT_WEAPON_ID && !getReviewedAttack(w.id))) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    for (let combo = 0; combo < 4; combo++) {
      for (const phase of [0, .15, weapon.moves[combo].contact, .75, 1]) {
        poseCharacter(rig, { state: 'attack', combo, phase, time: phase, immediate: true });
        rig.group.updateMatrixWorld(true);
        for (const leg of rig.legs) {
          const ankle = leg.foot.getWorldPosition(vector());
          const hip = leg.hip.getWorldPosition(vector());
          assert.ok(Math.abs(ankle.y - .075) < 1e-6, `${weapon.id}: grounded ankle`);
          assert.ok(hip.distanceTo(ankle) <= .806, `${weapon.id}: reachable leg`);
        }
      }
    }
  }
});

test('two-hand grips remain joined throughout blended idle, run and attack transitions', () => {
  for (const weapon of WEAPONS.filter(w => w.grip === 'twohand')) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    assert.ok(rig.offhandGrip?.isObject3D);
    assert.equal(rig.arms[0].weapon.visible, false, 'the support hand carries no duplicate weapon');
    for (let frame = 0; frame < 100; frame++) {
      const state = frame < 20 ? 'idle' : frame < 50 ? 'run' : 'attack';
      poseCharacter(rig, { state, combo: 3, phase: Math.max(0, (frame - 50) / 50), time: frame / 60, dt: 1 / 60 });
      rig.group.updateMatrixWorld(true);
      const gap = rig.arms[0].wrist.getWorldPosition(vector()).distanceTo(rig.offhandGrip.getWorldPosition(vector()));
      assert.ok(gap < 1e-8, `${weapon.id}/${frame}: grip gap ${gap}`);
    }
  }
});

test('equip switches preserve wrist roots, replace tip nodes and reset motion safely', () => {
  const rig = createCharacter();
  const roots = rig.arms.map(a => a.weapon);
  let previousTips = rig.weaponTipNodes;
  for (const weapon of [...WEAPONS, getWeapon(DEFAULT_WEAPON_ID)]) {
    poseCharacter(rig, { state: 'attack', combo: 3, phase: .5, time: 1, dt: 1 / 60 });
    rig.setWeapon(weapon.id);
    assert.equal(rig.weaponId, weapon.id);
    assert.equal(rig.weaponDefinition, weapon);
    assert.deepEqual(rig.arms.map(a => a.weapon), roots);
    const expectedTips = weapon.id === 'emei-piercers' ? 4 : weapon.id === 'staff' ? 2 : weapon.grip === 'dual' ? 2 : 1;
    assert.equal(rig.weaponTips().length, expectedTips, weapon.id);
    assert.notEqual(rig.weaponTipNodes, previousTips);
    assert.ok(previousTips.every(node => !rig.weaponTipNodes.includes(node)));
    assert.equal(rig.motion.key, 'locomotion');
    assertFinite(rig, weapon.id);
    previousTips = rig.weaponTipNodes;
  }
});


test('skill pose peaks align with the shared skill hit and effect contacts', () => {
  assert.deepEqual(SKILL_CONTACTS, [.3, .38, .72, .4, .4]);
  for (const weapon of WEAPONS.filter(w => w.id !== DEFAULT_WEAPON_ID && !getReviewedAttack(w.id))) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    for (let skill = 0; skill < 5; skill++) {
      const expectedTwist = WEAPON_COMBOS[weapon.id][skill >= 4 ? 3 : skill][6] * (skill >= 4 ? 1.25 : 1);
      for (const combo of [0, 2, 3]) {
        poseCharacter(rig, { state: 'skill', skill, combo, phase: SKILL_CONTACTS[skill], time: .5, immediate: true });
        assert.ok(Math.abs(rig.chest.rotation.y - expectedTwist) < 1e-10, `${weapon.id}/skill${skill}/combo${combo}: peak contact`);
      }
    }
  }
});

test('new weapon carries breathe, follow gait and let the free hand counterbalance its leg', () => {
  const range = values => Math.max(...values) - Math.min(...values);
  for (const weapon of WEAPONS.filter(w => w.id !== DEFAULT_WEAPON_ID)) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    const breath = [];
    for (let step = 0; step < 30; step++) {
      poseCharacter(rig, { state: 'idle', time: step / 10, idleAge: 2, moveBlend: 0, immediate: true });
      breath.push(signature(rig));
    }
    assert.ok(new Set(breath).size > 20, `${weapon.id}: relaxed carry breathes`);
    const gaitSamples = [];
    for (let step = 0; step < 60; step++) {
      poseCharacter(rig, { state: 'run', time: .5, gaitPhase: step * Math.PI / 30, speed: 1, moveBlend: 1, immediate: true });
      gaitSamples.push({
        hand: rig.arms[0].wrist.getWorldPosition(vector()).z,
        foot: rig.legs[0].foot.getWorldPosition(vector()).z,
        wrist: rig.arms[1].wrist.rotation.z,
      });
    }
    assert.ok(range(gaitSamples.map(s => s.wrist)) > .01, `${weapon.id}: carry follows gait even with fixed time`);
    if (weapon.grip === 'single') {
      const mean = key => gaitSamples.reduce((sum, s) => sum + s[key], 0) / gaitSamples.length;
      const handMean = mean('hand'), footMean = mean('foot');
      const opposition = gaitSamples.reduce((sum, s) => sum + (s.hand - handMean) * (s.foot - footMean), 0);
      assert.ok(range(gaitSamples.map(s => s.hand)) > .05, `${weapon.id}: free hand swings`);
      assert.ok(opposition < 0, `${weapon.id}: free hand counterbalances its leg`);
    }
    const before = signature(rig);
    poseCharacter(rig, { state: 'idle', time: 20, gaitPhase: 15, dt: 0 });
    assert.equal(signature(rig), before, `${weapon.id}: pause freezes carry`);
  }
});


test('only the three reviewed and unlocked weapons are available to choose', () => {
  assert.deepEqual([...UNLOCKED_WEAPON_IDS], ['dual-dao', 'tang-dao', 'yanling-dao']);
  assert.equal(WEAPONS.filter(w => isWeaponUnlocked(w.id)).length, 3);
  assert.equal(isWeaponUnlocked('unknown'), false);
  assert.equal(isWeaponUnlocked('ring-dao'), false);
});

test('dual dao uses the original attack timings and bypasses the replacement registry', () => {
  const weapon = getWeapon('dual-dao');
  assert.equal(getReviewedAttack('dual-dao'), null);
  assert.deepEqual(weapon.moves.map(m => m.name), ['燕返', '交锋', '穿花', '双月']);
  assert.deepEqual(weapon.moves.map(m => m.duration), [.31, .347, .291, .44]);
  assert.deepEqual(weapon.moves.map(m => m.contact), [.43, .43, .47, .48]);
  assert.deepEqual(weapon.skillNames, ['燕返', '交锋', '穿花', '双月', '绝式·双月']);
});
