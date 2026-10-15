import * as THREE from 'three';

// The source uses short, broad additive sweeps and a separate world-space burst.
// These shapes are new: every sweep is built from the actual hammer trajectory.
export const HAMMER_FEEDBACK_BUDGET = Object.freeze({ heads: 12, dust: 64, chips: 48, sparks: 72, contacts: 4, sweeps: 6 });

const clamp = THREE.MathUtils.clamp;
const hash = value => {
  const n = Math.sin(value * 13.731 + 31.317) * 43758.5453;
  return n - Math.floor(n);
};
const finiteVector = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const finiteQuaternion = value => finiteVector(value) && Number.isFinite(value.w);
const vector = (out, value) => Array.isArray(value) ? out.fromArray(value) : out.copy(value);
const rotation = (out, value) => Array.isArray(value) ? out.fromArray(value).normalize() : out.copy(value).normalize();
const MAX_SWEEP_POINTS = 64;
const FORWARD = new THREE.Vector3(0, 0, 1);
const SWEEP_PALETTES = [
  { wake: new THREE.Color(0x68a9ff), rim: new THREE.Color(0xe4f4ff), spark: new THREE.Color(0xa6dbff) },
  { wake: new THREE.Color(0x58d8e8), rim: new THREE.Color(0xe7fff1), spark: new THREE.Color(0x90f5ed) },
  { wake: new THREE.Color(0xeaa141), rim: new THREE.Color(0xfff4cc), spark: new THREE.Color(0xffcf70) },
];

