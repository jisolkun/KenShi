import * as THREE from 'three';

const EPSILON = 1e-5;
const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_DIRECTION = new THREE.Vector3(0, 0, 1);
const LIFETIME = 2.05;
const FADE_START = 1.2;

function finiteVector(value, fallback) {
  if (value && [value.x, value.y, value.z].every(Number.isFinite)) return new THREE.Vector3(value.x, value.y, value.z);
  return fallback.clone();
}

function vertexLerp(a, b, t) {
  return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize() };
}

function clippedPolygon(vertices, distances, positive, epsilon) {
  const result = [];
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const insideA = positive ? distances[i] >= -epsilon : distances[i] <= epsilon;
    const insideB = positive ? distances[j] >= -epsilon : distances[j] <= epsilon;
    if (insideA) result.push(vertices[i]);
    if (insideA !== insideB) result.push(vertexLerp(vertices[i], vertices[j], distances[i] / (distances[i] - distances[j])));
  }
  return result;
}

function geometryBuilder() {
  const buckets = new Map();
  let triangles = 0;
  return {
    triangle(a, b, c, materialIndex = 0) {
      const abx = b.p.x - a.p.x, aby = b.p.y - a.p.y, abz = b.p.z - a.p.z;
      const acx = c.p.x - a.p.x, acy = c.p.y - a.p.y, acz = c.p.z - a.p.z;
      const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
      if (cx * cx + cy * cy + cz * cz < 1e-17) return;
      let bucket = buckets.get(materialIndex);
      if (!bucket) buckets.set(materialIndex, bucket = { positions: [], normals: [] });
      bucket.positions.push(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z, c.p.x, c.p.y, c.p.z);
      bucket.normals.push(a.n.x, a.n.y, a.n.z, b.n.x, b.n.y, b.n.z, c.n.x, c.n.y, c.n.z);
      triangles++;
    },
    polygon(vertices, materialIndex) {
      for (let i = 1; i + 1 < vertices.length; i++) this.triangle(vertices[0], vertices[i], vertices[i + 1], materialIndex);
    },
    finish() {
      if (!triangles) return null;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(triangles * 9), normals = new Float32Array(triangles * 9);
      let start = 0;
      for (const [materialIndex, bucket] of buckets) {
        positions.set(bucket.positions, start * 3);
        normals.set(bucket.normals, start * 3);
        geometry.addGroup(start, bucket.positions.length / 3, materialIndex);
        start += bucket.positions.length / 3;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

function forEachTriangle(geometry, callback, matrixWorld) {
  const positions = geometry.attributes.position;
  if (!positions) return;
  const normals = geometry.attributes.normal;
  const index = geometry.index;
  const count = index ? index.count : positions.count;
  const normalMatrix = matrixWorld ? new THREE.Matrix3().getNormalMatrix(matrixWorld) : null;
  const vertices = [0, 1, 2].map(() => ({ p: new THREE.Vector3(), n: new THREE.Vector3() }));
  const edge = new THREE.Vector3();
  let groupIndex = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const n = index ? index.getX(i + j) : i + j;
      const { p, n: normal } = vertices[j];
      p.fromBufferAttribute(positions, n);
      if (matrixWorld) p.applyMatrix4(matrixWorld);
      if (normals) normal.fromBufferAttribute(normals, n);
      if (normalMatrix) normal.applyMatrix3(normalMatrix).normalize();
    }
    if (!normals) {
      const normal = vertices[0].n.subVectors(vertices[1].p, vertices[0].p)
        .cross(edge.subVectors(vertices[2].p, vertices[0].p)).normalize();
      for (const vertex of vertices) vertex.n.copy(normal);
    }
    while (groupIndex + 1 < geometry.groups.length && i >= geometry.groups[groupIndex].start + geometry.groups[groupIndex].count) groupIndex++;
    const group = geometry.groups[groupIndex];
    callback(vertices, group && i >= group.start && i < group.start + group.count ? group.materialIndex : 0);
  }
}

// Each closed cross-section is capped separately. In particular, disconnected
// armour plates in a merged character mesh never acquire a giant bridge cap.
function capLoops(segments, plane, epsilon) {
  const nodes = new Map(), edges = new Map();
  const key = p => `${Math.round(p.x / epsilon)},${Math.round(p.y / epsilon)},${Math.round(p.z / epsilon)}`;
  for (const [a, b] of segments) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (edges.has(edgeKey)) continue;
    for (const [k, p] of [[ka, a], [kb, b]]) if (!nodes.has(k)) nodes.set(k, { p, neighbours: [] });
    const edge = { a: ka, b: kb, used: false };
    edges.set(edgeKey, edge);
    nodes.get(ka).neighbours.push(edge);
    nodes.get(kb).neighbours.push(edge);
  }
  const loops = [];
  const reference = Math.abs(plane.normal.y) < .88 ? UP : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(reference, plane.normal).normalize();
  const v = new THREE.Vector3().crossVectors(plane.normal, u).normalize();
  for (const edge of edges.values()) {
    if (edge.used) continue;
    const first = edge.a;
    let current = edge.b, previous = first;
    edge.used = true;
    const points = [nodes.get(first).p];
    for (let safety = 0; safety <= edges.size; safety++) {
      if (current === first) break;
      const node = nodes.get(current);
      points.push(node.p);
      const candidates = node.neighbours.filter(candidate => !candidate.used);
      if (!candidates.length) break;
      // At the rare shared corner choose the straightest continuation rather
      // than linking adjacent pieces of armour across their air gap.
      const incoming = node.p.clone().sub(nodes.get(previous).p).normalize();
      candidates.sort((a, b) => {
        const endpointA = nodes.get(a.a === current ? a.b : a.a).p;
        const endpointB = nodes.get(b.a === current ? b.b : b.a).p;
        return endpointB.clone().sub(node.p).normalize().dot(incoming) - endpointA.clone().sub(node.p).normalize().dot(incoming);
      });
      const next = candidates[0];
      next.used = true;
      previous = current;
      current = next.a === current ? next.b : next.a;
    }
    if (current === first && points.length >= 3) {
      const projected = points.map(p => new THREE.Vector2(p.dot(u), p.dot(v)));
      const faces = THREE.ShapeUtils.triangulateShape(projected, []);
      if (faces.length) loops.push({ points, faces });
    }
  }
  return loops;
}

/**
 * Clip actual triangles, in world space when matrixWorld is supplied. The two
 * returned buffers own their vertices; input geometry is never edited/disposed.
 * Flat caps use capMaterialIndex so callers can shade the exposed armour cut.
 */
export function cutGeometry(geometry, plane, { matrixWorld, capMaterialIndex = 1, epsilon = EPSILON } = {}) {
  const cutPlane = plane.clone().normalize();
  const positive = geometryBuilder(), negative = geometryBuilder(), segments = [];
  forEachTriangle(geometry, (vertices, materialIndex) => {
    const distances = vertices.map(vertex => cutPlane.distanceToPoint(vertex.p));
    const hasPositive = distances.some(distance => distance > epsilon);
    const hasNegative = distances.some(distance => distance < -epsilon);
    if (!hasNegative) positive.triangle(...vertices, materialIndex);
    else if (!hasPositive) negative.triangle(...vertices, materialIndex);
    else {
      positive.polygon(clippedPolygon(vertices, distances, true, epsilon), materialIndex);
      negative.polygon(clippedPolygon(vertices, distances, false, epsilon), materialIndex);
      const intersections = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (Math.abs(distances[i]) <= epsilon) intersections.push(vertices[i].p.clone());
        if ((distances[i] > epsilon && distances[j] < -epsilon) || (distances[i] < -epsilon && distances[j] > epsilon)) {
          intersections.push(vertices[i].p.clone().lerp(vertices[j].p, distances[i] / (distances[i] - distances[j])));
        }
      }
      const unique = intersections.filter((p, i) => intersections.findIndex(q => q.distanceToSquared(p) < epsilon * epsilon) === i);
      if (unique.length >= 2) segments.push([unique[0], unique[1]]);
    }
  }, matrixWorld);
  let capTriangles = 0;
  const loops = capLoops(segments, cutPlane, epsilon * 4);
  for (const { points, faces } of loops) {
    for (const face of faces) {
      let [a, b, c] = face.map(index => points[index]);
      const winding = b.clone().sub(a).cross(c.clone().sub(a)).dot(cutPlane.normal);
      if (winding < 0) [b, c] = [c, b];
      const normal = cutPlane.normal;
      negative.triangle({ p: a, n: normal }, { p: b, n: normal }, { p: c, n: normal }, capMaterialIndex);
      positive.triangle({ p: a, n: normal.clone().negate() }, { p: c, n: normal.clone().negate() }, { p: b, n: normal.clone().negate() }, capMaterialIndex);
      capTriangles += 2;
    }
  }
  return { positive: positive.finish(), negative: negative.finish(), capTriangles, capLoops: loops.length, cutPlane };
}

