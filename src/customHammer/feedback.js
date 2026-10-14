import * as THREE from 'three';

export const HAMMER_FEEDBACK_BUDGET = Object.freeze({ heads: 12, dust: 32, chips: 32, contacts: 4 });

const clamp = THREE.MathUtils.clamp;
const hash = value => {
  const n = Math.sin(value * 13.731 + 31.317) * 43758.5453;
  return n - Math.floor(n);
};
const finiteVector = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const finiteQuaternion = value => finiteVector(value) && Number.isFinite(value.w);
const vector = (out, value) => Array.isArray(value) ? out.fromArray(value) : out.copy(value);
const rotation = (out, value) => Array.isArray(value) ? out.fromArray(value).normalize() : out.copy(value).normalize();

// Normal blending and face shading keep the wake a succession of solid masses.
// Per-instance alpha belongs to this renderer rather than to a weapon material.
function instanceMaterial(color, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    blending: THREE.NormalBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `
      attribute float instanceFade;
      varying float fade;
      varying vec3 faceColor;
      uniform vec3 tint;
      void main() {
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vec3 face = normalize(mat3(instanceMatrix) * normal);
        float light = .66 + .34 * abs(dot(face, normalize(vec3(.4, .8, .5))));
        faceColor = tint * light;
        #ifdef USE_INSTANCING_COLOR
          faceColor *= instanceColor;
        #endif
        fade = instanceFade;
        gl_Position = projectionMatrix * modelViewMatrix * world;
      }`,
    fragmentShader: `
      varying float fade;
      varying vec3 faceColor;
      uniform float opacity;
      void main() {
        if (fade < .002) discard;
        gl_FragColor = vec4(faceColor, fade * opacity);
      }`,
  });
}

