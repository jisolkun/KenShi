import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponImpact, WEAPON_IMPACT_PROFILES, WEAPON_IMPACT_POOL_SIZE } from '../src/sourceMotion/weaponImpact.js';

const origin = new THREE.Vector3(1, .94, -2);
const direction = new THREE.Vector3(.4, -.7, .3).normalize();

test('four weapon contacts own four distinct geometries and visible effect families', () => {
  const feedback = createWeaponImpact(new THREE.Scene());
  const contacts = Object.keys(WEAPON_IMPACT_PROFILES).map(id => feedback.hit(origin, direction, id));
  assert.equal(new Set(contacts.map(group => group.userData.effectFamily)).size, 4);
  assert.equal(new Set(contacts.map(group => group.userData.styleId)).size, 4);
  assert.equal(new Set(contacts.map(group => group.children[0].geometry.uuid)).size, 4);
  const [dual, tang, great, hammer] = contacts;
  assert.equal(dual.children[0].geometry.userData.role, 'crossed-flicks');
  assert.equal(tang.children[0].geometry.userData.role, 'thin-incision');
  assert.equal(great.children[0].geometry.userData.role, 'wide-cleave');
  assert.ok(great.children.some(mesh => mesh.geometry.userData.role === 'stylized-dark-red-slivers'));
  assert.ok(hammer.children.some(mesh => mesh.geometry.userData.role === 'pressure-ring-volume'));
  assert.ok(hammer.children.some(mesh => mesh.geometry.userData.role === 'dust-volume'));
  assert.ok(!hammer.children.some(mesh => /cut|incision|cleave|flick|slash|ribbon/.test(mesh.geometry.userData.role)));
  // Every hammer piece is a genuine volume; its core cannot be a blade sheet.
  for (const mesh of hammer.children) {
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.x > 0 && size.y > 0 && size.z > 0, mesh.geometry.userData.role);
  }
  for (const group of contacts) {
    assert.ok(group.visible);
    assert.equal(group.userData.phase, 'contact');
  }
  feedback.destroy();
});

test('contact orientation includes the actual downward and upward strike vector', () => {
  const feedback = createWeaponImpact(new THREE.Scene());
  for (const id of Object.keys(WEAPON_IMPACT_PROFILES)) {
    for (const vector of [direction, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]) {
      const group = feedback.hit(origin, vector, id);
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
      assert.ok(axis.distanceTo(vector) < 1e-10, `${id}: contact direction`);
      assert.ok(group.position.distanceTo(origin) < 1e-10, 'contact remains at the measured enemy contact point');
    }
  }
  feedback.destroy();
});

test('timed contact, burst, and fade phases freeze on zero dt and finish in under .35 seconds', () => {
  const feedback = createWeaponImpact(new THREE.Scene());
  for (const id of Object.keys(WEAPON_IMPACT_PROFILES)) feedback.hit(origin, direction, id, 4, true);
  const before = feedback.snapshot();
  feedback.update(0);
  assert.deepEqual(feedback.snapshot(), before);
  feedback.update(.035);
  assert.ok(feedback.snapshot().slots.filter(slot => slot.active).every(slot => slot.phase === 'burst'));
  feedback.update(.08);
  assert.ok(feedback.snapshot().slots.some(slot => slot.active && slot.phase === 'fade'));
  assert.ok(feedback.snapshot().slots.filter(slot => slot.serial > 0).every(slot => slot.duration >= .1 && slot.duration < .35));
  feedback.update(.24);
  assert.equal(feedback.snapshot().activeCount, 0);
  assert.ok(feedback.snapshot().slots.filter(slot => slot.serial > 0).every(slot => slot.phase === 'inactive'));
  assert.throws(() => feedback.update(-.01), RangeError);
  assert.throws(() => feedback.update(Infinity), RangeError);
  feedback.destroy();
});

