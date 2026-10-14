import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_ATTACK_COUNT, SOURCE_WEAPON_FAMILIES,
  getSourceAttackProfile, getSourceActionProfile, getSourceAttackTiming,
  getSourceMotionProvenance, createSourceWeaponMoves, getSourceLocomotionSpeed,
} from '../src/sourceMotion/catalogue.js';
import {
  createSourceAttackClock, advanceSourceAttackClock, sampleSourceAttackClock,
  createSourceLocomotionClock, advanceSourceLocomotionClock, sampleSourceLocomotion,
} from '../src/sourceMotion/clock.js';
import { referenceWeaponAttackProfiles } from '../src/sourceMotion/data.js';

const close = (actual, expected, epsilon = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);

test('all registered weapons use five original profiles without changing sampler identities', () => {
  assert.equal(SOURCE_ATTACK_COUNT, 5);
  for (const [id, family] of Object.entries(SOURCE_WEAPON_FAMILIES)) {
    for (let combo = 0; combo < SOURCE_ATTACK_COUNT; combo++) {
      const profile = getSourceAttackProfile(id, combo);
      assert.equal(profile, referenceWeaponAttackProfiles.hero[family][combo]);
      assert.equal(profile.weaponFamily, family);
      assert.equal(profile.combo, combo);
      assert.equal(profile.recoveryRaw > 0, combo < 4);
    }
    assert.equal(getSourceActionProfile(id, 'run').weaponFamily, family);
    assert.notEqual(getSourceActionProfile(id, 'run'), getSourceActionProfile(id, 'walk'));
  }
  assert.equal(getSourceAttackProfile('unregistered-weapon'), null);
  assert.equal(getSourceActionProfile('dual-dao', 'dead'), getSourceActionProfile('dual-dao', 'death'));
});

test('registered weapons use their source motion without fallback', () => {
  for (const id of Object.keys(SOURCE_WEAPON_FAMILIES)) {
    assert.equal(getSourceMotionProvenance(id).fallback, false);
  }
});

test('ordinary durations use initial inventory atkspd and fixed queued recovery speed', () => {
  for (const id of Object.keys(SOURCE_WEAPON_FAMILIES)) {
    const profile = getSourceAttackProfile(id, 0);
    const timing = getSourceAttackTiming(id, 0);
    const atkspd = id === 'dual-dao' ? -.01 : .02;
    const speed = Math.fround(Math.fround(.24) + Math.fround(atkspd));
    assert.equal(timing.atkspd, atkspd);
    assert.equal(timing.attackSpeed, speed);
    assert.equal(timing.recoverySpeed, Math.fround(.24));
    assert.equal(timing.attackSeconds, profile.attackRaw / speed);
    assert.equal(timing.duration, timing.attackSeconds + timing.recoverySeconds);
    close(timing.recoverAt, timing.attackSeconds / timing.duration);
    close(timing.hitDelay, profile.hitDelay - atkspd);
    assert.equal(timing.samplerDuration, profile.duration);
  }
  assert.throws(() => getSourceAttackTiming('dual-dao', 0, { atkspd: -.3 }), RangeError);
});

test('five source moves expose actual recovery boundaries and retain the final balance move', () => {
  const base = [1, 2, 3, 4].map(damage => ({ damage, shape: 'arc' }));
  const moves = createSourceWeaponMoves('great-dao', base);
  assert.equal(moves.length, 5);
  assert.equal(new Set(moves.map(move => move.name)).size, 5);
  assert.deepEqual(moves.map(move => move.damage), [1, 2, 3, 3, 4]);
  for (const [combo, move] of moves.entries()) {
    const timing = getSourceAttackTiming('great-dao', combo);
    assert.equal(move.duration, timing.duration);
    assert.equal(move.recoverAt, timing.recoverAt);
    assert.equal(move.sourceFinisher, combo === 4);
    assert.equal(move.sourceName, getSourceAttackProfile('great-dao', combo).name);
  }
  assert.equal(moves[4].recoverAt, 1);
  assert.equal(moves[4].sourceRecoverySeconds, 0);
});

test('Update Play first evaluation has zero cursor then advances native float products', () => {
  const clock = createSourceAttackClock('tang-dao', 0);
  const first = advanceSourceAttackClock(clock, .1);
  assert.equal(first.rawTime, 0);
  assert.equal(first.elapsed, 0);
  const next = advanceSourceAttackClock(clock, .1);
  assert.equal(next.rawTime, Math.fround(Math.fround(.1) * clock.timing.attackSpeed));
  close(next.phase, next.rawTime / (.24 * clock.profile.duration));
  close(next.progress, next.elapsed / clock.timing.duration);
  assert.notEqual(next.phase, next.progress, 'native speed affects game duration, not sampler calibration');
});

