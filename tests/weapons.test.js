import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { WEAPONS, DEFAULT_WEAPON_ID, getWeapon, isWeaponUnlocked, UNLOCKED_WEAPON_IDS } from '../src/weapons.js';
import { getReviewedAttack } from '../src/choreography/index.js';
import {
  SOURCE_ATTACK_COUNT, getSourceAttackProfile, getSourceAttackTiming,
  getSourceMotionProvenance,
} from '../src/sourceMotion/catalogue.js';
import { getSourceAttackRule } from '../src/sourceMotion/combat.js';

const vector = () => new THREE.Vector3();
const transforms = rig => rig.bind.map(({ node }) => [
  ...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray(),
]);
const signature = rig => [rig.body, rig.chest, rig.head,
  ...rig.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.wrist]),
  ...rig.legs.flatMap(leg => [leg.hip, leg.knee, leg.foot])]
  .flatMap(node => [...node.position, ...node.quaternion]).map(n => n.toFixed(5)).join(',');
const assertFinite = (rig, label) => {
  for (const { node } of rig.bind) {
    assert.ok([...node.position, ...node.quaternion, ...node.scale].every(Number.isFinite), `${label}: ${node.name}`);
    assert.ok(Math.abs(node.quaternion.length() - 1) < 1e-7, `${label}: ${node.name} normalized rotation`);
  }
  for (const tip of rig.weaponTips()) assert.ok(tip.toArray().every(Number.isFinite), `${label}: tip`);
  if (rig.sourcePose?.active) assert.ok(rig.sourcePose.footMinY >= -1e-7, `${label}: source shoes clear the floor`);
};

test('four weapon types expose twenty valid source-timed ordinary attacks', () => {
  assert.equal(WEAPONS.length, 4);
  assert.equal(new Set(WEAPONS.map(weapon => weapon.id)).size, 4);
  assert.equal(WEAPONS.reduce((count, weapon) => count + weapon.moves.length, 0), 20);
  const shapes = new Set(['arc', 'thrust', 'crush', 'radial', 'chain', 'hook']);
  for (const weapon of WEAPONS) {
    assert.equal(getWeapon(weapon.id), weapon);
    assert.equal(weapon.moves.length, SOURCE_ATTACK_COUNT);
    assert.equal(new Set(weapon.moves.map(move => move.name)).size, SOURCE_ATTACK_COUNT);
    assert.ok(!weapon.skillNames?.length, `${weapon.id}: no active skills`);
    for (const [combo, move] of weapon.moves.entries()) {
      const timing = getSourceAttackTiming(weapon.id, combo);
      const rule = getSourceAttackRule(weapon.id, combo, timing.atkspd);
      const firstContact = Math.min(...rule.volumes.map(volume => volume.delay + (volume.type === 'splash' ? 0 : .05)));
      const lastContact = Math.max(...rule.volumes.map(volume => volume.delay + (volume.type === 'splash' ? .2 : .15)));
      assert.equal(move.duration, timing.duration);
      assert.equal(move.sourceAttackSeconds, timing.attackSeconds);
      assert.equal(move.sourceRecoverySeconds, timing.recoverySeconds);
      assert.equal(move.recoverAt, timing.recoverAt);
      assert.equal(move.sourceHitDelay, timing.hitDelay);
      assert.equal(move.sourceMotion, true);
      assert.equal(move.sourceName, timing.profile.name);
      assert.equal(move.sourceFamily, timing.family);
      assert.equal(move.sourceFinisher, combo === SOURCE_ATTACK_COUNT - 1);
      assert.equal(move.contact, firstContact / move.duration);
      assert.deepEqual(move.active, [firstContact / move.duration, lastContact / move.duration]);
      assert.ok(move.duration > 0);
      assert.ok(move.active[0] >= 0 && move.active[1] <= 1 && move.active[0] < move.active[1]);
      assert.ok(move.contact >= move.active[0] && move.contact <= move.active[1], `${weapon.id}/${move.name}`);
      assert.ok(shapes.has(move.shape), move.shape);
      assert.ok([move.damage, move.reach, move.width, move.halfAngle].every(n => Number.isFinite(n) && n > 0));
      assert.equal(move.hitstop, 0, `${weapon.id}: original playback continues through contacts`);
      if (combo === SOURCE_ATTACK_COUNT - 1) {
        assert.equal(move.recoverAt, 1);
        assert.equal(move.sourceRecoverySeconds, 0);
      } else assert.ok(move.sourceRecoverySeconds > 0);
    }
  }
});

