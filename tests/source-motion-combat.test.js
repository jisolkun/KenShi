import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getSourceAttackRule, createSourceAttackVolumes, advanceSourceAttackVolumes,
  sourceVolumeGeometry, sourceVolumeContains, sourceForceTravel } from '../src/sourceMotion/combat.js';
import { createSourceFeedback, sourceSwingShapeAudit } from '../src/sourceMotion/feedback.js';

const root = () => ({ pos: new THREE.Vector3(), facing: 0 });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('source collision occurs on atlas frames 1 and 2 after the show delay', () => {
  const volumes = createSourceAttackVolumes('tang-dao', 0), displayed = [], colliding = [], shown = [], impacts = [];
  for (let frame = 1; frame <= 19; frame++) {
    const event = advanceSourceAttackVolumes(volumes, .02, root());
    if (volumes[0].clock.visible) displayed.push(frame);
    if (event.active.length) colliding.push(frame);
    if (event.onsets.length) shown.push(frame);
    if (event.impacts.length) impacts.push(frame);
  }
  assert.deepEqual(shown, [9], 'original countdown checks the preceding delay before ShowOn');
  assert.deepEqual(impacts, [11], 'impact and particles begin on the second atlas frame');
  assert.deepEqual(colliding, [11, 12, 13, 14, 15]);
  assert.deepEqual(displayed, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(volumes[0].clock.finished, true);
});

test('dual blades retain separate source emitters, onset forces and target contacts', () => {
  const rule = getSourceAttackRule('dual-dao', 0), volumes = createSourceAttackVolumes('dual-dao', 0), onsets = [];
  assert.equal(rule.startForce, 120);
  assert.deepEqual(rule.volumes.map(volume => volume.delay), [.15, .4]);
  for (let frame = 0; frame < 40; frame++) onsets.push(...advanceSourceAttackVolumes(volumes, .02, root()).onsets);
  assert.deepEqual(onsets.map(event => [event.descriptor.emitter, event.addForce]), [['swing1', 0], ['swing2', 100]]);
  volumes[0].hitTargets.add('enemy');
  assert.equal(volumes[1].hitTargets.has('enemy'), false, 'one blade cannot suppress a later source emitter');
  assert.equal(getSourceAttackRule('dual-dao', 3).volumes.length, 1);
  assert.deepEqual(getSourceAttackRule('dual-dao', 4).volumes.map(volume => volume.delay), [.4, .4]);
});

test('original sphere and thrust capsule rotate with the root and reject targets above them', () => {
  const hero = root(), slash = getSourceAttackRule('tang-dao', 0).volumes[0];
  const sphere = sourceVolumeGeometry(slash, hero);
  close(sphere.radius, 2); close(sphere.center.y, .6875); close(sphere.center.z, 1);
  hero.facing = Math.PI / 2;
  const turned = sourceVolumeGeometry(slash, hero);
  close(turned.center.x, 1); close(turned.center.z, 0);
  assert.equal(sourceVolumeContains(slash, { pos: new THREE.Vector3(2.8, 0, 0), radius: .3 }, hero), true);
  assert.equal(sourceVolumeContains(slash, { pos: new THREE.Vector3(0, 5, 0), radius: .3 }, hero), false);
  const thrust = getSourceAttackRule('tang-dao', 3).volumes[0];
  hero.facing = 0;
  const capsule = sourceVolumeGeometry(thrust, hero);
  assert.equal(capsule.type, 'capsule'); close(capsule.radius, .125);
  assert.equal(sourceVolumeContains(thrust, { pos: new THREE.Vector3(0, 0, 5), radius: .3 }, hero), true);
  assert.equal(sourceVolumeContains(thrust, { pos: new THREE.Vector3(2, 0, 5), radius: .3 }, hero), false);
});

test('snapshot ground feedback keeps its show position after the attacker moves, then stops collision', () => {
  // Exercise the reusable source snapshot-volume API with a ground descriptor.
  // Equipped great dao attacks use a single live-root blade volume.
  assert.deepEqual(createSourceAttackVolumes('great-dao', 1, .02).map(volume => volume.descriptor.type), ['swing']);
  const hero = root();
  const splash = {
    descriptor: { type: 'splash', emitter: 'splash', delay: .48, position: [0, .02, .1],
      rotation: [0, 0, 0], rotationOrder: 'YXZ', scale: [1.6, 1.6, 1.6],
      collider: { type: 'sphere', radius: .12, center: [0, 0, 0] }, originMode: 'snapshot', addForce: 0 },
    clock: { kind: 'splash', pending: true, showtime: Math.fround(1.5), elapsed: 0, frame: 0,
      visible: false, colliding: false, finished: false, tint: 1, fireFrame: 0, fireVisible: false,
      justStarted: false },
    age: 0, inside: new Set(), hitTargets: new Set(), cancelled: false, started: false,
    origin: null, facing: null,
  };
  const volumes = [splash];
  close(splash.descriptor.delay, .48);
  for (let frame = 0; frame < 24; frame++) advanceSourceAttackVolumes(volumes, .02, hero);
  assert.equal(splash.started, true); close(splash.origin.z, 1.25); close(splash.origin.y, .25);
  const origin = splash.origin.clone(); hero.pos.set(12, 0, 12); hero.facing = Math.PI;
  for (let frame = 0; frame < 11; frame++) advanceSourceAttackVolumes(volumes, .02, hero);
  assert.ok(splash.origin.equals(origin)); assert.equal(splash.clock.colliding, false);
  assert.equal(splash.clock.visible, true, 'ground feedback outlives the short collision window');
  for (let frame = 0; frame < 70; frame++) advanceSourceAttackVolumes(volumes, .02, hero);
  assert.equal(splash.clock.finished, true);
});

test('source display feedback follows the live slash root and shares combat collision frames', () => {
  const scene = new THREE.Scene(), actor = new THREE.Group(); scene.add(actor);
  const feedback = createSourceFeedback(scene), volumes = createSourceAttackVolumes('dual-dao', 0);
  const effect = feedback.emit(actor, volumes[0].descriptor, volumes[0]);
  for (let frame = 0; frame < 11; frame++) {
    advanceSourceAttackVolumes(volumes, .02, actor); feedback.update(.02);
  }
  assert.equal(effect.userData.atlasFrame, 1); assert.equal(effect.userData.collisionActive, true);
  actor.position.set(4, 0, 3); actor.rotation.y = .8; feedback.update(.02);
  assert.ok(effect.position.distanceTo(actor.position) < 1e-8);
  assert.ok(effect.quaternion.angleTo(actor.quaternion) < 1e-7);
  for (let frame = 0; frame < 20; frame++) { advanceSourceAttackVolumes(volumes, .02, actor); feedback.update(.02); }
  assert.equal(feedback.diagnostics().active, 0); assert.equal(effect.parent, null);
  feedback.clear();
});

test('slash geometry preserves supplied texture color and measured alpha budgets', () => {
  const source = sourceSwingShapeAudit();
  const swings = source.filter(shape => shape.family === 'swing1');
  assert.equal(swings.length, 4);
  assert.deepEqual(swings[0].sourceColor, [142, 151, 250]);
  for (const shape of source) assert.ok(Math.abs(shape.authoredAlphaMass - shape.sourceAlphaMass) < 1e-10);
});

test('source impulse travel uses mass, fixed stepping and original drag', () => {
  close(sourceForceTravel(110, .02), .2475);
  close(sourceForceTravel(110, .04) - sourceForceTravel(110, .02), .22275);
  close(sourceForceTravel(110, .01), .12375);
  close(sourceForceTravel(110, .4), -sourceForceTravel(-110, .4));
  assert.ok(sourceForceTravel(110, 2) > sourceForceTravel(110, 1));
  assert.ok(sourceForceTravel(110, 2) < 2.475);
});
