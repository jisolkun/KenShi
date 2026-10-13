import * as THREE from 'three';

// Combat owns the source clocks. These renderers observe them and sample the
// real weapon, so a visual trail can never add a hit or cancel another volume.
const LIMIT = 32, HISTORY = 18, BLADE_HISTORY = 48, Y = new THREE.Vector3(0, 1, 0);
const STYLES = Object.freeze({
  'dual-dao': { name: 'paired-edge-paths', color: 0x83b9e7, offColor: 0x66ddd0, width: .023,
    inner: .34, outer: 1.24, trail: .10, tail: .18, glow: .62, edgeWidth: .022, halo: .11 },
  'tang-dao': { name: 'precise-edge-path', color: 0xb7d8f0, width: .019,
    inner: .24, outer: 1.32, trail: .14, tail: .21, glow: .72, edgeWidth: .027, halo: .13 },
  'great-dao': { name: 'heavy-steel-cut', color: 0x6c99bf, width: .071,
    inner: .12, outer: 1.40, trail: .18, tail: .24, glow: .56, edgeWidth: .046, halo: .18 },
  'great-hammer': { name: 'forged-head-pressure', color: 0xc89a54, trail: .075, tail: .14, glow: .25 },
});

function effectMaterial(color, instanced = false, additive = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, fade: { value: 1 } },
    vertexShader: `${instanced ? 'attribute float instanceFade;' : 'attribute float effectAlpha;'}
      varying float inkAlpha; varying vec3 inkColor; uniform vec3 tint;
      void main(){
        inkAlpha=${instanced ? 'instanceFade' : 'effectAlpha'};inkColor=tint;
        vec4 p=vec4(position,1.0);
        ${instanced ? 'p=instanceMatrix*p;\n#ifdef USE_INSTANCING_COLOR\ninkColor*=instanceColor;\n#endif' : ''}
        gl_Position=projectionMatrix*modelViewMatrix*p;
      }`,
    fragmentShader: 'varying float inkAlpha; varying vec3 inkColor; uniform float fade; void main(){gl_FragColor=vec4(inkColor,inkAlpha*fade);}',
  });
}

function trailGeometry(sections = 2) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLADE_HISTORY * sections * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('effectAlpha', new THREE.BufferAttribute(new Float32Array(BLADE_HISTORY * sections), 1).setUsage(THREE.DynamicDrawUsage));
  const indices = [];
  for (let i = 0; i < BLADE_HISTORY - 1; i++) for (let j = 0; j < sections - 1; j++) {
    const p = i * sections + j, next = p + sections;
    indices.push(p, p + 1, next, p + 1, next + 1, next);
  }
  geometry.setIndex(indices); geometry.setDrawRange(0, 0);
  geometry.userData.effectGeometry = 'physical-blade-sweep'; geometry.userData.sections = sections;
  return geometry;
}