test('source blades use a single grip, dual blades use both hands, and the authored hammer uses a joined shaft', () => {
  const expected = {
    'dual-dao': { grip: 'dual', family: 'dual', tips: 2 },
    'tang-dao': { grip: 'single', family: 'blade', tips: 1 },
    'great-dao': { grip: 'single', family: 'blade', tips: 1 },
    'great-hammer': { grip: 'twohand', family: 'halberd', tips: 1 },
  };
  for (const weapon of WEAPONS) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    const mapping = expected[weapon.id];
    assert.equal(weapon.grip, mapping.grip);
    assert.equal(rig.sourceMotionDebug.family, mapping.family);
    assert.equal(rig.arms[0].weapon.visible, mapping.grip === 'dual');
    assert.equal(rig.arms[1].weapon.visible, true);
    assert.equal(rig.weaponTips().length, mapping.tips);
    if (weapon.id === 'great-hammer') {
      assert.ok(rig.offhandGrip?.isObject3D);
      assert.equal(rig.sourceMotionDebug.authored, true);
      assert.ok(rig.sourcePose.offhandGap < .005, 'support hand remains attached to the authored shaft');
      assert.equal(getSourceMotionProvenance(weapon.id).fallback, true);
      assert.match(getSourceMotionProvenance(weapon.id).provenance, /no hammer/);
    } else {
      assert.equal(rig.offhandGrip, null);
      assert.equal(rig.sourceMotionDebug.authored, false);
      assert.equal(getSourceMotionProvenance(weapon.id).fallback, false);
    }
  }
  for (let combo = 0; combo < SOURCE_ATTACK_COUNT; combo++) {
    assert.equal(getSourceAttackProfile('tang-dao', combo), getSourceAttackProfile('great-dao', combo),
      'both blade models preserve the same original blade clips');
  }
});

test('every weapon plays five distinct full-body attacks through the source runtime', () => {
  for (const weapon of WEAPONS) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    const attacks = [];
    for (let combo = 0; combo < SOURCE_ATTACK_COUNT; combo++) {
      const samples = [];
      for (const phase of [.15, .45, .75]) {
        poseCharacter(rig, { state: 'attack', combo, phase, dt: 1 / 60, immediate: true });
        assert.equal(rig.sourcePose.profile, getSourceAttackProfile(weapon.id, combo));
        assert.equal(rig.sourceMotionDebug.authored, weapon.id === 'great-hammer');
        assert.equal(rig.reviewedAttackSample, null, 'ordinary source clips own the final pose');
        assert.equal(rig.attackFootTargets, null, 'procedural foot targets do not overwrite source steps and jumps');
        samples.push(signature(rig));
      }
      assert.equal(new Set(samples).size, samples.length, `${weapon.id}: attack ${combo + 1} changes over time`);
      attacks.push(samples.join('|'));
    }
    assert.equal(new Set(attacks).size, SOURCE_ATTACK_COUNT, `${weapon.id}: five distinct attacks`);
  }
});

test('all equipped states and five attacks retain finite body and weapon transforms', () => {
  for (const weapon of WEAPONS) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    for (const state of ['idle', 'guard', 'walk', 'run', 'hurt', 'roll', 'attack']) {
      const count = state === 'attack' ? SOURCE_ATTACK_COUNT : 1;
      for (let action = 0; action < count; action++) for (let step = 0; step <= 10; step++) {
        poseCharacter(rig, { state, combo: action, phase: step / 10, time: step / 10,
          speedFactor: 7, dt: 1 / 60, immediate: true });
        assertFinite(rig, `${weapon.id}/${state}/${action}/${step}`);
      }
    }
  }
});

test('the custom hammer support hand remains joined during all five attacks and locomotion transitions', () => {
  const rig = createCharacter();
  rig.setWeapon('great-hammer');
  for (const state of ['idle', 'walk', 'run', 'attack']) {
    const actions = state === 'attack' ? SOURCE_ATTACK_COUNT : 1;
    for (let combo = 0; combo < actions; combo++) for (let frame = 0; frame <= 30; frame++) {
      poseCharacter(rig, { state, combo, phase: frame / 30, time: frame / 60, dt: 1 / 60, speedFactor: 7 });
      rig.group.updateMatrixWorld(true);
      const gap = rig.arms[0].wrist.getWorldPosition(vector()).distanceTo(rig.offhandGrip.getWorldPosition(vector()));
      assert.ok(gap < .005, `${state}/${combo}/${frame}: hammer support gap ${gap}`);
      assertFinite(rig, `hammer/${state}/${combo}/${frame}`);
    }
  }
});

test('equip switches preserve wrist roots, replace tip nodes and reset the source session to idle', () => {
  const rig = createCharacter();
  const roots = rig.arms.map(arm => arm.weapon);
  let previousTips = rig.weaponTipNodes;
  for (const weapon of [...WEAPONS, getWeapon(DEFAULT_WEAPON_ID)]) {
    poseCharacter(rig, { state: 'run', time: 1, dt: .2, speedFactor: 7 });
    poseCharacter(rig, { state: 'run', time: 1.2, dt: .2, speedFactor: 7 });
    poseCharacter(rig, { state: 'attack', combo: 4, phase: .5, time: 1.3, dt: 1 / 60 });
    const previousRuntime = rig.sourceMotionState;
    const previousClock = rig.sourceLocomotionClock;
    rig.setWeapon(weapon.id);
    assert.equal(rig.weaponId, weapon.id);
    assert.equal(rig.weaponDefinition, weapon);
    assert.deepEqual(rig.arms.map(arm => arm.weapon), roots);
    assert.equal(rig.weaponTips().length, weapon.grip === 'dual' ? 2 : 1, weapon.id);
    assert.notEqual(rig.weaponTipNodes, previousTips);
    assert.ok(previousTips.every(node => !rig.weaponTipNodes.includes(node)));
    assert.notEqual(rig.sourceMotionState, previousRuntime);
    assert.notEqual(rig.sourceLocomotionClock, previousClock);
    assert.equal(rig.sourceMotionState.weaponId, weapon.id);
    assert.equal(rig.sourceMotionDebug.state, 'idle');
    assert.equal(rig.sourceMotionDebug.rawTime, 0);
    assert.deepEqual(rig.sourceMotionDebug.locomotion.map(clip => clip.state), ['idle']);
    assertFinite(rig, weapon.id);
    previousTips = rig.weaponTipNodes;
  }
});

