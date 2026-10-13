import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../src/characters.js';
import { createWeaponFeedback } from '../src/sourceMotion/weaponFeedback.js';
import { createSourceAttackVolumes, advanceSourceAttackVolumes } from '../src/sourceMotion/combat.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const shownClock = () => ({ visible: true, finished: false, frame: 1, colliding: true, tint: 1 });
function setup(weaponId, hand = 1, emitter = 'swing1') {
  const scene = new THREE.Scene(), rig = createCharacter('hero'); rig.setWeapon(weaponId); scene.add(rig.group);
  const feedback = createWeaponFeedback(scene), descriptor = { weaponId, hand, emitter, type: 'swing' };
  const volume = { descriptor, clock: shownClock(), cancelled: false };
  const group = feedback.emit(rig.group, descriptor, volume, rig);
  return { scene, rig, feedback, descriptor, volume, group };
}

test('each equipped weapon selects an independent visual language', () => {
  const styles = new Set();
  for (const id of ['dual-dao', 'tang-dao', 'great-dao', 'great-hammer']) {
    const f = setup(id); f.feedback.update(.02);
    const d = f.feedback.diagnostics().effects[0]; styles.add(d.style);
    assert.equal(d.weaponId, id); assert.equal(d.collision, true);
    assert.equal(d.attachment, 'actual-weapon-world-path');
    if (id === 'great-hammer') {
      assert.deepEqual(f.group.children.map(mesh => mesh.name), ['solid-hammer-head-ghosts', 'short-head-pressure', 'hammer-amber-sparks']);
      assert.ok(f.group.children.every(mesh => !/blade|edge|slash|dart|moon|ribbon|star/.test(mesh.name)));
      assert.equal(f.group.children[0].geometry.type, 'BoxGeometry');
      assert.ok(f.group.children[0].count > 0);
    }
    f.feedback.clear();
  }
  assert.equal(styles.size, 4);
});

test('dual blades follow both real hands and their individual moving weapon orientation', () => {
  const f = setup('dual-dao', 1);
  const offDescriptor = { weaponId: 'dual-dao', hand: 0, type: 'swing', emitter: 'swing2' };
  const offVolume = { descriptor: offDescriptor, clock: shownClock() };
  const offGroup = f.feedback.emit(f.rig.group, offDescriptor, offVolume, f.rig);
  f.rig.group.position.set(8, 1, -4); f.rig.group.rotation.set(.1, .9, -.2);
  f.rig.arms[0].weapon.rotation.z = .7; f.rig.arms[1].weapon.rotation.x = -.55;
  f.feedback.update(.02);
  for (const [hand, group] of [[0, offGroup], [1, f.group]]) {
    const frame = f.rig.weaponBlades().find(blade => blade.hand === hand);
    const effect = f.feedback.diagnostics().effects.find(effect => effect.hand === hand);
    assert.ok(v(...effect.sample).distanceTo(frame.tip) < 1e-8);
    const glint = group.getObjectByName('real-blade-edge-glint');
    const glintAxis = v(0, 1, 0).applyQuaternion(glint.quaternion);
    assert.ok(glintAxis.dot(frame.tip.clone().sub(frame.heel).normalize()) > .999999);
  }
  f.rig.group.position.x += 3; f.rig.arms[0].weapon.rotation.z += .5;
  f.feedback.update(.02);
  const offFrame = f.rig.weaponBlades().find(frame => frame.hand === 0);
  assert.ok(v(...f.feedback.diagnostics().effects.find(effect => effect.hand === 0).sample).distanceTo(offFrame.tip) < 1e-8);
  assert.equal(f.feedback.diagnostics().sampledRigs, 1, 'two emitters share one rig sampling pass');
  assert.notEqual(offGroup.getObjectByName('physical-blade-path').material.uniforms.tint.value.getHex(),
    f.group.getObjectByName('physical-blade-path').material.uniforms.tint.value.getHex());
  f.feedback.clear();
});

