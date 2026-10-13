import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { createEnemyFinishers, cutGeometry } from '../src/enemyFinishers.js';

function area(geometry, { matrix, omitCaps = false, omitMaterial } = {}) {
  const positions = geometry.attributes.position, index = geometry.index;
  const cut = geometry.attributes.finisherCutSurface;
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const edge = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i + 2 < (index?.count ?? positions.count); i += 3) {
    if (omitCaps && cut?.getX(i)) continue;
    if (omitMaterial !== undefined && geometry.groups.some(group => group.materialIndex === omitMaterial && i >= group.start && i < group.start + group.count)) continue;
    vertices.forEach((vertex, j) => {
      vertex.fromBufferAttribute(positions, index ? index.getX(i + j) : i + j);
      if (matrix) vertex.applyMatrix4(matrix);
    });
    sum += vertices[1].sub(vertices[0]).cross(edge.subVectors(vertices[2], vertices[0])).length() * .5;
  }
  return sum;
}

function volume(geometry) {
  const positions = geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let result = 0;
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
    result += a.dot(b.cross(c)) / 6;
  }
  return result;
}

function sourceArea(group) {
  group.updateWorldMatrix(true, true);
  let result = 0;
  group.traverseVisible(mesh => { if (mesh.isMesh) result += area(mesh.geometry, { matrix: mesh.matrixWorld }); });
  return result;
}

function assertFiniteMesh(mesh) {
  for (const name of ['position', 'normal', 'color']) {
    assert.ok(mesh.geometry.attributes[name]);
    assert.ok([...mesh.geometry.attributes[name].array].every(Number.isFinite));
  }
  assert.ok(mesh.position.toArray().every(Number.isFinite));
  assert.ok(mesh.quaternion.toArray().every(Number.isFinite));
  assert.equal(mesh.geometry.groups.length, 0, 'vertex colour geometry has one draw call');
  assert.equal(Array.isArray(mesh.material), false);
  assert.equal(mesh.material.vertexColors, true);
}

test('world triangle clipping makes two closed halves with exact shaded planar caps', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const original = [...geometry.attributes.position.array];
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(3, 4, 5), new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, .6, -.2)), new THREE.Vector3(1.2, .9, .8));
  const normal = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(3, 4, 5));
  const cut = cutGeometry(geometry, plane, { matrixWorld: matrix, capMaterialIndex: 7 });
  assert.ok(cut.positive && cut.negative);
  assert.equal(cut.capLoops, 1);
  assert.ok(cut.capTriangles >= 4);
  const totalOuterArea = area(cut.positive, { omitMaterial: 7 }) + area(cut.negative, { omitMaterial: 7 });
  assert.ok(Math.abs(totalOuterArea - area(geometry, { matrix })) < 1e-4);
  assert.ok(Math.abs(volume(cut.positive) - 4 * 1.2 * .9 * .8) < 1e-4);
  assert.ok(Math.abs(volume(cut.negative) - 4 * 1.2 * .9 * .8) < 1e-4);
  for (const [side, half] of [[1, cut.positive], [-1, cut.negative]]) {
    const p = half.attributes.position, n = half.attributes.normal;
    for (let i = 0; i < p.count; i++) assert.ok(plane.distanceToPoint(new THREE.Vector3().fromBufferAttribute(p, i)) * side >= -1e-5);
    for (const group of half.groups.filter(group => group.materialIndex === 7)) {
      for (let i = group.start; i < group.start + group.count; i++) {
        assert.ok(Math.abs(plane.distanceToPoint(new THREE.Vector3().fromBufferAttribute(p, i))) < 1e-5);
        assert.ok(new THREE.Vector3().fromBufferAttribute(n, i).dot(normal) * side < -.999);
      }
    }
  }
  assert.deepEqual([...geometry.attributes.position.array], original);
  cut.positive.dispose(); cut.negative.dispose(); geometry.dispose();
});