test('walk and run move the full body, and pause freezes every source carry and its clocks', () => {
  for (const weapon of WEAPONS) for (const state of ['idle', 'walk', 'run']) {
    const rig = createCharacter();
    rig.setWeapon(weapon.id);
    // Use an unchanged wall time to ensure movement comes from native clip
    // clocks, rather than the old procedural time or distance-driven gait.
    for (let frame = 0; frame < 8; frame++) poseCharacter(rig, { state, time: .5, dt: .05, speedFactor: 7 });
    const nodes = [rig.body, rig.chest, rig.head,
      ...rig.arms.map(arm => arm.wrist), ...rig.legs.map(leg => leg.foot)];
    const samples = nodes.map(() => new Set());
    for (let frame = 0; frame < 30; frame++) {
      poseCharacter(rig, { state, time: .5, dt: .05, speedFactor: 7 });
      rig.group.updateMatrixWorld(true);
      nodes.forEach((node, index) => samples[index].add([
        ...node.getWorldPosition(vector()), ...node.getWorldQuaternion(new THREE.Quaternion()),
      ].map(value => value.toFixed(5)).join(',')));
    }
    // Native idle clips hold their body pose; keep that authored stillness.
    // The walking and running clips animate every measured body part.
    if (state !== 'idle') nodes.forEach((node, index) => assert.ok(samples[index].size > 20,
      `${weapon.id}/${state}: ${node.name} follows the source carry`));
    assert.ok(rig.sourceMotionDebug.rawTime > 0, `${weapon.id}/${state}: native loop clock advances`);
    const before = transforms(rig);
    const debug = structuredClone(rig.sourceMotionDebug);
    for (let frame = 0; frame < 5; frame++) {
      poseCharacter(rig, { state: 'idle', time: 20 + frame, dt: 0, gaitPhase: frame * Math.PI });
      assert.deepEqual(transforms(rig), before, `${weapon.id}/${state}: pause freezes joints`);
      assert.deepEqual(rig.sourceMotionDebug, debug, `${weapon.id}/${state}: pause freezes source clocks`);
    }
  }
});

test('the four ordinary attack weapon types are available and removed ids normalize to the default', () => {
  assert.deepEqual([...UNLOCKED_WEAPON_IDS], ['dual-dao', 'tang-dao', 'great-dao', 'great-hammer']);
  assert.deepEqual(WEAPONS.map(weapon => weapon.name), ['双刀', '砍刀', '大刀', '大锤']);
  assert.equal(WEAPONS.filter(weapon => isWeaponUnlocked(weapon.id)).length, 4);
  for (const id of ['yanling-dao', 'miao-dao', 'ring-dao', 'war-hammer', 'unknown']) {
    assert.equal(getWeapon(id), getWeapon(DEFAULT_WEAPON_ID), `${id}: normalize old save`);
    assert.equal(isWeaponUnlocked(id), false, `${id}: unavailable`);
    assert.equal(getSourceAttackProfile(id), null, `${id}: no source action binding`);
  }
  for (const weapon of WEAPONS) for (let index = 0; index < SOURCE_ATTACK_COUNT; index++) {
    assert.equal(getReviewedAttack(weapon.id, index, 'skill'), null, `${weapon.id}: no runtime skill ${index}`);
  }
});

test('dual dao retains all five original attack identities and native inventory speed', () => {
  const weapon = getWeapon('dual-dao');
  assert.deepEqual(weapon.moves.map(move => move.sourceName), [
    'attack1_duel', 'attack2_duel', 'attack3_duel', 'attack4_duel', 'attack5_duel',
  ]);
  for (let combo = 0; combo < SOURCE_ATTACK_COUNT; combo++) {
    const timing = getSourceAttackTiming(weapon.id, combo);
    assert.equal(timing.atkspd, -.01);
    assert.equal(timing.attackSpeed, Math.fround(Math.fround(.24) + Math.fround(-.01)));
    assert.equal(timing.recoverySpeed, Math.fround(.24));
    assert.equal(weapon.moves[combo].duration, timing.profile.attackRaw / timing.attackSpeed
      + timing.profile.recoveryRaw / timing.recoverySpeed);
  }
});
