import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEffects } from '../src/effects.js';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { getReviewedAttack } from '../src/choreography/index.js';

function fixture(preserve = true) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const fx = createEffects(scene, camera), trail = fx.swordTrail();
  trail.preserveUntilPresented = preserve;
  const rig = createCharacter('hero');
  rig.setWeapon('great-dao');
  const action = getReviewedAttack('great-dao', 0);
  const sample = (phase, active = true, dt = 1 / 120) => {
    poseCharacter(rig, { state: 'attack', combo: 0, phase,
      time: phase * action.duration, immediate: true, transition: false });
    const frame = rig.weaponBlades()[0];
    fx.sample(trail, frame.tip, frame.heel, active, dt);
    return frame;
  };
  const seed = () => {
    sample(action.active[0] + .015);
    sample(action.active[0] + .035);
    assert.ok(trail.mesh.geometry.drawRange.count > 0, 'the real blade samples form a ribbon');
  };
  return { fx, trail, sample, seed, action };
}

test('a real great dao trail survives thirty simulation steps before its first draw', () => {
  const { fx, trail, sample, action } = fixture();
  // End well after the contact window: the original 105 ms fade would erase
  // every point before this 250 ms display frame can present the blade.
  const start = Math.max(0, action.active[1] * action.duration + .125 - .25);
  for (let step = 0; step < 30; step++) {
    const phase = Math.min(1, (start + step / 120) / action.duration);
    sample(phase, phase >= action.active[0] && phase <= action.active[1]);
  }
  assert.ok(trail.mesh.geometry.drawRange.count > 0, 'the physical slash must reach its first draw');
  assert.ok(trail.points.some(point => point.awaitingPresentation));
  assert.ok([...trail.mesh.geometry.attributes.position.array].every(Number.isFinite));
  fx.presented();
  assert.ok(trail.points.every(point => !point.awaitingPresentation && point.age === 0));
  sample(1, false, .05);
  assert.ok(trail.mesh.geometry.drawRange.count > 0, 'the presented blade fades over its normal lifetime');
  fx.presented();
  sample(1, false, .06);
  assert.equal(trail.mesh.geometry.drawRange.count, 0, 'later draws must not restart the fade');
  assert.equal(trail.points.length, 0);
  fx.destroy();
});

test('ordinary weapon trails retain their original 105 ms simulation fade', () => {
  const { fx, trail, sample, seed } = fixture(false);
  seed();
  assert.ok(trail.points.every(point => !point.awaitingPresentation));
  sample(1, false, .11);
  assert.equal(trail.mesh.geometry.drawRange.count, 0);
  assert.equal(trail.points.length, 0);
  fx.destroy();
});

test('unpresented real blade samples time out after half a second', () => {
  const { fx, trail, sample, seed } = fixture();
  seed();
  sample(1, false, .49);
  assert.ok(trail.mesh.geometry.drawRange.count > 0);
  sample(1, false, .01);
  assert.equal(trail.mesh.geometry.drawRange.count, 0);
  assert.equal(trail.points.length, 0);
  assert.ok(trail.spare.every(point => !point.awaitingPresentation));
  fx.destroy();
});

test('zero simulation time preserves both unseen and presented blade samples', () => {
  const { fx, trail, sample, seed } = fixture();
  seed();
  const before = trail.points.map(point => ({ age: point.age, unseenAge: point.unseenAge }));
  for (let step = 0; step < 30; step++) sample(1, false, 0);
  assert.deepEqual(trail.points.map(point => ({ age: point.age, unseenAge: point.unseenAge })), before);
  fx.presented();
  sample(1, false, .03);
  const ages = trail.points.map(point => point.age);
  for (let step = 0; step < 30; step++) sample(1, false, 0);
  assert.deepEqual(trail.points.map(point => point.age), ages);
  assert.ok(trail.mesh.geometry.drawRange.count > 0);
  fx.destroy();
});

test('clear drops unseen blade samples and their source before changing weapons', () => {
  const { fx, trail, sample, seed } = fixture();
  seed();
  trail.previousBlade = { source: 'great-dao:old-stroke' };
  fx.clear();
  assert.equal(trail.previousBlade, null);
  assert.equal(trail.points.length, 0);
  assert.equal(trail.mesh.geometry.drawRange.count, 0);
  assert.ok(trail.spare.every(point => !point.awaitingPresentation));
  trail.preserveUntilPresented = false;
  sample(.4);
  sample(.42);
  assert.ok(trail.points.every(point => !point.awaitingPresentation));
  sample(1, false, .11);
  assert.equal(trail.points.length, 0);
  fx.destroy();
});

test('real blade sample storage stays bounded while presentation is delayed', () => {
  const { fx, trail, sample, action } = fixture();
  for (let step = 0; step < 100; step++) {
    sample(action.active[0] + (action.active[1] - action.active[0]) * step / 99, true, .001);
    assert.ok(trail.points.length <= 29);
    assert.equal(trail.points.length + trail.spare.length, 32);
  }
  fx.clear();
  assert.equal(trail.spare.length, 32);
  fx.destroy();
});