test('disconnected merged armour receives separate closed caps instead of a bridge across empty space', () => {
  const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(0, 0, -2);
  const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(0, 0, 2);
  const merged = mergeGeometries([a, b]);
  const cut = cutGeometry(merged, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
  assert.equal(cut.capLoops, 2);
  assert.ok(Math.abs(volume(cut.negative) - 1) < 1e-5);
  assert.ok(Math.abs(volume(cut.positive) - 1) < 1e-5);
  for (const half of [cut.positive, cut.negative]) {
    const cap = half.groups.find(group => group.materialIndex === 1);
    const positions = half.attributes.position;
    for (let i = cap.start; i < cap.start + cap.count; i++) assert.ok(Math.abs(positions.getZ(i)) >= 1.5, 'no cap vertex fills the gap between plates');
    half.dispose();
  }
  a.dispose(); b.dispose(); merged.dispose();
});

for (const [weaponId, count, kind] of [['tang-dao', 2, 'slice'], ['great-dao', 2, 'slice'], ['dual-dao', 4, 'cross-cut'], ['great-hammer', 24, 'shatter']]) {
  test(`${weaponId} replaces the actual posed enemy with ${count} complete coloured ${kind} sections`, () => {
    const scene = new THREE.Scene(), fx = createEnemyFinishers(scene), rig = createCharacter('grunt');
    rig.group.position.set(3, 0, -2); rig.group.rotation.y = .74;
    rig.chest.rotation.z = .22; rig.arms[0].shoulder.rotation.x = -.6; rig.legs[1].hip.rotation.x = .48;
    scene.add(rig.group);
    const outerArea = sourceArea(rig.group);
    const geometries = new Map(), materials = new Map(), sourceVertices = [];
    rig.group.traverse(mesh => {
      if (!mesh.isMesh) return;
      geometries.set(mesh.geometry, [...mesh.geometry.attributes.position.array]);
      materials.set(mesh.material, { color: mesh.material.color.getHex(), emissive: mesh.material.emissive.getHex(), opacity: mesh.material.opacity });
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) sourceVertices.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    });
    let sharedDisposals = 0;
    for (const resource of [...geometries.keys(), ...materials.keys()]) resource.addEventListener('dispose', () => sharedDisposals++);
    fx.prepareRig(rig);
    const direction = new THREE.Vector3(.8, -.2, .4).normalize();
    const normal = new THREE.Vector3(.2, .7, -.3).normalize();
    const session = fx.breakEnemy(rig, { weaponId, combo: 3, direction, contactPoint: new THREE.Vector3(3, 1, -2), cutNormal: normal, critical: true });
    assert.equal(rig.group.visible, false);
    assert.equal(session.kind, kind); assert.equal(session.sections, count);
    assert.ok(session.capTriangles > 0, 'actual clipped surfaces have flat caps');
    assert.ok(fx.diagnostics().lastFinisher.sourceMeshes >= 40);
    assert.equal(fx.diagnostics().activeFragmentDrawCalls, count);
    assert.equal(fx.diagnostics().ownedMaterials, 1);
    let survivingOuterArea = 0;
    const capColours = new Set(), armourColours = new Set(), outputVertices = new Set();
    for (const { mesh, velocity } of session.fragments) {
      assertFiniteMesh(mesh);
      survivingOuterArea += area(mesh.geometry, { omitCaps: true });
      assert.ok(velocity.length() > 1, 'every section begins separating immediately');
      const snapshotCenter = new THREE.Vector3(...mesh.userData.enemyFinisher.snapshotCenter);
      assert.ok(mesh.position.distanceTo(snapshotCenter) > .029, 'even the first rendered frame has separated fragments');
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).add(snapshotCenter);
        outputVertices.add(point.toArray().map(value => Math.round(value * 1e4)).join(','));
      }
      const colors = mesh.geometry.attributes.color, caps = mesh.geometry.attributes.finisherCutSurface;
      for (let i = 0; i < colors.count; i++) {
        const rgb = [colors.getX(i), colors.getY(i), colors.getZ(i)].join(',');
        (caps.getX(i) ? capColours : armourColours).add(rgb);
      }
    }
    assert.ok(Math.abs(survivingOuterArea - outerArea) < outerArea * .0001, 'all original armour and body surfaces survive the snapshot cut');
    for (const point of sourceVertices) {
      const coordinates = point.toArray().map(value => Math.round(value * 1e4));
      let preserved = false;
      for (let x = -1; x <= 1 && !preserved; x++) for (let y = -1; y <= 1 && !preserved; y++) for (let z = -1; z <= 1; z++) {
        if (outputVertices.has([coordinates[0] + x, coordinates[1] + y, coordinates[2] + z].join(','))) { preserved = true; break; }
      }
      assert.ok(preserved, 'every original world-space vertex survives in the detached current pose');
    }
    assert.ok(armourColours.size >= 7, 'palette from the real enemy is retained');
    assert.equal(capColours.size, 1);
    if (weaponId === 'great-hammer') {
      assert.equal(session.dustMesh.count, 30);
      assert.ok(session.fragments.every(fragment => fragment.velocity.y > 1));
      assert.equal(session.group.getObjectsByProperty('name', 'sliced-enemy-half').length, 0);
    } else {
      assert.ok(new THREE.Vector3(...session.cutPlanes[0]).distanceTo(normal) < 1e-6, 'the physical swing cut plane is respected');
      assert.ok(session.fragments.some(fragment => fragment.velocity.dot(normal) > .3));
      assert.ok(session.fragments.some(fragment => fragment.velocity.dot(normal) < -.3));
    }
    for (const [geometry, buffer] of geometries) assert.deepEqual([...geometry.attributes.position.array], buffer);
    for (const [material, values] of materials) assert.deepEqual({ color: material.color.getHex(), emissive: material.emissive.getHex(), opacity: material.opacity }, values);
    fx.clear(); fx.destroy();
    assert.equal(sharedDisposals, 0, 'release and destroy never dispose actor resources');
  });
}