function snapshotCharacter(group) {
  const builder = geometryBuilder(), materials = [], materialIndices = new Map();
  let sourceMeshes = 0;
  group.updateWorldMatrix(true, true);
  group.traverseVisible(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.geometry?.attributes.position) return;
    sourceMeshes++;
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const indices = sourceMaterials.map(material => {
      if (!materialIndices.has(material)) {
        materialIndices.set(material, materials.length);
        // Hit flashes belong to the living rig. A detached fragment has the
        // original armour colour and its own fade material.
        const clone = material.clone();
        if (clone.emissive) clone.emissive.setHex(0x000000);
        clone.transparent = true;
        clone.opacity = 1;
        clone.depthWrite = true;
        clone.side = THREE.DoubleSide;
        materials.push(clone);
      }
      return materialIndices.get(material);
    });
    forEachTriangle(mesh.geometry, (vertices, index) => builder.triangle(...vertices, indices[index] ?? indices[0]), mesh.matrixWorld);
  });
  return { geometry: builder.finish(), materials, sourceMeshes };
}

// Per-vertex palette colours keep each detached shard to one draw call, even
// when a shard contains skin, cloth, three metals, and a shaded flat cut face.
function bakePalette(geometry, materials, capMaterialIndex) {
  const count = geometry.attributes.position.count;
  const colours = new Float32Array(count * 3);
  const cutSurface = new Uint8Array(count);
  for (const group of geometry.groups) {
    const colour = materials[group.materialIndex]?.color ?? new THREE.Color(0x687a71);
    for (let i = group.start; i < group.start + group.count; i++) {
      colours[i * 3] = colour.r; colours[i * 3 + 1] = colour.g; colours[i * 3 + 2] = colour.b;
      cutSurface[i] = group.materialIndex === capMaterialIndex ? 1 : 0;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('finisherCutSurface', new THREE.BufferAttribute(cutSurface, 1));
  geometry.clearGroups();
}

function splitPiece(piece, plane, capMaterialIndex) {
  const result = cutGeometry(piece.geometry, plane, { capMaterialIndex });
  if (!result.positive || !result.negative) {
    result.positive?.dispose();
    result.negative?.dispose();
    return null;
  }
  piece.geometry.dispose();
  return {
    pieces: [
      { geometry: result.negative, signs: [...piece.signs, -1], normals: [...piece.normals, plane.normal.clone()] },
      { geometry: result.positive, signs: [...piece.signs, 1], normals: [...piece.normals, plane.normal.clone()] },
    ],
    capTriangles: result.capTriangles,
  };
}

function hash(index, seed = 0) {
  const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function sliceBlade(initial, options, center, capMaterialIndex) {
  const direction = options.direction;
  const fallback = new THREE.Vector3(direction.z, options.weaponId === 'great-dao' ? .7 : .4, -direction.x).normalize();
  const normal = finiteVector(options.cutNormal, fallback).normalize();
  if (normal.lengthSq() < .5) normal.copy(fallback);
  const contact = options.contactPoint;
  const size = initial.geometry.boundingBox.getSize(new THREE.Vector3());
  // A grazing lethal tip still cuts through the opponent, rather than cutting
  // only one decorative shoulder plate off the snapshot.
  const offset = THREE.MathUtils.clamp(contact.clone().sub(center).dot(normal), -size.length() * .16, size.length() * .16);
  const point = center.clone().addScaledVector(normal, offset);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  const split = splitPiece(initial, plane, capMaterialIndex);
  let pieces = split ? split.pieces : [initial];
  let capTriangles = split?.capTriangles ?? 0;
  const cutPlanes = [normal.toArray()];
  if (options.weaponId === 'dual-dao' && split) {
    let secondNormal = new THREE.Vector3().crossVectors(normal, direction).normalize();
    if (secondNormal.lengthSq() < .5) secondNormal = new THREE.Vector3().crossVectors(normal, UP).normalize();
    if (secondNormal.lengthSq() < .5) secondNormal.set(1, 0, 0);
    // This second plane crosses the first at the centre of the victim, matching
    // the paired blades' crossing finish instead of a single generic slash.
    const secondPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(secondNormal, center);
    const crossed = [];
    for (const piece of pieces) {
      const second = splitPiece(piece, secondPlane, capMaterialIndex);
      if (second) { crossed.push(...second.pieces); capTriangles += second.capTriangles; }
      else crossed.push(piece);
    }
    pieces = crossed;
    cutPlanes.push(secondNormal.toArray());
  }
  return { pieces, capTriangles, cutPlanes };
}

/** Detached armour corpses. Gameplay damage/kill/drop accounting stays outside. */
export function createEnemyFinishers(scene, { maxSessions = 12, maxFragments = 320 } = {}) {
  maxSessions = Math.max(1, Math.floor(maxSessions));
  maxFragments = Math.max(24, Math.floor(maxFragments));
  const sessions = [], sessionPool = [], meshPool = [], history = [];
  const emptyGeometry = new THREE.BufferGeometry();
  const poolMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const dustGeometry = new THREE.IcosahedronGeometry(1, 0);
  const ownedGeometries = new Set(), ownedMaterials = new Set();
  const dummy = new THREE.Object3D();
  const tempMatrix = new THREE.Matrix4();
  let serial = 0, totalCreated = 0, totalReleased = 0, destroyed = false;

  function acquireSession() {
    const session = sessionPool.pop() ?? {
      group: new THREE.Group(), fragments: [], dust: [],
      dustMesh: new THREE.InstancedMesh(dustGeometry, new THREE.MeshBasicMaterial({ color: 0x807b67, transparent: true, opacity: .45, depthWrite: false }), 32),
    };
    session.group.name = 'enemy-weapon-finisher';
    session.group.userData.enemyFinisher = true;
    session.group.matrixAutoUpdate = false;
    scene.updateMatrixWorld(true);
    session.group.matrix.copy(scene.matrixWorld).invert();
    session.group.matrixWorldNeedsUpdate = true;
    session.dustMesh.frustumCulled = false;
    session.dustMesh.name = 'enemy-armour-impact-dust';
    session.dustMesh.count = 0;
    session.group.add(session.dustMesh);
    scene.add(session.group);
    return session;
  }

  function release(session) {
    scene.remove(session.group);
    for (const fragment of session.fragments) {
      session.group.remove(fragment.mesh);
      fragment.mesh.geometry.dispose();
      ownedGeometries.delete(fragment.mesh.geometry);
      fragment.mesh.geometry = emptyGeometry;
      fragment.mesh.material = poolMaterial;
      if (meshPool.length < maxFragments) meshPool.push(fragment.mesh);
    }
    for (const material of session.materials) { material.dispose(); ownedMaterials.delete(material); }
    session.fragments.length = 0;
    session.dust.length = 0;
    session.dustMesh.count = 0;
    session.group.remove(session.dustMesh);
    session.age = 0;
    session.complete = true;
    totalReleased++;
    if (sessionPool.length < maxSessions) sessionPool.push(session);
    else { session.dustMesh.dispose(); session.dustMesh.material.dispose(); }
  }

  function dustMatrix(particle, scale = 1) {
    dummy.position.copy(particle.position);
    dummy.rotation.set(particle.rotation, particle.rotation * .7, particle.rotation * .3);
    dummy.scale.setScalar(particle.size * scale);
    dummy.updateMatrix();
    return dummy.matrix;
  }

  function breakEnemy(rig, { weaponId, combo = 0, direction, contactPoint, cutNormal, critical = false } = {}) {
    if (destroyed) return null;
    const original = rig?.group ?? rig;
    if (!original?.isObject3D || !original.visible) return null;
    const snapshot = snapshotCharacter(original);
    if (!snapshot.geometry) { for (const material of snapshot.materials) material.dispose(); return null; }
    const center = snapshot.geometry.boundingBox.getCenter(new THREE.Vector3());
    const strikeDirection = finiteVector(direction, FALLBACK_DIRECTION).normalize();
    if (strikeDirection.lengthSq() < .5) strikeDirection.copy(FALLBACK_DIRECTION);
    const contact = finiteVector(contactPoint, center);
    const capMaterialIndex = snapshot.materials.length;
    snapshot.materials.push(new THREE.MeshStandardMaterial({
      color: 0x253631, roughness: .94, metalness: .12,
      flatShading: true, side: THREE.DoubleSide, transparent: true,
    }));
    const initial = { geometry: snapshot.geometry, signs: [], normals: [] };
    const result = sliceBlade(initial, { weaponId, direction: strikeDirection, contactPoint: contact, cutNormal }, center, capMaterialIndex);
    while (sessions.length >= maxSessions || (sessions.reduce((count, session) => count + session.fragments.length, 0) + result.pieces.length > maxFragments)) release(sessions.shift());
    const session = acquireSession();
    session.id = ++serial;
    session.weaponId = weaponId;
    session.kind = weaponId === 'dual-dao' ? 'cross-cut' : 'slice';
    session.age = 0;
    session.complete = false;
    session.materials = snapshot.materials;
    session.sections = result.pieces.length;
    session.fragmentCount = result.pieces.length;
    session.contactPoint = contact.toArray();
    session.direction = strikeDirection.toArray();
    session.cutPlanes = result.cutPlanes ?? [];
    session.capTriangles = result.capTriangles;
    session.group.userData.weaponId = weaponId;
    session.group.userData.finisherKind = session.kind;
    session.group.userData.sessionId = session.id;
    const presentationMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: .76, metalness: .15,
      flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 1,
    });
    const initialCenters = [];
    result.pieces.forEach((piece, index) => {
      const pieceCenter = piece.geometry.boundingBox.getCenter(new THREE.Vector3());
      const extent = piece.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
      bakePalette(piece.geometry, snapshot.materials, capMaterialIndex);
      piece.geometry.translate(-pieceCenter.x, -pieceCenter.y, -pieceCenter.z);
      ownedGeometries.add(piece.geometry);
      const mesh = meshPool.pop() ?? new THREE.Mesh(emptyGeometry, poolMaterial);
      mesh.geometry = piece.geometry;
      mesh.material = presentationMaterial;
      mesh.name = 'sliced-enemy-half';
      mesh.position.copy(pieceCenter);
      mesh.quaternion.identity();
      mesh.scale.setScalar(1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = true;
      mesh.userData.enemyFinisher = {
        sessionId: session.id, weaponId, section: index,
        originalMeshCount: snapshot.sourceMeshes, capMaterialIndex,
        snapshotCenter: pieceCenter.toArray(),
      };
      const velocity = new THREE.Vector3(), separation = new THREE.Vector3();
      piece.normals.forEach((normal, i) => separation.addScaledVector(normal, piece.signs[i]));
      separation.normalize();
      velocity.copy(separation).multiplyScalar(weaponId === 'great-dao' ? 2.05 : 1.6).addScaledVector(strikeDirection, weaponId === 'great-dao' ? 2.4 : 1.45);
      velocity.y += .85 + hash(index + 3, serial) * .4;
      separation.multiplyScalar(weaponId === 'great-dao' ? .055 : .045);
      mesh.position.add(separation);
      initialCenters.push(mesh.position.toArray());
      const spin = new THREE.Vector3(hash(index + 11, serial) - .5, hash(index + 19, serial) - .5, hash(index + 23, serial) - .5).multiplyScalar(4.4);
      session.fragments.push({ mesh, velocity, spin, extent, rest: false, bounces: 0 });
      session.group.add(mesh);
    });
    for (const material of snapshot.materials) material.dispose();
    session.materials = [presentationMaterial];
    ownedMaterials.add(presentationMaterial);
    const dustCount = 8;
    session.dustMesh.material.color.setHex(0x9ca295);
    session.dustMesh.material.opacity = .32;
    for (let i = 0; i < dustCount; i++) {
      const radial = new THREE.Vector3(hash(i + 30, serial) - .5, hash(i + 37, serial) * .7, hash(i + 41, serial) - .5).normalize();
      const position = contact.clone().addScaledVector(radial, .08);
      const velocity = radial.clone().multiplyScalar(.8).addScaledVector(strikeDirection, .5);
      velocity.y += .6;
      const particle = { position, velocity, size: .035 * (.6 + hash(i + 47, serial)), rotation: hash(i + 51, serial) * 6 };
      session.dust.push(particle);
      session.dustMesh.setMatrixAt(i, dustMatrix(particle));
    }
    session.dustMesh.count = dustCount;
    session.dustMesh.instanceMatrix.needsUpdate = true;
    original.visible = false;
    sessions.push(session);
    totalCreated++;
    const record = {
      id: session.id, weaponId, combo, critical, kind: session.kind, sections: session.sections,
      fragmentCount: session.fragmentCount, sourceMeshes: snapshot.sourceMeshes,
      capTriangles: session.capTriangles, cutPlanes: session.cutPlanes,
      direction: session.direction, contactPoint: session.contactPoint,
      initialCenters, originalHidden: !original.visible, age: 0,
    };
    history.push(record);
    if (history.length > 8) history.shift();
    session.record = record;
    return session;
  }

  function update(dt) {
    if (destroyed || !(dt > 0) || !Number.isFinite(dt)) return;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const session = sessions[i];
      session.age += dt;
      session.record.age = session.age;
      if (session.age >= LIFETIME) { sessions.splice(i, 1); release(session); continue; }
      const step = Math.min(dt, .05);
      const scale = session.age <= FADE_START ? 1 : 1 - (session.age - FADE_START) / (LIFETIME - FADE_START);
      // Shrinking as well as fading stops a settled pile of armour obscuring
      // movement while its last shadows leave the ground.
      for (const fragment of session.fragments) {
        const { mesh, velocity, spin, extent } = fragment;
        if (!fragment.rest) {
          velocity.y -= 10.8 * step;
          mesh.position.addScaledVector(velocity, step);
          mesh.rotateX(spin.x * step);
          mesh.rotateY(spin.y * step);
          mesh.rotateZ(spin.z * step);
          tempMatrix.makeRotationFromQuaternion(mesh.quaternion);
          const elements = tempMatrix.elements;
          const support = Math.abs(elements[1]) * extent.x + Math.abs(elements[5]) * extent.y + Math.abs(elements[9]) * extent.z;
          const floor = .018 + support * scale;
          if (mesh.position.y <= floor && velocity.y < 0) {
            mesh.position.y = floor;
            velocity.x *= .61; velocity.z *= .61;
            velocity.y *= -.22;
            spin.multiplyScalar(.42);
            fragment.bounces++;
            if (fragment.bounces >= 2 || velocity.y < .32) { fragment.rest = true; velocity.set(0, 0, 0); }
          }
        }
        mesh.scale.setScalar(scale);
      }
      for (const material of session.materials) {
        material.opacity = Math.min(1, scale * 1.25);
        material.depthWrite = scale > .45;
      }
      if (session.age < .65) {
        const dustScale = 1 + session.age * .6;
        session.dust.forEach((particle, j) => {
          particle.velocity.y -= 3.8 * step;
          particle.position.addScaledVector(particle.velocity, step);
          particle.position.y = Math.max(.035, particle.position.y);
          particle.rotation += step * 1.8;
          session.dustMesh.setMatrixAt(j, dustMatrix(particle, dustScale));
        });
        session.dustMesh.material.opacity = .32 * (1 - session.age / .65);
        session.dustMesh.instanceMatrix.needsUpdate = true;
      } else session.dustMesh.count = 0;
    }
  }

  function clear() {
    while (sessions.length) release(sessions.pop());
    history.length = 0;
  }

  function diagnostics() {
    return {
      active: sessions.length, activeSessions: sessions.length,
      activeFragments: sessions.reduce((count, session) => count + session.fragments.length, 0),
      activeDustParticles: sessions.reduce((count, session) => count + session.dustMesh.count, 0),
      pooledSessions: sessionPool.length, pooledFragmentMeshes: meshPool.length,
      ownedGeometries: ownedGeometries.size, ownedMaterials: ownedMaterials.size,
      activeFragmentDrawCalls: sessions.reduce((count, session) => count + session.fragments.length, 0),
      maxSessions, maxFragments, totalCreated, totalReleased,
      lastFinisher: history.at(-1) ?? null,
      history: history.map(record => ({ ...record })),
    };
  }

  function destroy() {
    if (destroyed) return;
    clear();
    for (const session of sessionPool) { session.dustMesh.dispose(); session.dustMesh.material.dispose(); }
    sessionPool.length = 0; meshPool.length = 0;
    emptyGeometry.dispose(); poolMaterial.dispose(); dustGeometry.dispose();
    destroyed = true;
  }

  return { breakEnemy, update, clear, diagnostics, destroy };
}