function crackGeometry() {
  const points = [], opacity = [];
  for (let ray = 0; ray < 8; ray++) {
    const angle = ray * Math.PI / 4 + .13 * Math.sin(ray * 1.7);
    let x = 0, z = 0;
    for (let step = 1; step <= 3; step++) {
      const r = .27 * step, a = angle + .17 * Math.sin(ray * 2.4 + step);
      const nx = Math.cos(a) * r, nz = Math.sin(a) * r;
      points.push(x, 0, z, nx, 0, nz); opacity.push(.38, .38 * (1 - step * .17)); x = nx; z = nz;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('effectAlpha', new THREE.Float32BufferAttribute(opacity, 1));
  geometry.userData.effectGeometry = 'radial-floor-cracks'; return geometry;
}

export function createWeaponFeedback(scene) {
  const active = new Map(), pooled = [], shared = new Map();
  const matrix = new THREE.Matrix4(), orientation = new THREE.Quaternion();
  const direction = new THREE.Vector3(), scale = new THREE.Vector3();
  const sampleCache = new Map(); let sequence = 0, sampledRigs = 0;
  const geometry = (key, build) => {
    if (!shared.has(key)) shared.set(key, build());
    return shared.get(key);
  };
  function instanced(entry, key, build, count, color, additive = false) {
    // The instance attribute belongs to this bounded slot, never the rig or a
    // second effect. Vertex geometry is cached; buffers are allocated at emit.
    const geo = geometry(key, build).clone();
    geo.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    const mat = effectMaterial(color, true, additive), mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
    mesh.renderOrder = 5; mesh.name = key; entry.group.add(mesh);
    entry.ownedGeometry.push(geo); entry.materials.push(mat); return mesh;
  }
  function makeEntry(kind) {
    const group = new THREE.Group();
    const entry = { kind, group, ownedGeometry: [], materials: [], history: [], points: [], cursor: 0, count: 0,
      scratch: { tip: new THREE.Vector3(), heel: new THREE.Vector3(), edge: new THREE.Vector3(), head: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(), extents: new THREE.Vector3(), bottom: new THREE.Vector3() } };
    for (let i = 0; i < (kind === 'blade' ? BLADE_HISTORY : HISTORY); i++) entry.history.push({ position: new THREE.Vector3(),
      heel: new THREE.Vector3(), edge: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(), extents: new THREE.Vector3(), age: -100 });
    for (let i = 0; i < 20; i++) entry.points.push({ p: new THREE.Vector3(), velocity: new THREE.Vector3(), size: .02, age: -100 });
    if (kind === 'blade') {
      const geo = trailGeometry(4), mat = effectMaterial(0xffffff, false, true), mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'physical-blade-path'; group.add(mesh);
      entry.trail = mesh; entry.ownedGeometry.push(geo); entry.materials.push(mat);
      const haloGeo = trailGeometry(4), haloMat = effectMaterial(0xffffff, false, true);
      entry.halo = new THREE.Mesh(haloGeo, haloMat); entry.halo.name = 'blade-outer-glow';
      entry.halo.frustumCulled = false; entry.halo.renderOrder = 4; group.add(entry.halo);
      entry.ownedGeometry.push(haloGeo); entry.materials.push(haloMat);
      const edgeGeo = trailGeometry(), edgeMat = effectMaterial(0xffffff, false, true);
      entry.brightEdge = new THREE.Mesh(edgeGeo, edgeMat); entry.brightEdge.name = 'blade-bright-edge';
      entry.brightEdge.frustumCulled = false; entry.brightEdge.renderOrder = 6; group.add(entry.brightEdge);
      entry.ownedGeometry.push(edgeGeo); entry.materials.push(edgeMat);
      const glintGeometry = geometry('edge-glint', () => new THREE.BoxGeometry(1, 1, 1));
      const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false });
      entry.glint = new THREE.Mesh(glintGeometry, glintMat); entry.glint.name = 'real-blade-edge-glint'; group.add(entry.glint);
      entry.materials.push(glintMat);
      // A heavier dao leaves a muted gold edge inside its longer steel trace.
      const gold = effectMaterial(0xc4a478, false, true), goldGeo = trailGeometry();
      entry.weightLine = new THREE.Mesh(goldGeo, gold); entry.weightLine.name = 'heavy-dao-gold-edge'; entry.weightLine.frustumCulled = false;
      group.add(entry.weightLine); entry.materials.push(gold); entry.ownedGeometry.push(goldGeo);
    } else if (kind === 'hammer') {
      entry.ghosts = instanced(entry, 'solid-hammer-head-ghosts', () => new THREE.BoxGeometry(1, 1, 1), HISTORY, 0x95774c);
      entry.smoke = instanced(entry, 'short-head-pressure', () => new THREE.IcosahedronGeometry(1, 1), 12, 0x655b50);
      entry.sparks = instanced(entry, 'hammer-amber-sparks', () => new THREE.BoxGeometry(1, 1, 1), 8, 0xe0ab54, true);
    } else {
      const ringGeo = geometry('concentric-floor-pressure', () => {
        const g = new THREE.RingGeometry(.94, 1, 48); g.rotateX(-Math.PI / 2); return g;
      });
      for (let i = 0; i < 2; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: i ? 0x8d8069 : 0xccaa71, transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        const ring = new THREE.Mesh(ringGeo, mat); ring.name = 'concentric-ground-pressure'; group.add(ring);
        entry.materials.push(mat); (entry.rings ??= []).push(ring);
      }
      const crackMat = effectMaterial(0x292820), cracks = new THREE.LineSegments(geometry('floor-cracks', crackGeometry), crackMat);
      cracks.name = 'ground-impact-cracks'; group.add(cracks); entry.cracks = cracks; entry.materials.push(crackMat);
      entry.dust = instanced(entry, 'ground-dust-and-stone', () => new THREE.IcosahedronGeometry(1, 0), 20, 0x958876);
    }
    pooled.push(entry); return entry;
  }
  function release(entry) {
    scene.remove(entry.group); entry.group.visible = false; entry.inUse = false;
    if (active.get(entry.key) === entry) active.delete(entry.key);
    entry.root = entry.rig = entry.volume = entry.descriptor = null;
  }
  function acquire(kind) {
    let entry = pooled.find(slot => !slot.inUse && slot.kind === kind);
    if (entry) return entry;
    if (pooled.length >= LIMIT) {
      const oldest = active.values().next().value;
      if (oldest) release(oldest);
      entry = pooled.find(slot => !slot.inUse && slot.kind === kind);
      if (entry) return entry;
      const unused = pooled.find(slot => !slot.inUse);
      if (unused) {
        for (const child of unused.group.children) if (child.isInstancedMesh) child.dispose();
        for (const geo of unused.ownedGeometry) geo.dispose();
        for (const mat of unused.materials) mat.dispose();
        pooled.splice(pooled.indexOf(unused), 1);
      }
    }
    return makeEntry(kind);
  }
  function emit(root, descriptor, volume, rig) {
    if (!volume?.clock) throw new TypeError('Weapon feedback requires an authoritative source volume clock');
    const weaponId = descriptor.weaponId ?? rig?.weaponId;
    if (!STYLES[weaponId]) throw new RangeError(`Unsupported visual weapon ${weaponId}`);
    const isGround = descriptor.type === 'splash' || descriptor.emitter === 'splash';
    const kind = isGround ? 'ground' : weaponId === 'great-hammer' ? 'hammer' : 'blade';
    const hand = descriptor.hand ?? (weaponId === 'dual-dao' && descriptor.emitter === 'swing2' ? 0 : 1);
    const key = `${root?.uuid ?? root?.id ?? 'hero'}:${weaponId}:${descriptor.emitter}:${hand}`;
    if (active.has(key)) release(active.get(key));
    const entry = acquire(kind), group = entry.group, style = STYLES[weaponId];
    Object.assign(entry, { root, rig, volume, descriptor, weaponId, style, hand, key, inUse: true, age: 0,
      tailAge: 0, started: false, snapped: false, cursor: 0, count: 0, impactSeen: false, sampleSeen: false,
      contactAge: -100, showAge: 0, sweepWidth: 0, tipExtension: 0, order: sequence++ });
    for (const h of entry.history) h.age = -100;
    for (const p of entry.points) p.age = -100;
    group.position.set(0, 0, 0); group.quaternion.identity(); group.scale.set(1, 1, 1); group.visible = false;
    group.name = `${weaponId}: ${isGround ? 'physical ground pressure' : style.name}`;
    group.userData = { effectType: `weapon-${kind}`, weaponId, style: isGround ? 'ground-pressure-dust' : style.name,
      descriptor, hand, atlasFrame: -1, collisionActive: false, attachment: isGround ? 'actual-head-floor-snapshot' : 'actual-weapon-world-path' };
    entry.contact ??= new THREE.Vector3();
    if (kind === 'blade') {
      const color = weaponId === 'dual-dao' && hand === 0 ? style.offColor : style.color;
      entry.trail.material.uniforms.tint.value.setHex(color); entry.glint.material.color.setHex(color);
      entry.halo.material.uniforms.tint.value.setHex(color); entry.brightEdge.material.uniforms.tint.value.setHex(color);
      entry.trail.geometry.userData.radialRange = [style.inner, style.outer];
      entry.halo.geometry.userData.radialRange = [Math.max(0, style.inner - style.halo), style.outer + style.halo];
      for (const mesh of [entry.halo, entry.brightEdge, entry.weightLine]) mesh.geometry.setDrawRange(0, 0);
      entry.weightLine.visible = weaponId === 'great-dao'; entry.trail.geometry.setDrawRange(0, 0); entry.glint.visible = false;
    }
    group.cancel = () => release(entry); // Visual ownership never reaches into collision ownership.
    active.set(key, entry); scene.add(group); return group;
  }
  function sample(entry) {
    let samples = sampleCache.get(entry.rig);
    if (!samples) { samples = entry.rig?.weaponBlades?.() ?? []; sampleCache.set(entry.rig, samples); sampledRigs++; }
    let frame = samples.find(candidate => candidate.hand === entry.hand);
    if (!frame && samples.length === 1) frame = samples[0];
    if (!frame) return false;
    const s = entry.scratch;
    s.tip.copy(frame.tip); s.heel.copy(frame.heel); s.edge.copy(frame.edge ?? Y).normalize();
    if (frame.headCenter) {
      s.head.copy(frame.headCenter); s.quaternion.copy(frame.headQuaternion ?? orientation.identity());
      s.extents.copy(frame.headHalfExtents ?? scale.set(.27, .19, .19));
      s.bottom.copy(frame.headBottom?.isVector3 ? frame.headBottom : frame.headCenter);
      if (Number.isFinite(frame.headMinY)) s.bottom.y = frame.headMinY;
      const groundY = entry.descriptor.groundY ?? .05;
      if (s.bottom.y <= groundY + .13) { entry.contactAge = entry.age; entry.contact.copy(s.bottom); }
    }
    entry.sampleSeen = true; entry.sampleHand = frame.hand;
    return true;
  }
  function remember(entry) {
    const h = entry.history[entry.cursor], s = entry.scratch;
    h.position.copy(entry.kind === 'hammer' ? s.head : s.tip); h.heel.copy(s.heel); h.edge.copy(s.edge);
    h.quaternion.copy(s.quaternion); h.extents.copy(s.extents); h.age = entry.age;
    entry.cursor = (entry.cursor + 1) % entry.history.length; entry.count = Math.min(entry.history.length, entry.count + 1);
  }
  function writeInstance(mesh, index, p, q, size, alpha) {
    matrix.compose(p, q, size); mesh.setMatrixAt(index, matrix);
    mesh.geometry.attributes.instanceFade.array[index] = alpha;
  }
  function finishInstances(mesh, count) {
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.instanceFade.needsUpdate = true;
  }
  function blade(entry, showing) {
    const { style, trail, scratch: s } = entry;
    if (showing && entry.sampleSeen) remember(entry);
    // Each section spans the real heel-to-tip direction, rather than a thin
    // ribbon centered at the tip. Successive posed blades create the arc; no
    // root-centered crescent is invented when the weapon changes direction.
    const writeBand = (mesh, index, h, inner, outer, opacity, broad = false) => {
      const positions = mesh.geometry.attributes.position, alphas = mesh.geometry.attributes.effectAlpha;
      const sections = broad ? 4 : 2, span = outer - inner;
      for (let radial = 0; radial < sections; radial++) {
        const ratio = broad ? (radial === 0 ? 0 : radial === 1 ? .25 : radial === 2 ? .83 : 1) : radial;
        const along = inner + span * ratio, p = index * sections + radial;
        positions.setXYZ(p, h.heel.x + (h.position.x - h.heel.x) * along,
          h.heel.y + (h.position.y - h.heel.y) * along, h.heel.z + (h.position.z - h.heel.z) * along);
        const radialAlpha = broad ? (radial === 0 || radial === 3 ? 0 : radial === 1 ? .36 : .62) : 1;
        alphas.setX(p, opacity * radialAlpha);
      }
    };
    let count = 0;
    for (let i = 0; i < entry.count; i++) {
      const h = entry.history[(entry.cursor - entry.count + i + BLADE_HISTORY) % BLADE_HISTORY], age = entry.age - h.age;
      if (age > style.trail + style.tail) continue;
      const opacity = style.glow * Math.max(0, 1 - age / (style.trail + style.tail)) ** 1.25;
      const length = h.position.distanceTo(h.heel), edgeWidth = style.edgeWidth / Math.max(.001, length);
      writeBand(trail, count, h, style.inner, style.outer, opacity, true);
      writeBand(entry.halo, count, h, Math.max(0, style.inner - style.halo), style.outer + style.halo, opacity * .26, true);
      writeBand(entry.brightEdge, count, h, style.outer - edgeWidth * 1.5,
        style.outer - edgeWidth * .5, opacity * .72);
      writeBand(entry.weightLine, count, h, style.outer - .13 - edgeWidth * .5,
        style.outer - .13 + edgeWidth * .5, opacity);
      count++;
    }
    const tailFade = entry.volume.clock.finished ? Math.max(0, 1 - entry.tailAge / style.tail) : 1;
    for (const mesh of [trail, entry.halo, entry.brightEdge, entry.weightLine]) {
      mesh.geometry.attributes.position.needsUpdate = mesh.geometry.attributes.effectAlpha.needsUpdate = true;
      mesh.geometry.setDrawRange(0, Math.max(0, count - 1) * (mesh.geometry.userData.sections - 1) * 6);
      mesh.material.uniforms.fade.value = tailFade * (mesh === entry.weightLine ? .42 : 1);
    }
    entry.sweepWidth = s.tip.distanceTo(s.heel) * (style.outer - style.inner);
    entry.tipExtension = s.tip.distanceTo(s.heel) * (style.outer - 1);
    entry.glint.visible = showing && entry.sampleSeen;
    if (entry.glint.visible) {
      direction.subVectors(s.tip, s.heel); const length = direction.length();
      entry.glint.position.copy(s.heel).addScaledVector(direction, .5).addScaledVector(s.edge, style.width);
      entry.glint.quaternion.setFromUnitVectors(Y, direction.normalize());
      entry.glint.scale.set(style.width * .46, length, style.width * .32);
      entry.glint.material.opacity = style.glow * .44;
    }
  }
  function burst(entry) {
    const s = entry.scratch, previous = entry.history[(entry.cursor - 2 + HISTORY) % HISTORY];
    direction.subVectors(s.head, previous.position);
    if (direction.lengthSq() > .00001) direction.normalize(); else direction.set(0, -1, 0);
    for (let i = 0; i < entry.points.length; i++) {
      const p = entry.points[i], a = i * 2.39996;
      p.p.copy(s.head); p.age = entry.age;
      p.velocity.set(Math.cos(a) * (i < 12 ? .38 : 1.5), .2 + (i % 3) * .23, Math.sin(a) * (i < 12 ? .38 : 1.5));
      p.velocity.addScaledVector(direction, i < 12 ? -.18 : .5);
      p.size = i < 12 ? .05 + i % 4 * .017 : .012;
    }
  }
  function hammer(entry, showing, dt) {
    if (showing && entry.sampleSeen) remember(entry);
    let ghostCount = 0;
    for (let i = 0; i < entry.count; i++) {
      const h = entry.history[(entry.cursor - entry.count + i + HISTORY) % HISTORY], age = entry.age - h.age;
      if (age > entry.style.trail + entry.style.tail) continue;
      scale.copy(h.extents).multiplyScalar(2.015);
      writeInstance(entry.ghosts, ghostCount++, h.position, h.quaternion, scale, .20 * Math.max(0, 1 - age / .22) ** 2);
    }
    finishInstances(entry.ghosts, ghostCount);
    if (showing && entry.volume.clock.colliding && !entry.impactSeen && entry.sampleSeen) { burst(entry); entry.impactSeen = true; }
    let smokeCount = 0, sparkCount = 0;
    for (let i = 0; i < entry.points.length; i++) {
      const p = entry.points[i], age = entry.age - p.age, ttl = i < 12 ? .22 : .15;
      if (age < 0 || age > ttl) continue;
      p.p.addScaledVector(p.velocity, dt); p.velocity.y -= dt * (i < 12 ? .2 : 5);
      if (i < 12) { scale.setScalar(p.size * (1 + age * 3)); writeInstance(entry.smoke, smokeCount++, p.p, orientation.identity(), scale, .24 * (1 - age / ttl)); }
      else { scale.set(.012, .05 * (1 - age / ttl) + .015, .012); orientation.setFromUnitVectors(Y, direction.copy(p.velocity).normalize()); writeInstance(entry.sparks, sparkCount++, p.p, orientation, scale, .68 * (1 - age / ttl)); }
    }
    finishInstances(entry.smoke, smokeCount); finishInstances(entry.sparks, sparkCount);
  }
  function ground(entry, showing, dt) {
    if (showing && !entry.snapped && entry.sampleSeen && entry.age - entry.contactAge <= .22) {
      entry.group.position.copy(entry.contact); entry.group.position.y = (entry.descriptor.groundY ?? .05) + .018;
      entry.snapped = true; entry.showAge = entry.age;
      for (let i = 0; i < entry.points.length; i++) {
        const p = entry.points[i], a = i * 2.39996, r = .08 + i % 4 * .028;
        p.p.set(Math.cos(a) * r, .014, Math.sin(a) * r); p.age = entry.age;
        p.velocity.set(Math.cos(a) * (.9 + i % 3 * .22), .3 + i % 5 * .085, Math.sin(a) * (.9 + i % 3 * .22));
        p.size = i < 12 ? .04 + i % 4 * .012 : .025;
      }
    }
    entry.group.visible = showing && entry.snapped;
    if (!entry.snapped) return;
    const t = entry.age - entry.showAge;
    for (let i = 0; i < entry.rings.length; i++) {
      const u = Math.max(0, t - i * .065), radius = .22 + u * (i ? 2.5 : 3.7);
      entry.rings[i].scale.setScalar(radius); entry.rings[i].material.opacity = Math.max(0, .26 * (1 - u / .34));
      entry.rings[i].position.y = i * .002;
    }
    entry.cracks.material.uniforms.fade.value = .65 * (entry.volume.clock.tint ?? Math.max(0, 1 - t));
    let count = 0;
    for (let i = 0; i < entry.points.length; i++) {
      const p = entry.points[i], age = entry.age - p.age, ttl = i < 12 ? .52 : .33;
      if (age < 0 || age > ttl) continue;
      p.p.addScaledVector(p.velocity, dt); p.velocity.y -= dt * 3.2; p.velocity.x *= Math.max(0, 1 - dt * 2); p.velocity.z *= Math.max(0, 1 - dt * 2);
      if (p.p.y < .01) p.p.y = .01;
      scale.setScalar(p.size * (i < 12 ? 1 + age * 3.8 : 1));
      writeInstance(entry.dust, count++, p.p, orientation.identity(), scale, (i < 12 ? .31 : .7) * (1 - age / ttl));
    }
    finishInstances(entry.dust, count);
  }
  function update(dt = 0) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Nonnegative finite visual delta required');
    if (dt === 0) return;
    sampleCache.clear(); sampledRigs = 0;
    for (const entry of active.values()) {
      const clock = entry.volume.clock;
      if (entry.volume.cancelled) { release(entry); continue; }
      entry.age += dt;
      if (!clock.finished) sample(entry);
      const showing = clock.visible && !clock.finished;
      if (showing) entry.started = true;
      if (clock.finished) {
        if (!entry.started || entry.kind === 'ground') { release(entry); continue; }
        entry.tailAge += dt;
        if (entry.tailAge > entry.style.tail) { release(entry); continue; }
      }
      entry.group.visible = showing || (entry.started && clock.finished);
      entry.group.userData.atlasFrame = clock.frame;
      entry.group.userData.collisionActive = showing && clock.colliding;
      if (entry.kind === 'blade') blade(entry, showing);
      else if (entry.kind === 'hammer') hammer(entry, showing, dt);
      else ground(entry, showing, dt);
    }
  }
  function clear() {
    for (const entry of pooled) {
      scene.remove(entry.group);
      for (const child of entry.group.children) if (child.isInstancedMesh) child.dispose();
      for (const geo of entry.ownedGeometry) geo.dispose();
      for (const mat of entry.materials) mat.dispose();
      entry.inUse = false; entry.root = entry.rig = entry.volume = null;
    }
    for (const geo of shared.values()) geo.dispose();
    active.clear(); pooled.length = 0; shared.clear(); sampleCache.clear();
  }
  function diagnostics() {
    return { active: active.size, capacity: LIMIT, pooled: pooled.length, sharedGeometry: shared.size, sampledRigs,
      effects: Array.from(active.values(), entry => ({ weaponId: entry.weaponId, style: entry.group.userData.style,
        emitter: entry.descriptor.emitter, hand: entry.hand, sampleHand: entry.sampleHand, visible: entry.group.visible,
        collision: entry.group.userData.collisionActive, frame: entry.volume.clock.frame, attachment: entry.group.userData.attachment,
        tail: entry.volume.clock.finished, samples: entry.count, snapped: entry.snapped,
        sweepWidth: entry.kind === 'blade' ? entry.sweepWidth : null,
        tipExtension: entry.kind === 'blade' ? entry.tipExtension : null,
        radialRange: entry.kind === 'blade' ? [entry.style.inner, entry.style.outer] : null,
        visualTail: entry.style.tail,
        sample: entry.sampleSeen ? entry.scratch.tip.toArray() : null,
        headCenter: entry.sampleSeen && entry.kind !== 'blade' ? entry.scratch.head.toArray() : null,
        floorContact: entry.snapped ? entry.group.position.toArray() : null })) };
  }
  return { emit, update, clear, diagnostics };
}