test('pause freezes separation and fading, landing is finite, and corpses disappear after their lifespan', () => {
  const scene = new THREE.Scene(), fx = createEnemyFinishers(scene), rig = createCharacter('brute');
  scene.add(rig.group);
  const session = fx.breakEnemy(rig, { weaponId: 'great-hammer', direction: new THREE.Vector3(0, -.8, .6), contactPoint: new THREE.Vector3(0, 1, 0) });
  const initial = session.fragments.map(fragment => ({ p: fragment.mesh.position.toArray(), q: fragment.mesh.quaternion.toArray(), s: fragment.mesh.scale.toArray() }));
  const dust = [...session.dustMesh.instanceMatrix.array];
  for (let i = 0; i < 60; i++) fx.update(0);
  assert.equal(session.age, 0);
  assert.deepEqual(session.fragments.map(fragment => ({ p: fragment.mesh.position.toArray(), q: fragment.mesh.quaternion.toArray(), s: fragment.mesh.scale.toArray() })), initial);
  assert.deepEqual([...session.dustMesh.instanceMatrix.array], dust);
  fx.update(.05);
  assert.notDeepEqual(session.fragments[0].mesh.position.toArray(), initial[0].p);
  for (let i = 0; i < 30; i++) fx.update(.05);
  assert.ok(session.fragments.every(fragment => fragment.mesh.scale.x < 1));
  assert.ok(session.materials[0].opacity < 1);
  assert.equal(session.dustMesh.count, 0);
  for (const fragment of session.fragments) assertFiniteMesh(fragment.mesh);
  const frozen = session.fragments[0].mesh.position.toArray(), opacity = session.materials[0].opacity;
  fx.update(0); assert.deepEqual(session.fragments[0].mesh.position.toArray(), frozen); assert.equal(session.materials[0].opacity, opacity);
  fx.update(1);
  assert.equal(fx.diagnostics().active, 0);
  assert.equal(fx.diagnostics().ownedGeometries, 0);
  assert.equal(fx.diagnostics().ownedMaterials, 0);
  assert.equal(scene.children.length, 1, 'no detached corpse remains after expiry');
  fx.destroy();
});

test('fragments remain independent when the original rig material is released', () => {
  const scene = new THREE.Scene(), fx = createEnemyFinishers(scene), rig = createCharacter('archer');
  scene.add(rig.group);
  const session = fx.breakEnemy(rig, { weaponId: 'tang-dao', direction: new THREE.Vector3(1, 0, 0) });
  const material = session.fragments[0].mesh.material;
  let corpseDisposals = 0;
  material.addEventListener('dispose', () => corpseDisposals++);
  for (const source of Object.values(rig.materials)) source.dispose();
  scene.remove(rig.group);
  fx.update(.1);
  assert.equal(corpseDisposals, 0);
  assertFiniteMesh(session.fragments[0].mesh);
  fx.clear(); assert.equal(corpseDisposals, 1); fx.destroy();
});