test('Fixed-origin first interval can be provided separately from the display delta', () => {
  const clock = createSourceAttackClock('dual-dao', 0, { origin: 'fixed', firstDelta: .025 });
  const sample = advanceSourceAttackClock(clock, .2);
  assert.equal(sample.rawTime, Math.fround(Math.fround(.025) * clock.timing.attackSpeed));
});

test('attack expiry enables queued recovery at zero and discards evaluation overflow', () => {
  const clock = createSourceAttackClock('great-dao', 1);
  advanceSourceAttackClock(clock, 0);
  const boundary = advanceSourceAttackClock(clock, clock.timing.attackSeconds + .2);
  assert.equal(boundary.segment, 'recovery');
  assert.equal(boundary.rawTime, 0);
  assert.equal(boundary.recovering, true);
  assert.equal(boundary.transitioned, true);
  assert.equal(boundary.done, false);
  close(boundary.phase, clock.profile.clipBoundaries[0].phase);
  close(boundary.elapsed, clock.timing.attackSeconds);
  const next = advanceSourceAttackClock(clock, .1);
  assert.equal(next.rawTime, Math.fround(Math.fround(.1) * Math.fround(.24)));
  close(next.phase, clock.profile.clipBoundaries[0].phase
    + next.rawTime / (clock.profile.duration * clock.profile.recoverySpeed));
  assert.equal(next.transitioned, false);
});

test('recovery expiry completes the ordinary session and hold preserves it exactly', () => {
  const clock = createSourceAttackClock('dual-dao', 0);
  advanceSourceAttackClock(clock, 0);
  advanceSourceAttackClock(clock, clock.timing.attackSeconds + .1);
  const before = sampleSourceAttackClock(clock);
  assert.deepEqual(advanceSourceAttackClock(clock, 1, { hold: true }), before);
  const end = advanceSourceAttackClock(clock, clock.timing.recoverySeconds + .1);
  assert.equal(end.done, true);
  assert.equal(end.segment, 'complete');
  assert.equal(end.phase, 1);
  assert.equal(end.progress, 1);
  assert.equal(end.elapsed, clock.timing.duration);
});

test('source attack5 has no recovery and returns directly to locomotion', () => {
  const clock = createSourceAttackClock('great-dao', 4);
  advanceSourceAttackClock(clock, 0);
  const end = advanceSourceAttackClock(clock, clock.timing.attackSeconds + .1);
  assert.equal(end.done, true);
  assert.equal(end.recovering, false);
  assert.equal(end.recoverySeconds, 0);
});

test('idle, run and walk use distinct source raw speeds and time-based phases', () => {
  assert.equal(getSourceLocomotionSpeed('idle'), .1);
  assert.equal(getSourceLocomotionSpeed('run'), .6);
  close(getSourceLocomotionSpeed('walk', 3), .6);
  const clock = createSourceLocomotionClock();
  assert.equal(advanceSourceLocomotionClock(clock, 'dual-dao', 'run', .2)[0].rawTime, 0);
  const sample = advanceSourceLocomotionClock(clock, 'dual-dao', 'run', .2)[0];
  assert.equal(sample.rawTime, Math.fround(Math.fround(.2) * Math.fround(.6)));
  close(sample.phase, sample.rawTime / sample.rawDuration);
  assert.equal(sample.weight, 1);
});

test('locomotion crossfades in .3 seconds while outgoing clips keep advancing', () => {
  const clock = createSourceLocomotionClock();
  advanceSourceLocomotionClock(clock, 'tang-dao', 'idle', 0);
  const entering = advanceSourceLocomotionClock(clock, 'tang-dao', 'run', .1);
  assert.equal(entering.length, 1, 'incoming target first native evaluation has zero weight');
  assert.equal(entering[0].state, 'idle');
  close(entering[0].weight, 2 / 3);
  const mixed = advanceSourceLocomotionClock(clock, 'tang-dao', 'run', .15);
  assert.equal(mixed.length, 2);
  const run = mixed.find(sample => sample.state === 'run');
  close(run.weight, .5);
  assert.ok(run.rawTime > 0);
  const finished = advanceSourceLocomotionClock(clock, 'tang-dao', 'run', .16);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].state, 'run');
  assert.equal(finished[0].weight, 1);
});

test('independent rig locomotion clocks and paused blends remain isolated', () => {
  const firstRig = { weaponId: 'great-dao' }, secondRig = { weaponId: 'great-dao' };
  sampleSourceLocomotion(firstRig, { state: 'run', dt: 0 });
  sampleSourceLocomotion(secondRig, { state: 'idle', dt: 0 });
  const running = sampleSourceLocomotion(firstRig, { state: 'run', dt: .2 });
  assert.notEqual(firstRig.sourceLocomotionClock, secondRig.sourceLocomotionClock);
  assert.deepEqual(sampleSourceLocomotion(firstRig, { state: 'walk', dt: 1, hold: true }), running);
  assert.equal(sampleSourceLocomotion(secondRig, { state: 'idle', dt: .2 })[0].state, 'idle');
});