test('the long dao trail stores the actual world tip instead of a root-centered atlas plane', () => {
  const f = setup('great-dao');
  f.rig.group.position.set(25, 2, 11); f.feedback.update(.02);
  f.rig.arms[1].weapon.rotation.z = .7; f.feedback.update(.02);
  const path = f.group.getObjectByName('physical-blade-path'), frame = f.rig.weaponBlades()[0];
  const points = path.geometry.attributes.position;
  const lastMidpoint = v((points.getX(2) + points.getX(3)) / 2, (points.getY(2) + points.getY(3)) / 2,
    (points.getZ(2) + points.getZ(3)) / 2);
  assert.ok(lastMidpoint.distanceTo(frame.tip) < .000005);
  assert.equal(path.geometry.drawRange.count, 6); assert.equal(f.group.position.length(), 0);
  f.feedback.clear();
});

test('hammer ghosts preserve the real forged head world orientation and size', () => {
  const f = setup('great-hammer');
  f.rig.group.position.set(-5, 1, 3); f.rig.group.rotation.y = 1.1; f.rig.arms[1].weapon.rotation.z = .8;
  f.feedback.update(.02);
  const frame = f.rig.weaponBlades()[0], ghost = f.group.getObjectByName('solid-hammer-head-ghosts');
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  ghost.getMatrixAt(0, matrix); matrix.decompose(p, q, s);
  assert.ok(p.distanceTo(frame.headCenter) < .000001); assert.ok(q.normalize().angleTo(frame.headQuaternion) < .00001);
  assert.ok(s.distanceTo(frame.headHalfExtents.clone().multiplyScalar(2.015)) < .000001);
  f.feedback.clear();
});

test('pending source visuals stay hidden and zero delta freezes sampled geometry and visual tails', () => {
  const f = setup('tang-dao'); f.volume.clock.visible = false; f.volume.clock.colliding = false;
  f.feedback.update(.02); assert.equal(f.group.visible, false); assert.equal(f.feedback.diagnostics().effects[0].samples, 0);
  f.volume.clock.visible = true; f.feedback.update(.02);
  const before = f.feedback.diagnostics(); f.rig.group.position.x += 5;
  f.volume.clock.finished = true; f.volume.clock.visible = false;
  f.feedback.update(0);
  assert.deepEqual(f.feedback.diagnostics().effects[0].sample, before.effects[0].sample);
  assert.equal(f.group.visible, true);
  f.feedback.update(.02); assert.equal(f.feedback.diagnostics().effects[0].collision, false);
  for (let frame = 0; frame < 12; frame++) f.feedback.update(.02);
  assert.equal(f.feedback.diagnostics().active, 0); assert.equal(f.group.parent, null);
  f.feedback.clear();
});

test('visuals use source display and collision frames without extending or cancelling combat', () => {
  const f = setup('tang-dao'); f.feedback.clear();
  const volumes = createSourceAttackVolumes('tang-dao', 0), volume = volumes[0];
  const descriptor = { ...volume.descriptor, weaponId: 'tang-dao', hand: 1 };
  const group = f.feedback.emit(f.rig.group, descriptor, volume, f.rig);
  for (let frame = 0; frame < 30; frame++) {
    advanceSourceAttackVolumes(volumes, .02, f.rig.group); f.feedback.update(.02);
    if (group.parent) assert.equal(group.userData.collisionActive, volume.clock.visible && volume.clock.colliding);
  }
  assert.equal(volume.clock.finished, true); assert.equal(volume.cancelled, false);
  assert.equal(f.feedback.diagnostics().active, 0);
  const second = { descriptor, clock: shownClock(), cancelled: false };
  const cancelledGroup = f.feedback.emit(f.rig.group, descriptor, second, f.rig); cancelledGroup.cancel();
  assert.equal(second.cancelled, false, 'destroying an effect does not destroy its authoritative source volume');
  f.feedback.clear();
});