function instanceMaterial(color, opacity = 1, additive = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `
      attribute float instanceFade;
      varying float fade;
      varying vec3 faceColor;
      uniform vec3 tint;
      void main() {
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vec3 face = normalize(mat3(instanceMatrix) * normal);
        float light = .72 + .28 * abs(dot(face, normalize(vec3(.4, .8, .5))));
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

function sweepGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SWEEP_POINTS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SWEEP_POINTS * 6 * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const indices = [];
  for (let i = 0; i < MAX_SWEEP_POINTS - 1; i++) for (const j of [0, 1, 2, 4]) {
    const a = i * 6 + j, b = (i + 1) * 6 + j;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setIndex(indices); geometry.setDrawRange(0, 0);
  geometry.userData.effectGeometry = 'measured-pressure-ribbon';
  return geometry;
}

function crackGeometry() {
  const positions = [];
  for (let ray = 0; ray < 11; ray++) {
    const angle = ray * Math.PI * 2 / 11 + hash(ray + 1) * .23;
    let last = new THREE.Vector3();
    for (let branch = 1; branch <= 4; branch++) {
      const r = branch / 4 * (.65 + hash(ray + 7) * .35), a = angle + Math.sin(ray * 4 + branch * 2) * .14;
      const next = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const d = next.clone().sub(last).normalize(), side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(.018 * (1.2 - r));
      const a0 = last.clone().sub(side), a1 = last.clone().add(side), b0 = next.clone().sub(side), b1 = next.clone().add(side);
      positions.push(...a0.toArray(), ...b0.toArray(), ...a1.toArray(), ...a1.toArray(), ...b0.toArray(), ...b1.toArray());
      last = next;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.userData.effectGeometry = 'authored-jagged-impact-cracks';
  return geometry;
}

/** Actual-head pressure sweeps, agile foot trails and physical floor bursts. */
export function createHammerFeedback(scene) {
  if (!scene?.isObject3D) throw new TypeError('Hammer feedback requires a Three scene or group');
  const group = new THREE.Group();
  group.name = 'Custom hammer: pressure sweeps and impact eruption';
  group.userData = { effectType: 'custom-hammer-feedback', geometrySource: 'real-solid-head-world-frame' };
  const geometries = new Set(), materials = new Set(), instances = [];
  const ownGeometry = geometry => { geometries.add(geometry); return geometry; };
  const ownMaterial = material => { materials.add(material); return material; };
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), size = new THREE.Vector3();
  const euler = new THREE.Euler(), contact = new THREE.Vector3(), heading = new THREE.Vector3(), axis = new THREE.Vector3();
  const current = new THREE.Vector3(), prior = new THREE.Vector3(), extents = new THREE.Vector3(), priorExtents = new THREE.Vector3();
  const currentQ = new THREE.Quaternion(), priorQ = new THREE.Quaternion();
  const earth = new THREE.Color(0xb7aaa0), stone = new THREE.Color(0x666f79), white = new THREE.Color(0xfff6dd);
  let destroyed = false, generation = 0, strike = null, distanceSinceSample = 0, timeSinceSample = 0, movementDelay = 0;
  let headCursor = 0, dustCursor = 0, chipCursor = 0, sparkCursor = 0, contactCursor = 0, sweepCursor = 0;
  let lastSpeed = 0, sampledHeads = 0, floorContacts = 0, movementBursts = 0;
  const seenContacts = new Set();
  const heads = Array.from({ length: HAMMER_FEEDBACK_BUDGET.heads }, () => ({
    active: false, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), size: new THREE.Vector3(),
    age: 0, life: .12, alpha: .16, awaitingPresentation: false, unseenAge: 0, generation: 0, combo: 0, strikeId: null,
  }));
  const makeParticles = count => Array.from({ length: count }, () => ({
    active: false, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    color: new THREE.Color(), size: 0, age: 0, life: .4, spin: 0, alpha: 1, stretch: 1,
    awaitingPresentation: false, unseenAge: 0, generation: 0,
  }));
  const dust = makeParticles(HAMMER_FEEDBACK_BUDGET.dust), chips = makeParticles(HAMMER_FEEDBACK_BUDGET.chips), sparks = makeParticles(HAMMER_FEEDBACK_BUDGET.sparks);

  function makeInstances(name, geometry, color, records, opacity = 1, additive = false) {
    geometry.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(new Float32Array(records.length), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.userData.effectGeometry = name;
    const mesh = new THREE.InstancedMesh(ownGeometry(geometry), ownMaterial(instanceMaterial(color, opacity, additive)), records.length);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = additive ? 6 : 4;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < records.length; i++) mesh.setColorAt(i, white);
    mesh.userData.records = records; mesh.userData.submitted = new Uint8Array(records.length); mesh.userData.generations = new Uint32Array(records.length);
    mesh.onAfterRender = () => presentedMesh(mesh);
    group.add(mesh); instances.push(mesh); return mesh;
  }
  const headMesh = makeInstances('physical-oriented-head-ghosts', new THREE.BoxGeometry(1, 1, 1), 0xffffff, heads, .46, true);
  const dustMesh = makeInstances('compact-contact-dust', new THREE.IcosahedronGeometry(1, 0), 0xffffff, dust, .31);
  const chipMesh = makeInstances('floor-stone-chips', new THREE.TetrahedronGeometry(1, 0), 0xffffff, chips, .95);
  const sparkMesh = makeInstances('swept-pressure-sparks', new THREE.OctahedronGeometry(1, 0), 0xffffff, sparks, .95, true);

  const ribbonMaterial = ownMaterial(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    vertexColors: true, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec4 ink; void main(){ink=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec4 ink; void main(){if(ink.a<.002)discard;gl_FragColor=ink;}',
  }));
  const sweeps = Array.from({ length: HAMMER_FEEDBACK_BUDGET.sweeps }, (_, index) => {
    const mesh = new THREE.Mesh(ownGeometry(sweepGeometry()), ribbonMaterial);
    mesh.name = `Measured pressure sweep ${index}`; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 5;
    const record = { mesh, active: false, age: 0, life: .18, combo: 0, samples: [], strikeId: null, awaitingPresentation: false, unseenAge: 0, generation: 0 };
    mesh.onAfterRender = () => present(record); group.add(mesh); return record;
  });

  const ringGeometry = ownGeometry(new THREE.RingGeometry(.88, 1, 64));
  ringGeometry.rotateX(-Math.PI / 2); ringGeometry.userData.effectGeometry = 'wide-floor-pressure-ring';
  const cracksGeometry = ownGeometry(crackGeometry());
  const floorMaterial = (color, additive = true) => ownMaterial(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const contacts = Array.from({ length: HAMMER_FEEDBACK_BUDGET.contacts }, (_, index) => {
    const mesh = new THREE.Mesh(ringGeometry, floorMaterial(0xa6deff));
    const echo = new THREE.Mesh(ringGeometry, floorMaterial(0xffd37d));
    const cracks = new THREE.Mesh(cracksGeometry, floorMaterial(0x282d33, false));
    mesh.name = `Measured floor pressure ${index}`; echo.name = `Floor pressure echo ${index}`; cracks.name = `Floor impact cracks ${index}`;
    for (const part of [mesh, echo, cracks]) { part.visible = false; part.renderOrder = part === cracks ? 2 : 5; group.add(part); }
    const record = { mesh, echo, cracks, active: false, age: 0, life: .60, gain: 1, awaitingPresentation: false, unseenAge: 0, generation: 0 };
    for (const part of [mesh, echo, cracks]) part.onAfterRender = () => present(record);
    return record;
  });

  function attach() { if (group.parent !== scene) scene.add(group); }
  function present(record) { if (record.active && record.awaitingPresentation) { record.awaitingPresentation = false; record.age = 0; } }
  function presentedMesh(mesh) {
    const { records, submitted, generations } = mesh.userData;
    for (let i = 0; i < mesh.count; i++) { const record = records[submitted[i]]; if (record.generation === generations[i]) present(record); }
  }
  function begin(record) {
    record.active = true; record.age = 0; record.unseenAge = 0; record.awaitingPresentation = true; record.generation = ++generation;
  }
  function tick(record, dt) {
    if (!record.active) return;
    if (record.awaitingPresentation) { record.unseenAge += dt; if (record.unseenAge >= .50) record.active = false; }
    else { record.age += dt; if (record.age >= record.life) record.active = false; }
  }
  function syncInstances(mesh, kind) {
    const { records, submitted, generations } = mesh.userData, fades = mesh.geometry.attributes.instanceFade;
    let visible = 0;
    for (let i = 0; i < records.length; i++) {
      const record = records[i]; if (!record.active) continue;
      const t = record.age, u = clamp(t / record.life, 0, 1);
      if (kind === 'head') {
        p.copy(record.position); q.copy(record.quaternion); size.copy(record.size);
        mesh.setColorAt(visible, SWEEP_PALETTES[record.combo].wake);
      } else {
        const drift = kind === 'dust' ? (1 - Math.exp(-4.6 * t)) / 4.6 : t;
        p.copy(record.origin).addScaledVector(record.velocity, drift);
        if (kind === 'dust') p.y = record.origin.y + record.velocity.y * t * Math.exp(-3.5 * t);
        else if (kind === 'chip') p.y = Math.max(record.origin.y - .012, record.origin.y + record.velocity.y * t - 4.9 * t * t);
        else p.y = record.origin.y + record.velocity.y * t - 1.6 * t * t;
        if (kind === 'spark') {
          q.copy(record.quaternion); const amount = record.size * (1 - u * .6);
          size.set(amount, amount, amount * record.stretch * (1 - u * .45));
          mesh.setColorAt(visible, record.color);
        } else {
          euler.set(t * record.spin, t * record.spin * .6, t * record.spin * -.4); q.setFromEuler(euler).premultiply(record.quaternion);
          const amount = record.size * (kind === 'dust' ? 1 + u * 1.1 : 1 - u * .15);
          size.set(amount, amount * (kind === 'dust' ? .42 : .72), amount); mesh.setColorAt(visible, kind === 'dust' ? earth : stone);
        }
      }
      matrix.compose(p, q, size); mesh.setMatrixAt(visible, matrix);
      fades.setX(visible, record.alpha * (1 - u) ** (kind === 'head' ? 1.7 : kind === 'spark' ? 1.35 : 1.25));
      submitted[visible] = i; generations[visible] = record.generation; visible++;
    }
    mesh.count = visible; mesh.visible = visible > 0; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; fades.needsUpdate = true;
  }
  function syncSweep(record) {
    record.mesh.visible = record.active && record.samples.length > 1;
    if (!record.mesh.visible) return;
    const geometry = record.mesh.geometry, positions = geometry.attributes.position, colors = geometry.attributes.color;
    const palette = SWEEP_PALETTES[record.combo], samples = record.samples, fade = (1 - clamp(record.age / record.life, 0, 1)) ** 1.25;
    const widths = [-.17, -.075, .47, .70, -.105, -.055], alphas = [0, .30, .17, 0, .91, .72];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i], tail = Math.min(1, (i + .3) / 3), tip = Math.min(1, (samples.length - i) / 2);
      axis.set(0, 1, 0).applyQuaternion(sample.quaternion);
      for (let row = 0; row < 6; row++) {
        const index = i * 6 + row;
        p.copy(sample.position).addScaledVector(axis, widths[row] * sample.width);
        positions.setXYZ(index, p.x, p.y, p.z);
        const color = row < 4 ? palette.wake : palette.rim;
        colors.setXYZW(index, color.r, color.g, color.b, alphas[row] * fade * tail * tip * sample.alpha);
      }
    }
    positions.needsUpdate = true; colors.needsUpdate = true; geometry.setDrawRange(0, (samples.length - 1) * 24);
  }
  function sync() {
    syncInstances(headMesh, 'head'); syncInstances(dustMesh, 'dust'); syncInstances(chipMesh, 'chip'); syncInstances(sparkMesh, 'spark');
    for (const record of sweeps) syncSweep(record);
    for (const record of contacts) {
      for (const part of [record.mesh, record.echo, record.cracks]) part.visible = record.active;
      if (!record.active) continue;
      const u = clamp(record.age / record.life, 0, 1), expand = 1 - (1 - u) ** 3;
      record.mesh.scale.setScalar((.28 + 1.64 * expand) * record.gain);
      record.echo.scale.setScalar((.19 + 2.15 * (1 - (1 - u) ** 2)) * record.gain);
      record.cracks.scale.setScalar((1.18 + .42 * Math.min(1, u * 5)) * record.gain);
      record.mesh.material.opacity = .72 * (1 - u) ** 2;
      record.echo.material.opacity = .50 * (1 - u) ** 2.8;
      record.cracks.material.opacity = .64 * (1 - u) ** .8;
    }
    group.visible = [heads, dust, chips, sparks, contacts, sweeps].some(collection => collection.some(record => record.active));
  }
  function spawnSpark(origin, velocity, palette, length, life, seed) {
    const particle = sparks[sparkCursor]; sparkCursor = (sparkCursor + 1) % sparks.length; begin(particle);
    particle.origin.copy(origin); particle.velocity.copy(velocity); particle.life = life; particle.size = .014 + hash(seed) * .011;
    particle.stretch = length / particle.size; particle.alpha = .82; particle.color.copy(palette);
    heading.copy(velocity); if (heading.lengthSq() < 1e-8) heading.set(0, 0, 1); heading.normalize();
    particle.quaternion.setFromUnitVectors(FORWARD, heading);
  }
  function appendSweep(framePosition, frameRotation, index, strikeId, amount = 1) {
    let record = sweeps.find(item => item.active && item.strikeId === strikeId && item.combo === index);
    if (!record) {
      record = sweeps[sweepCursor]; sweepCursor = (sweepCursor + 1) % sweeps.length;
      begin(record); record.samples.length = 0; record.combo = index; record.strikeId = strikeId; record.life = index === 2 ? .21 : .17;
    }
    record.age = 0;
    // World-space samples never rotate with the hero after they are emitted.
    record.samples.push({ position: framePosition.clone(), quaternion: frameRotation.clone(), width: index === 2 ? 1.18 : index === 1 ? .98 : 1.04, alpha: amount });
    if (record.samples.length > MAX_SWEEP_POINTS) record.samples.shift();
    return record;
  }

  function trace({ frame, previous, dt, active, combo = 0, strikeId = null } = {}) {
    if (destroyed || !active || !frame?.headCenter || !frame?.headQuaternion || !previous?.headCenter || !previous?.headQuaternion) return false;
    if (!Number.isFinite(dt) || dt <= 0) return false;
    vector(current, frame.headCenter); vector(prior, previous.headCenter); if (!finiteVector(current) || !finiteVector(prior)) return false;
    rotation(currentQ, frame.headQuaternion); rotation(priorQ, previous.headQuaternion); if (!finiteQuaternion(currentQ) || !finiteQuaternion(priorQ)) return false;
    vector(extents, frame.headHalfExtents ?? [.26, .18, .17]); vector(priorExtents, previous.headHalfExtents ?? frame.headHalfExtents ?? [.26, .18, .17]);
    if (!finiteVector(extents) || extents.x <= 0 || extents.y <= 0 || extents.z <= 0 || !finiteVector(priorExtents) || priorExtents.x <= 0 || priorExtents.y <= 0 || priorExtents.z <= 0) return false;
    const distance = current.distanceTo(prior), turning = currentQ.angleTo(priorQ), path = distance + turning * extents.length();
    lastSpeed = path / dt;
    if (distance > 1.2 || lastSpeed < 1.20) return false;
    if (strike !== strikeId) { strike = strikeId; distanceSinceSample = 0; timeSinceSample = 0; }
    distanceSinceSample += path; timeSinceSample += dt;
    if (distanceSinceSample < .035 || timeSinceSample < .006) return false;
    const count = Math.min(4, Math.max(1, Math.ceil(path / .10))), index = ((Math.trunc(combo) % 3) + 3) % 3;
    if (!sweeps.some(record => record.active && record.strikeId === strikeId && record.combo === index)) appendSweep(prior, priorQ, index, strikeId, .35);
    for (let i = 1; i <= count; i++) {
      p.copy(prior).lerp(current, i / count); q.copy(priorQ).slerp(currentQ, i / count);
      appendSweep(p, q, index, strikeId, clamp(.45 + lastSpeed * .055, .55, 1));
      const record = heads[headCursor]; headCursor = (headCursor + 1) % heads.length; begin(record);
      record.combo = index; record.strikeId = strikeId; record.position.copy(p); record.quaternion.copy(q);
      record.size.copy(priorExtents).lerp(extents, i / count).multiplyScalar(2);
      record.life = index === 2 ? .135 : .105; record.alpha = clamp(.09 + lastSpeed * .006, .11, .22); sampledHeads++;
    }
    if (lastSpeed > 3.6) {
      const seed = sampledHeads * 3;
      p.copy(current); axis.set(0, 1, 0).applyQuaternion(currentQ); p.addScaledVector(axis, .12 + hash(seed) * .28);
      heading.copy(current).sub(prior).multiplyScalar(.15 / dt); heading.y += .45;
      spawnSpark(p, heading, SWEEP_PALETTES[index].spark, .16 + Math.min(.20, lastSpeed * .012), .16 + hash(seed + 1) * .07, seed);
    }
    distanceSinceSample = 0; timeSinceSample = 0; attach(); sync(); return true;
  }

  function ground({ point, direction, combo = 2, strikeId = null } = {}) {
    if (destroyed || !point) return false;
    vector(contact, point); if (!finiteVector(contact)) return false;
    if (strikeId !== null && seenContacts.has(strikeId)) return false;
    if (strikeId !== null) { seenContacts.add(strikeId); if (seenContacts.size > 16) seenContacts.delete(seenContacts.values().next().value); }
    if (direction) vector(heading, direction); else heading.set(0, 0, 1); heading.y = 0;
    if (!finiteVector(heading) || heading.lengthSq() < 1e-8) heading.set(0, 0, 1); heading.normalize();
    const groundDirection = heading.clone(), index = ((Math.trunc(combo) % 3) + 3) % 3, gain = index === 2 ? 1 : .75;
    const record = contacts[contactCursor]; contactCursor = (contactCursor + 1) % contacts.length;
    begin(record); record.gain = gain; record.life = .60;
    for (const [part, height] of [[record.mesh, .008], [record.echo, .012], [record.cracks, .004]]) { part.position.copy(contact); part.position.y += height; }
    record.cracks.rotation.y = hash(floorContacts + 3) * Math.PI;
    const seed = ++floorContacts * 37;
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963 + hash(seed) * .5, radialX = Math.cos(angle), radialZ = Math.sin(angle);
      for (const kind of ['dust', 'chip']) {
        const particle = kind === 'dust' ? dust[dustCursor] : chips[chipCursor];
        if (kind === 'dust') dustCursor = (dustCursor + 1) % dust.length; else chipCursor = (chipCursor + 1) % chips.length;
        begin(particle); particle.origin.copy(contact); particle.origin.y += kind === 'dust' ? .032 : .023;
        particle.origin.x += radialX * .045; particle.origin.z += radialZ * .045;
        const speed = (1.4 + hash(seed + i * 3 + (kind === 'chip' ? 11 : 0)) * (kind === 'chip' ? 2.8 : 2.1)) * gain;
        particle.velocity.set(radialX * speed + groundDirection.x * .40 * gain,
          (kind === 'chip' ? 1.1 + hash(seed + i + 9) * 1.9 : .75 + hash(seed + i + 2) * .9) * gain,
          radialZ * speed + groundDirection.z * .40 * gain);
        particle.size = kind === 'dust' ? .13 + hash(seed + i + 4) * .12 : .036 + hash(seed + i + 5) * .050;
        particle.life = kind === 'dust' ? .35 + hash(seed + i + 6) * .20 : .36 + hash(seed + i + 7) * .22;
        particle.alpha = kind === 'dust' ? .82 : .98; particle.spin = kind === 'chip' ? (hash(seed + i + 12) - .5) * 22 : .5;
        euler.set(hash(seed + i + 13) * 6, hash(seed + i + 14) * 6, angle); particle.quaternion.setFromEuler(euler);
      }
      if (i < 18) {
        p.copy(contact); p.y += .045;
        axis.set(radialX * (2.7 + hash(seed + i) * 2), .4 + hash(seed + i + 22) * 1.4, radialZ * (2.7 + hash(seed + i) * 2));
        spawnSpark(p, axis, i % 3 === 0 ? SWEEP_PALETTES[0].spark : SWEEP_PALETTES[2].spark, .28 + hash(seed + i + 4) * .24, .21 + hash(seed + i + 3) * .10, seed + i);
      }
    }
    attach(); sync(); return true;
  }

  function movement({ position, direction, speed = 0, dt = 0, grounded = true } = {}) {
    if (destroyed || !grounded || !position || !Number.isFinite(speed) || speed < 1.8 || !Number.isFinite(dt) || dt <= 0) { movementDelay = 0; return false; }
    vector(contact, position); if (!finiteVector(contact)) return false;
    if (direction) vector(heading, direction); else heading.set(0, 0, 1); heading.y = 0;
    if (!finiteVector(heading) || heading.lengthSq() < 1e-8) return false; heading.normalize();
    movementDelay += dt; if (movementDelay < .045) return false; movementDelay %= .045;
    const seed = ++movementBursts * 19, side = hash(seed) > .5 ? 1 : -1, gain = clamp(speed / 4, .55, 1.4);
    const particle = dust[dustCursor]; dustCursor = (dustCursor + 1) % dust.length; begin(particle);
    particle.origin.copy(contact); particle.origin.y = Math.max(.07, contact.y + .025);
    particle.origin.x += heading.z * .16 * side; particle.origin.z -= heading.x * .16 * side;
    particle.velocity.set(-heading.x * speed * .18, .38, -heading.z * speed * .18);
    particle.size = .07 + .025 * gain; particle.life = .22; particle.alpha = .46; particle.spin = .4; particle.quaternion.identity();
    p.copy(particle.origin); p.y += .025; axis.copy(heading).multiplyScalar(-speed * .30); axis.y = .12;
    spawnSpark(p, axis, SWEEP_PALETTES[0].spark, .17 * gain, .13, seed);
    attach(); sync(); return true;
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Hammer feedback dt must be finite and nonnegative');
    if (destroyed || dt === 0) return;
    for (const collection of [heads, dust, chips, sparks, contacts, sweeps]) for (const record of collection) tick(record, dt);
    sync();
  }
  function presented() {
    if (destroyed) return;
    for (const mesh of instances) presentedMesh(mesh);
    for (const record of contacts) if (record.mesh.visible) present(record);
    for (const record of sweeps) if (record.mesh.visible) present(record);
  }
  function clear() {
    for (const collection of [heads, dust, chips, sparks, contacts, sweeps]) for (const record of collection) {
      record.active = false; record.awaitingPresentation = false; record.age = 0;
      if (record.samples) record.samples.length = 0;
    }
    seenContacts.clear(); strike = null; distanceSinceSample = 0; timeSinceSample = 0; movementDelay = 0;
    headCursor = 0; dustCursor = 0; chipCursor = 0; sparkCursor = 0; contactCursor = 0; sweepCursor = 0;
    sync(); group.removeFromParent();
  }
  function diagnostics() {
    return {
      destroyed, budget: HAMMER_FEEDBACK_BUDGET, lastSpeed, sampledHeads, floorContacts, movementBursts,
      activeHeads: headMesh.count, activeDust: dustMesh.count, activeChips: chipMesh.count, activeSparks: sparkMesh.count,
      activeContacts: contacts.filter(record => record.active).length, activeSweeps: sweeps.filter(record => record.active).length,
      geometryCount: geometries.size, materialCount: materials.size,
      sweeps: sweeps.filter(record => record.active).map(record => ({ combo: record.combo, strikeId: record.strikeId, samples: record.samples.length, age: record.age, life: record.life })),
      heads: heads.filter(record => record.active).map(record => ({
        position: record.position.toArray(), quaternion: record.quaternion.toArray(), size: record.size.toArray(),
        age: record.age, life: record.life, combo: record.combo, strikeId: record.strikeId, awaitingPresentation: record.awaitingPresentation,
      })),
    };
  }
  function destroy() {
    if (destroyed) return;
    clear(); for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
    geometries.clear(); materials.clear(); group.clear(); destroyed = true;
  }
  return { trace, ground, movement, update, presented, clear, destroy, diagnostics };
}
