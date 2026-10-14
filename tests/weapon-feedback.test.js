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

test('each source blade weapon selects an independent visual language', () => {
  const styles = new Set();
  for (const id of ['dual-dao', 'tang-dao', 'great-dao']) {
    const f = setup(id); f.feedback.update(.02);
    const d = f.feedback.diagnostics().effects[0]; styles.add(d.style);
    assert.equal(d.weaponId, id); assert.equal(d.collision, true);
    assert.equal(d.attachment, 'actual-weapon-world-path');
    f.feedback.clear();
  }
  assert.equal(styles.size, 3);
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

test('the long dao sweep spans the real posed blade in world space and extends its outer edge', () => {
  const f = setup('great-dao');
  f.rig.group.position.set(25, 2, 11); f.feedback.update(.02);
  f.rig.arms[1].weapon.rotation.z = .7; f.feedback.update(.02);
  const path = f.group.getObjectByName('physical-blade-path'), frame = f.rig.weaponBlades()[0];
  const points = path.geometry.attributes.position, alphas = path.geometry.attributes.effectAlpha;
  const lastInner = v(points.getX(4), points.getY(4), points.getZ(4));
  const lastOuter = v(points.getX(7), points.getY(7), points.getZ(7));
  const bladeDirection = frame.tip.clone().sub(frame.heel), [inner, outer] = path.geometry.userData.radialRange;
  assert.ok(lastInner.distanceTo(frame.heel.clone().addScaledVector(bladeDirection, inner)) < .000005);
  assert.ok(lastOuter.distanceTo(frame.heel.clone().addScaledVector(bladeDirection, outer)) < .000005);
  assert.ok(lastOuter.distanceTo(frame.tip) > .45, 'the arc has a visibly exaggerated tip extension');
  assert.equal(alphas.getX(4), 0); assert.equal(alphas.getX(7), 0);
  assert.ok(alphas.getX(5) > .1 && alphas.getX(6) > .3, 'the broad arc has a soft center and bright outer body');
  assert.equal(path.geometry.drawRange.count, 18); assert.equal(f.group.position.length(), 0);
  f.feedback.clear();
});

test('all blade trails have a broad swept face, distinct reach and layered brightness without a white sheet', () => {
  const widths = [], extensions = [], tails = [];
  for (const id of ['dual-dao', 'tang-dao', 'great-dao']) {
    const f = setup(id); f.feedback.update(.01);
    f.rig.arms[1].weapon.rotation.z += .65; f.feedback.update(.02);
    const frame = f.rig.weaponBlades().find(frame => frame.hand === 1), length = frame.tip.distanceTo(frame.heel);
    const diagnostic = f.feedback.diagnostics().effects[0], range = diagnostic.radialRange;
    widths.push(diagnostic.sweepWidth); extensions.push(range[1] - 1); tails.push(diagnostic.visualTail);
    assert.ok(diagnostic.sweepWidth > length * .85, 'the sweep covers most of the blade instead of centimeters at the tip');
    assert.ok(diagnostic.tipExtension >= length * .20 && diagnostic.tipExtension <= length * .41);
    const main = f.group.getObjectByName('physical-blade-path'), glow = f.group.getObjectByName('blade-outer-glow');
    const edge = f.group.getObjectByName('blade-bright-edge'), gold = f.group.getObjectByName('heavy-dao-gold-edge');
    assert.equal(main.geometry.userData.sections, 4); assert.equal(glow.geometry.userData.sections, 4);
    assert.equal(edge.geometry.userData.sections, 2);
    assert.ok(glow.geometry.userData.radialRange[1] > range[1]);
    assert.ok(Math.max(...main.geometry.attributes.effectAlpha.array) < .5);
    assert.ok(Math.max(...glow.geometry.attributes.effectAlpha.array) < .13);
    assert.notEqual(main.material.uniforms.tint.value.getHex(), 0xffffff);
    assert.equal(gold.visible, id === 'great-dao');
    assert.deepEqual(f.volume.clock, shownClock(), 'visual exaggeration leaves the source attack clock untouched');
    f.feedback.clear();
  }
  assert.ok(widths[0] > .65 && widths[1] > 1.2 && widths[2] > 1.6);
  assert.ok(widths[0] < widths[1] && widths[1] < widths[2]);
  assert.ok(extensions[0] < extensions[1] && extensions[1] < extensions[2]);
  assert.deepEqual(tails, [.18, .21, .24]);
});

test('extended blade light follows the blade axis during a translated and rotated sweep', () => {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  let heel = v(9, 2, -4), tip = v(10, 2, -4);
  const rig = { weaponId: 'tang-dao', weaponBlades: () => [{ hand: 1, heel, tip, edge: v(0, 0, 1) }] };
  const feedback = createWeaponFeedback(scene), descriptor = { weaponId: 'tang-dao', hand: 1, emitter: 'swing1' };
  const volume = { clock: shownClock() }, group = feedback.emit(root, descriptor, volume, rig);
  feedback.update(.02); heel = v(9.2, 2.1, -4.3); tip = v(9.2, 3.1, -4.3); feedback.update(.02);
  const path = group.getObjectByName('physical-blade-path'), points = path.geometry.attributes.position;
  for (let i = 4; i < 8; i++) {
    assert.ok(Math.abs(points.getX(i) - heel.x) < .000002);
    assert.ok(Math.abs(points.getZ(i) - heel.z) < .000002);
  }
  assert.ok(points.getY(7) > tip.y + .3);
  assert.equal(group.position.length(), 0, 'world samples are not moved twice with the actor root');
  volume.clock.finished = true; volume.clock.visible = false; volume.clock.colliding = false;
  feedback.update(.02);
  assert.equal(group.userData.collisionActive, false, 'the broad visible tail never becomes a damage window');
  const fade = path.material.uniforms.fade.value; feedback.update(0);
  assert.equal(path.material.uniforms.fade.value, fade, 'pause freezes its tail fade');
  feedback.update(.19); assert.ok(path.material.uniforms.fade.value < fade);
  feedback.update(.02); assert.equal(feedback.diagnostics().active, 0);
  feedback.clear();
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

test('visual replacement and bounded pools preserve rig materials and combat ownership', () => {
  const f = setup('great-dao'), volumes = [];
  let rigDisposals = 0;
  for (const mat of Object.values(f.rig.materials)) mat.addEventListener('dispose', () => rigDisposals++);
  for (let i = 0; i < 120; i++) {
    const descriptor = { weaponId: 'great-dao', hand: 1, type: 'swing', emitter: `unique-${i}` };
    const volume = { descriptor, clock: shownClock(), cancelled: false }; volumes.push(volume);
    f.feedback.emit(f.rig.group, descriptor, volume, f.rig); f.feedback.update(.008);
    assert.ok(f.feedback.diagnostics().active <= f.feedback.diagnostics().capacity);
    assert.ok(f.feedback.diagnostics().pooled <= f.feedback.diagnostics().capacity);
  }
  assert.ok(volumes.every(volume => !volume.cancelled));
  f.feedback.clear(); assert.equal(rigDisposals, 0); assert.equal(f.feedback.diagnostics().pooled, 0);
  assert.deepEqual(f.scene.children, [f.rig.group]);
});

test('broad blade layers reuse bounded slots across weapon styles and release their owned resources', () => {
  const f = setup('dual-dao'); f.feedback.update(.01); f.group.cancel();
  const originalGroup = f.group, geometries = new Set(), materials = new Set();
  let geometryDisposals = 0, materialDisposals = 0;
  for (const mesh of originalGroup.children) {
    if (!geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry); mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    }
    if (!materials.has(mesh.material)) {
      materials.add(mesh.material); mesh.material.addEventListener('dispose', () => materialDisposals++);
    }
  }
  const descriptor = { weaponId: 'great-dao', hand: 1, type: 'swing', emitter: 'swing1' };
  f.rig.setWeapon('great-dao');
  const group = f.feedback.emit(f.rig.group, descriptor, { clock: shownClock() }, f.rig); f.feedback.update(.02);
  assert.equal(group, originalGroup); assert.deepEqual(group.getObjectByName('physical-blade-path').geometry.userData.radialRange, [.12, 1.40]);
  assert.equal(group.getObjectByName('heavy-dao-gold-edge').visible, true);
  assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
  f.feedback.clear();
  assert.equal(geometryDisposals, geometries.size); assert.equal(materialDisposals, materials.size);
  assert.equal(f.feedback.diagnostics().active, 0); assert.equal(f.feedback.diagnostics().pooled, 0);
});