test('hammer ground pressure waits for real floor contact and holds its snapshot after the actor moves', () => {
  const scene = new THREE.Scene(), actor = new THREE.Group(); scene.add(actor);
  let bottom = v(7, .8, -2), head = v(7, 1, -2);
  const rig = { weaponId: 'great-hammer', weaponBlades: () => [{ hand: 1, heel: v(7, 2, -2), tip: head,
    edge: v(1, 0, 0), headCenter: head, headBottom: bottom, headMinY: bottom.y,
    headQuaternion: new THREE.Quaternion(), headHalfExtents: v(.27, .19, .19) }] };
  const descriptor = { weaponId: 'great-hammer', hand: 1, type: 'splash', emitter: 'splash' };
  const volume = { descriptor, clock: shownClock() }, feedback = createWeaponFeedback(scene);
  const effect = feedback.emit(actor, descriptor, volume, rig); feedback.update(.02);
  assert.equal(effect.visible, false, 'airborne hammer does not put its pressure ring at an arbitrary root offset');
  bottom = v(8, .048, -3); head = v(8, .24, -3); feedback.update(.02);
  assert.deepEqual(feedback.diagnostics().effects[0].floorContact, [8, .068, -3]);
  assert.equal(effect.visible, true);
  assert.ok(effect.children.every(child => !/blade|fire|slash|dart|moon/.test(child.name)));
  actor.position.set(10, 0, 10); bottom = v(20, .1, 20); feedback.update(.02);
  assert.deepEqual(effect.position.toArray(), [8, .068, -3]);
  volume.clock.colliding = false; feedback.update(.3); assert.equal(effect.userData.collisionActive, false);
  volume.clock.finished = true; feedback.update(.02); assert.equal(feedback.diagnostics().active, 0);
  feedback.clear();
});

test('visual replacement and bounded pools preserve rig materials and combat ownership', () => {
  const f = setup('great-hammer'), volumes = [];
  let rigDisposals = 0;
  for (const mat of Object.values(f.rig.materials)) mat.addEventListener('dispose', () => rigDisposals++);
  for (let i = 0; i < 120; i++) {
    const descriptor = { weaponId: 'great-hammer', hand: 1, type: 'swing', emitter: `unique-${i}` };
    const volume = { descriptor, clock: shownClock(), cancelled: false }; volumes.push(volume);
    f.feedback.emit(f.rig.group, descriptor, volume, f.rig); f.feedback.update(.008);
    assert.ok(f.feedback.diagnostics().active <= f.feedback.diagnostics().capacity);
    assert.ok(f.feedback.diagnostics().pooled <= f.feedback.diagnostics().capacity);
  }
  assert.ok(volumes.every(volume => !volume.cancelled));
  f.feedback.clear(); assert.equal(rigDisposals, 0); assert.equal(f.feedback.diagnostics().pooled, 0);
  assert.deepEqual(f.scene.children, [f.rig.group]);
});

test('instanced GPU buffers dispose only on final cleanup and slot eviction, preserving normal pool reuse', () => {
  const f = setup('great-hammer'); let disposals = 0;
  for (const mesh of f.group.children) if (mesh.isInstancedMesh) mesh.addEventListener('dispose', () => disposals++);
  f.group.cancel();
  assert.equal(disposals, 0, 'returning a slot to the pool keeps its GPU instance buffers');
  f.feedback.emit(f.rig.group, f.descriptor, f.volume, f.rig);
  assert.equal(disposals, 0, 'normal slot reuse keeps its instance buffers');
  f.feedback.clear();
  assert.equal(disposals, 3, 'clear releases each hammer InstancedMesh buffer exactly once');

  const g = setup('great-hammer'); let evictedDisposals = 0;
  for (const mesh of g.group.children) if (mesh.isInstancedMesh) mesh.addEventListener('dispose', () => evictedDisposals++);
  for (let i = 1; i < g.feedback.diagnostics().capacity; i++) {
    const descriptor = { ...g.descriptor, emitter: `slot-${i}` };
    g.feedback.emit(g.rig.group, descriptor, { descriptor, clock: shownClock() }, g.rig);
  }
  const descriptor = { weaponId: 'tang-dao', hand: 1, type: 'swing', emitter: 'replace-kind' };
  g.feedback.emit(g.rig.group, descriptor, { descriptor, clock: shownClock() }, g.rig);
  assert.equal(evictedDisposals, 3, 'evicting an unused slot of another kind releases its instance buffers');
  g.feedback.clear();
  assert.equal(evictedDisposals, 3, 'clear does not dispose an already evicted slot twice');
});