/** A measured solid-head wake and bounded floor-contact feedback, no damage. */
export function createHammerFeedback(scene) {
  if (!scene?.isObject3D) throw new TypeError('Hammer feedback requires a Three scene or group');
  const group = new THREE.Group();
  group.name = 'Custom hammer: measured solid head and floor contact';
  group.userData = { effectType: 'custom-hammer-feedback', geometrySource: 'real-solid-head-world-frame' };
  const geometries = new Set(), materials = new Set(), instances = [];
  const ownGeometry = geometry => { geometries.add(geometry); return geometry; };
  const ownMaterial = material => { materials.add(material); return material; };
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), size = new THREE.Vector3();
  const euler = new THREE.Euler(), contact = new THREE.Vector3(), heading = new THREE.Vector3();
  const current = new THREE.Vector3(), prior = new THREE.Vector3(), extents = new THREE.Vector3(), priorExtents = new THREE.Vector3();
  const currentQ = new THREE.Quaternion(), priorQ = new THREE.Quaternion();
  const colors = [new THREE.Color(0x9eaaa7), new THREE.Color(0xb4b5a7), new THREE.Color(0xd0bd92)];
  const earth = new THREE.Color(0x918877), stone = new THREE.Color(0x686f6c);
  let destroyed = false, generation = 0, strike = null, distanceSinceSample = 0, timeSinceSample = 0;
  let headCursor = 0, dustCursor = 0, chipCursor = 0, contactCursor = 0;
  let lastSpeed = 0, sampledHeads = 0, floorContacts = 0;
  const seenContacts = new Set();
  const heads = Array.from({ length: HAMMER_FEEDBACK_BUDGET.heads }, () => ({
    active: false, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), size: new THREE.Vector3(),
    age: 0, life: .12, alpha: .16, awaitingPresentation: false, unseenAge: 0, generation: 0, combo: 0, strikeId: null,
  }));
  const makeParticles = count => Array.from({ length: count }, () => ({
    active: false, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    size: 0, age: 0, life: .4, spin: 0, alpha: 1, awaitingPresentation: false, unseenAge: 0, generation: 0,
  }));
  const dust = makeParticles(HAMMER_FEEDBACK_BUDGET.dust), chips = makeParticles(HAMMER_FEEDBACK_BUDGET.chips);

  function makeInstances(name, geometry, color, records, opacity = 1) {
    geometry.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(new Float32Array(records.length), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.userData.effectGeometry = name;
    const mesh = new THREE.InstancedMesh(ownGeometry(geometry), ownMaterial(instanceMaterial(color, opacity)), records.length);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 4;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < records.length; i++) mesh.setColorAt(i, new THREE.Color(0xffffff));
    mesh.userData.records = records;
    mesh.userData.submitted = new Uint8Array(records.length);
    mesh.userData.generations = new Uint32Array(records.length);
    mesh.onAfterRender = () => presentedMesh(mesh);
    group.add(mesh); instances.push(mesh); return mesh;
  }
  const headMesh = makeInstances('physical-oriented-head-ghosts', new THREE.BoxGeometry(1, 1, 1), 0xffffff, heads);
  const dustMesh = makeInstances('compact-contact-dust', new THREE.IcosahedronGeometry(1, 0), 0xffffff, dust, .30);
  const chipMesh = makeInstances('floor-stone-chips', new THREE.TetrahedronGeometry(1, 0), 0xffffff, chips, .88);
  const ringGeometry = ownGeometry(new THREE.RingGeometry(.90, 1, 40));
  ringGeometry.rotateX(-Math.PI / 2); ringGeometry.userData.effectGeometry = 'compact-floor-pressure-ring';
  const contacts = Array.from({ length: HAMMER_FEEDBACK_BUDGET.contacts }, (_, index) => {
    const mesh = new THREE.Mesh(ringGeometry, ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xb6a178, transparent: true, opacity: 0, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide, toneMapped: false, blending: THREE.NormalBlending,
    })));
    mesh.name = `Measured floor pressure ${index}`; mesh.visible = false; mesh.renderOrder = 2;
    const record = { mesh, active: false, age: 0, life: .23, gain: 1, awaitingPresentation: false, unseenAge: 0, generation: 0 };
    mesh.onAfterRender = () => present(record);
    group.add(mesh); return record;
  });

  function attach() { if (group.parent !== scene) scene.add(group); }
  function present(record) {
    if (record.active && record.awaitingPresentation) { record.awaitingPresentation = false; record.age = 0; }
  }
  function presentedMesh(mesh) {
    const { records, submitted, generations } = mesh.userData;
    for (let i = 0; i < mesh.count; i++) {
      const record = records[submitted[i]];
      if (record.generation === generations[i]) present(record);
    }
  }
  function begin(record) {
    record.active = true; record.age = 0; record.unseenAge = 0;
    record.awaitingPresentation = true; record.generation = ++generation;
  }
  function tick(record, dt) {
    if (!record.active) return;
    if (record.awaitingPresentation) {
      record.unseenAge += dt;
      if (record.unseenAge >= .50) record.active = false;
    } else {
      record.age += dt;
      if (record.age >= record.life) record.active = false;
    }
  }
  function syncInstances(mesh, kind) {
    const { records, submitted, generations } = mesh.userData;
    const fades = mesh.geometry.attributes.instanceFade;
    let visible = 0;
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record.active) continue;
      const t = record.age, u = clamp(t / record.life, 0, 1);
      if (kind === 'head') {
        p.copy(record.position); q.copy(record.quaternion); size.copy(record.size);
        mesh.setColorAt(visible, colors[record.combo]);
      } else {
        const drift = kind === 'dust' ? (1 - Math.exp(-3.8 * t)) / 3.8 : t;
        p.copy(record.origin).addScaledVector(record.velocity, drift);
        if (kind === 'dust') p.y = record.origin.y + record.velocity.y * t * Math.exp(-3 * t);
        else p.y = Math.max(record.origin.y - .012, record.origin.y + record.velocity.y * t - 4.9 * t * t);
        euler.set(t * record.spin, t * record.spin * .6, t * record.spin * -.4);
        q.setFromEuler(euler).premultiply(record.quaternion);
        const amount = record.size * (kind === 'dust' ? 1 + u * .8 : 1 - u * .15);
        size.set(amount, amount * (kind === 'dust' ? .48 : .72), amount);
        mesh.setColorAt(visible, kind === 'dust' ? earth : stone);
      }
      matrix.compose(p, q, size); mesh.setMatrixAt(visible, matrix);
      fades.setX(visible, record.alpha * (1 - u) ** (kind === 'head' ? 1.65 : 1.25));
      submitted[visible] = i; generations[visible] = record.generation; visible++;
    }
    mesh.count = visible; mesh.visible = visible > 0;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; fades.needsUpdate = true;
  }
  function sync() {
    syncInstances(headMesh, 'head'); syncInstances(dustMesh, 'dust'); syncInstances(chipMesh, 'chip');
    for (const record of contacts) {
      record.mesh.visible = record.active;
      if (!record.active) continue;
      const u = clamp(record.age / record.life, 0, 1);
      record.mesh.scale.setScalar((.19 + .40 * (1 - (1 - u) ** 2)) * record.gain);
      record.mesh.material.opacity = .20 * (1 - u) ** 1.6;
    }
    group.visible = heads.some(record => record.active) || dust.some(record => record.active)
      || chips.some(record => record.active) || contacts.some(record => record.active);
  }

  function trace({ frame, previous, dt, active, combo = 0, strikeId = null } = {}) {
    if (destroyed || !active || !frame?.headCenter || !frame?.headQuaternion || !previous?.headCenter || !previous?.headQuaternion) return false;
    if (!Number.isFinite(dt) || dt <= 0) return false;
    vector(current, frame.headCenter); vector(prior, previous.headCenter);
    if (!finiteVector(current) || !finiteVector(prior)) return false;
    rotation(currentQ, frame.headQuaternion); rotation(priorQ, previous.headQuaternion);
    if (!finiteQuaternion(currentQ) || !finiteQuaternion(priorQ)) return false;
    vector(extents, frame.headHalfExtents ?? [.26, .18, .17]);
    vector(priorExtents, previous.headHalfExtents ?? frame.headHalfExtents ?? [.26, .18, .17]);
    if (!finiteVector(extents) || extents.x <= 0 || extents.y <= 0 || extents.z <= 0) return false;
    if (!finiteVector(priorExtents) || priorExtents.x <= 0 || priorExtents.y <= 0 || priorExtents.z <= 0) return false;
    const distance = current.distanceTo(prior), turning = currentQ.angleTo(priorQ);
    const path = distance + turning * extents.length();
    lastSpeed = path / dt;
    // A switched weapon or teleported actor must not paint a path between two
    // unrelated frames. Motion below this threshold is a held weight.
    if (distance > 1.2 || lastSpeed < 1.20) return false;
    if (strike !== strikeId) { strike = strikeId; distanceSinceSample = 0; timeSinceSample = 0; }
    distanceSinceSample += path; timeSinceSample += dt;
    if (distanceSinceSample < .055 || timeSinceSample < .012) return false;
    const count = Math.min(3, Math.max(1, Math.ceil(path / .10)));
    const index = ((Math.trunc(combo) % 3) + 3) % 3;
    for (let i = 1; i <= count; i++) {
      const record = heads[headCursor]; headCursor = (headCursor + 1) % heads.length;
      begin(record); record.combo = index; record.strikeId = strikeId;
      record.position.copy(prior).lerp(current, i / count);
      record.quaternion.copy(priorQ).slerp(currentQ, i / count);
      record.size.copy(priorExtents).lerp(extents, i / count).multiplyScalar(2);
      record.life = index === 2 ? .135 : .105;
      record.alpha = clamp(.095 + lastSpeed * .006, .11, index === 2 ? .23 : .19);
      sampledHeads++;
    }
    distanceSinceSample = 0; timeSinceSample = 0; attach(); sync(); return true;
  }

  function ground({ point, direction, combo = 2, strikeId = null } = {}) {
    if (destroyed || !point) return false;
    vector(contact, point); if (!finiteVector(contact)) return false;
    if (strikeId !== null && seenContacts.has(strikeId)) return false;
    if (strikeId !== null) {
      seenContacts.add(strikeId);
      if (seenContacts.size > 16) seenContacts.delete(seenContacts.values().next().value);
    }
    if (direction) vector(heading, direction); else heading.set(0, 0, 1);
    heading.y = 0;
    if (!finiteVector(heading) || heading.lengthSq() < 1e-8) heading.set(0, 0, 1);
    heading.normalize();
    const index = ((Math.trunc(combo) % 3) + 3) % 3, gain = index === 2 ? 1 : .80;
    const record = contacts[contactCursor]; contactCursor = (contactCursor + 1) % contacts.length;
    begin(record); record.gain = gain; record.life = index === 2 ? .25 : .21;
    record.mesh.position.copy(contact); record.mesh.position.y += .008;
    const seed = ++floorContacts * 37;
    for (let i = 0; i < 8; i++) {
      const angle = i * 2.399963 + hash(seed) * .5;
      const radialX = Math.cos(angle), radialZ = Math.sin(angle);
      for (const kind of ['dust', 'chip']) {
        const particle = kind === 'dust' ? dust[dustCursor] : chips[chipCursor];
        if (kind === 'dust') dustCursor = (dustCursor + 1) % dust.length;
        else chipCursor = (chipCursor + 1) % chips.length;
        begin(particle);
        particle.origin.copy(contact); particle.origin.y += kind === 'dust' ? .032 : .023;
        particle.origin.x += radialX * .045; particle.origin.z += radialZ * .045;
        const speed = (.45 + hash(seed + i * 3 + (kind === 'chip' ? 11 : 0)) * (kind === 'chip' ? 1.1 : .75)) * gain;
        particle.velocity.set(radialX * speed + heading.x * .30 * gain,
          (kind === 'chip' ? .7 + hash(seed + i + 9) * .75 : .30 + hash(seed + i + 2) * .30) * gain,
          radialZ * speed + heading.z * .30 * gain);
        particle.size = kind === 'dust' ? .054 + hash(seed + i + 4) * .044 : .019 + hash(seed + i + 5) * .028;
        particle.life = kind === 'dust' ? .28 + hash(seed + i + 6) * .15 : .30 + hash(seed + i + 7) * .15;
        particle.alpha = kind === 'dust' ? .72 : .95;
        particle.spin = kind === 'chip' ? (hash(seed + i + 12) - .5) * 19 : .5;
        euler.set(hash(seed + i + 13) * 6, hash(seed + i + 14) * 6, angle);
        particle.quaternion.setFromEuler(euler);
      }
    }
    attach(); sync(); return true;
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Hammer feedback dt must be finite and nonnegative');
    if (destroyed || dt === 0) return;
    for (const collection of [heads, dust, chips, contacts]) for (const record of collection) tick(record, dt);
    sync();
  }
  function presented() {
    if (destroyed) return;
    for (const mesh of instances) presentedMesh(mesh);
    for (const record of contacts) if (record.mesh.visible) present(record);
  }
  function clear() {
    for (const collection of [heads, dust, chips, contacts]) for (const record of collection) {
      record.active = false; record.awaitingPresentation = false; record.age = 0;
    }
    seenContacts.clear(); strike = null; distanceSinceSample = 0; timeSinceSample = 0;
    headCursor = 0; dustCursor = 0; chipCursor = 0; contactCursor = 0;
    sync(); group.removeFromParent();
  }
  function diagnostics() {
    return {
      destroyed, budget: HAMMER_FEEDBACK_BUDGET, lastSpeed, sampledHeads, floorContacts,
      activeHeads: headMesh.count, activeDust: dustMesh.count, activeChips: chipMesh.count,
      activeContacts: contacts.filter(record => record.active).length,
      geometryCount: geometries.size, materialCount: materials.size,
      heads: heads.filter(record => record.active).map(record => ({
        position: record.position.toArray(), quaternion: record.quaternion.toArray(), size: record.size.toArray(),
        age: record.age, life: record.life, combo: record.combo, strikeId: record.strikeId, awaitingPresentation: record.awaitingPresentation,
      })),
    };
  }
  function destroy() {
    if (destroyed) return;
    clear();
    for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear(); materials.clear(); group.clear(); destroyed = true;
  }
  return { trace, ground, update, presented, clear, destroy, diagnostics };
}