test('36 simultaneous lethal strikes obey session, fragment, material, draw-call and history budgets', () => {
  const scene = new THREE.Scene(), fx = createEnemyFinishers(scene, { maxSessions: 3, maxFragments: 48 });
  for (let i = 0; i < 36; i++) {
    const rig = createCharacter(i % 3 === 0 ? 'brute' : 'grunt');
    rig.group.position.set(i % 6, 0, Math.floor(i / 6)); scene.add(rig.group);
    const session = fx.breakEnemy(rig, { weaponId: 'great-hammer', direction: new THREE.Vector3(1, .1, .2) });
    assert.equal(session.fragmentCount, 24);
    const counts = fx.diagnostics();
    assert.ok(counts.activeSessions <= 3);
    assert.ok(counts.activeFragments <= 48);
    assert.ok(counts.ownedGeometries <= 48);
    assert.ok(counts.ownedMaterials <= 3);
    assert.equal(counts.activeFragmentDrawCalls, counts.activeFragments);
    assert.ok(counts.history.length <= 8);
    assert.ok(counts.pooledFragmentMeshes <= 48);
    assert.ok(counts.cachedFractureTemplates <= 96);
  }
  assert.equal(fx.diagnostics().totalCreated, 36);
  assert.equal(fx.diagnostics().totalReleased, 34);
  fx.clear();
  assert.equal(fx.diagnostics().ownedGeometries, 0);
  assert.equal(fx.diagnostics().ownedMaterials, 0);
  assert.equal(fx.diagnostics().lastFinisher, null);
  assert.equal(fx.diagnostics().activeDustParticles, 0);
  const rig = createCharacter('grunt'); scene.add(rig.group);
  const pooledBefore = fx.diagnostics().pooledFragmentMeshes;
  fx.breakEnemy(rig, { weaponId: 'tang-dao' });
  assert.equal(fx.diagnostics().pooledFragmentMeshes, pooledBefore - 2);
  fx.destroy(); fx.destroy();
  assert.equal(fx.diagnostics().cachedFractureTemplates, 0);
  assert.equal(fx.breakEnemy(createCharacter('grunt'), { weaponId: 'great-hammer' }), null);
});

test('destroy releases every pooled dust instance buffer once and never restores a hidden original', () => {
  const scene = new THREE.Scene(), fx = createEnemyFinishers(scene), rig = createCharacter('grunt');
  scene.add(rig.group);
  const session = fx.breakEnemy(rig, { weaponId: 'great-hammer' });
  let instanceDisposals = 0, materialDisposals = 0;
  session.dustMesh.addEventListener('dispose', () => instanceDisposals++);
  session.dustMesh.material.addEventListener('dispose', () => materialDisposals++);
  fx.clear();
  assert.equal(instanceDisposals, 0, 'a reusable pooled dust mesh keeps its instance buffer');
  assert.equal(rig.group.visible, false);
  fx.destroy(); fx.destroy();
  assert.equal(instanceDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(rig.group.visible, false);
});

test('zero or nonfinite trajectory vectors cannot produce invalid corpse transforms', () => {
  const scene = new THREE.Scene(), fx = createEnemyFinishers(scene);
  for (const direction of [new THREE.Vector3(), { x: NaN, y: Infinity, z: 0 }]) {
    const rig = createCharacter('boss'); scene.add(rig.group);
    poseCharacter(rig, { state: 'attack', time: .2, phase: .2, immediate: true });
    const session = fx.breakEnemy(rig, { weaponId: 'dual-dao', direction, cutNormal: new THREE.Vector3() });
    assert.equal(session.sections, 4);
    for (const fragment of session.fragments) assertFiniteMesh(fragment.mesh);
    fx.clear();
  }
  fx.update(NaN); fx.update(Infinity); fx.update(-1); fx.destroy();
});