test('crowd contacts reuse bounded pools and clear recycles existing geometry and material', () => {
  const scene = new THREE.Scene(), feedback = createWeaponImpact(scene);
  const weaponIds = Object.keys(WEAPON_IMPACT_PROFILES);
  for (const id of weaponIds) feedback.hit(origin, direction, id);
  const allocated = feedback.snapshot();
  for (let i = 0; i < 320; i++) feedback.hit(origin, direction, weaponIds[i % weaponIds.length], i % 5);
  const crowded = feedback.snapshot();
  assert.equal(crowded.allocatedSlots, weaponIds.length * WEAPON_IMPACT_POOL_SIZE);
  assert.equal(crowded.activeCount, crowded.allocatedSlots);
  assert.equal(crowded.geometryCount, allocated.geometryCount);
  assert.equal(crowded.materialCount, allocated.materialCount);
  assert.equal(scene.children.length, 1);
  const holder = scene.children[0], geometry = holder.children[0].children[0].geometry;
  feedback.clear();
  assert.equal(scene.children.length, 0);
  assert.equal(feedback.snapshot().activeCount, 0);
  feedback.hit(origin, direction, 'dual-dao');
  assert.equal(scene.children[0], holder);
  assert.equal(holder.children[0].children[0].geometry, geometry);
  assert.equal(feedback.snapshot().geometryCount, allocated.geometryCount);
  feedback.destroy();
  assert.equal(scene.children.length, 0);
  assert.equal(feedback.snapshot().geometryCount, 0);
});

test('enemy palette colors are copied while borrowed resources stay untouched and undisposed', () => {
  const scene = new THREE.Scene(), feedback = createWeaponImpact(scene);
  const armor = new THREE.MeshStandardMaterial({ color: 0x173859 }), cloth = new THREE.MeshBasicMaterial({ color: 0x344331 });
  const originalArmor = armor.color.clone(), originalCloth = cloth.color.clone();
  let borrowedDisposals = 0, geometryDisposals = 0, materialDisposals = 0, instanceDisposals = 0;
  armor.addEventListener('dispose', () => borrowedDisposals++);
  cloth.addEventListener('dispose', () => borrowedDisposals++);
  const group = feedback.hit(origin, direction, 'great-hammer', 0, false, { materials: { armor, cloth } });
  const chips = group.children.find(child => child.geometry.userData.role === 'armor-chips');
  assert.ok(chips.material.color.equals(armor.color));
  assert.notEqual(chips.material, armor);
  const ownedGeometry = new Set(), ownedMaterial = new Set(), ownedInstances = new Set();
  scene.traverse(node => {
    if (!node.isMesh) return;
    ownedGeometry.add(node.geometry); ownedMaterial.add(node.material);
    if (node.isInstancedMesh) ownedInstances.add(node);
  });
  for (const geometry of ownedGeometry) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of ownedMaterial) material.addEventListener('dispose', () => materialDisposals++);
  for (const instance of ownedInstances) instance.addEventListener('dispose', () => instanceDisposals++);
  feedback.clear();
  assert.equal(geometryDisposals, 0, 'clear retains pooled resources for the next match');
  assert.equal(materialDisposals, 0);
  feedback.hit(origin, direction, 'great-hammer');
  feedback.destroy(); feedback.destroy();
  assert.equal(geometryDisposals, ownedGeometry.size, 'owned geometry is disposed exactly once');
  assert.equal(materialDisposals, ownedMaterial.size, 'owned materials are disposed exactly once');
  assert.equal(instanceDisposals, ownedInstances.size, 'GPU instance buffers are released exactly once');
  assert.equal(borrowedDisposals, 0);
  assert.ok(armor.color.equals(originalArmor)); assert.ok(cloth.color.equals(originalCloth));
  assert.throws(() => feedback.hit(origin, direction, 'great-hammer'), /destroyed/);
});

test('the fifth stroke gains scale and duration without changing other ordinary contacts', () => {
  const feedback = createWeaponImpact(new THREE.Scene());
  const normal = feedback.hit(origin, direction, 'great-hammer', 0).userData.snapshot();
  const fifth = feedback.hit(origin, direction, 'great-hammer', 4).userData.snapshot();
  assert.ok(fifth.duration > normal.duration);
  assert.equal(normal.family, fifth.family);
  assert.equal(normal.styleId, fifth.styleId);
  feedback.destroy();
});
