import * as THREE from 'three';

// A contact accent is deliberately shorter and smaller than either the weapon
// wake or a lethal breakup. Each weapon owns a different silhouette and pool.
export const WEAPON_IMPACT_PROFILES = Object.freeze({
  'dual-dao': Object.freeze({ family: 'paired-cut', styleId: 'dual-cross-flick', duration: .14, chips: 6 }),
  'tang-dao': Object.freeze({ family: 'incision', styleId: 'tang-directional-incision', duration: .17, chips: 4 }),
  'great-dao': Object.freeze({ family: 'heavy-cleave', styleId: 'great-cleave-slivers', duration: .23, chips: 7 }),
  'great-hammer': Object.freeze({ family: 'solid-pressure', styleId: 'hammer-compression-core', duration: .24, chips: 9 }),
});
export const WEAPON_IMPACT_POOL_SIZE = 12;

const FORWARD = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp;
const fraction = n => n - Math.floor(n);
const noise = n => fraction(Math.sin(n * 12.9898 + 78.233) * 43758.5453);

function vector(value, fallback = FORWARD) {
  if (Array.isArray(value)) return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (typeof value === 'number') return new THREE.Vector3(Math.sin(value), 0, Math.cos(value));
  return new THREE.Vector3(value?.x ?? fallback.x, value?.y ?? fallback.y, value?.z ?? fallback.z);
}

function geometryWithTag(geometry, role, family) {
  geometry.userData = { ...geometry.userData, role, family };
  return geometry;
}

// All cutting glints lie along local Z, the measured world strike direction.
// Each thin polygon has a tapered contact end rather than a large white sheet.
function cutGeometry(id) {
  const vertices = [];
  function polygon(points, angle = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const turned = points.map(([x, z]) => [x * c + z * s, 0, -x * s + z * c]);
    for (let i = 1; i < turned.length - 1; i++) vertices.push(...turned[0], ...turned[i], ...turned[i + 1]);
  }
  if (id === 'dual-dao') {
    polygon([[0, -.13], [.016, -.02], [.008, .12], [0, .18], [-.010, .03]], -.57);
    polygon([[0, -.13], [.012, .01], [0, .17], [-.017, -.01]], .57);
  } else if (id === 'tang-dao') {
    polygon([[0, -.12], [.009, -.025], [.005, .19], [0, .31], [-.007, .07]]);
  } else {
    polygon([[0, -.18], [.045, -.06], [.031, .05], [.012, .17], [0, .37], [-.019, .15], [-.035, -.04]]);
    polygon([[.053, -.025], [.077, .025], [.094, .17], [.051, .087]]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometryWithTag(geometry, id === 'dual-dao' ? 'crossed-flicks' : id === 'tang-dao' ? 'thin-incision' : 'wide-cleave', WEAPON_IMPACT_PROFILES[id].family);
}

function colorsFromRig(rig) {
  const palette = rig?.materials ?? {};
  const color = (keys, fallback) => {
    for (const key of keys) if (palette[key]?.color?.isColor) return palette[key].color.clone();
    return new THREE.Color(fallback);
  };
  return { armor: color(['armor', 'metal', 'edge'], 0x59625a), metal: color(['metal', 'edge', 'armor'], 0xc6cbc2),
  };
}

function transparentMaterial(color, { additive = false, lit = false } = {}) {
  const options = { color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending };
  return lit ? new THREE.MeshStandardMaterial({ ...options, flatShading: true, roughness: .85, metalness: .15 })
    : new THREE.MeshBasicMaterial(options);
}

/** Weapon-specific ordinary contacts, driven only by gameplay dt. */
export function createWeaponImpact(scene) {
  if (!scene?.isObject3D) throw new TypeError('Weapon impact requires a Three scene or group');
  const holder = new THREE.Group();
  holder.name = 'Weapon contacts: bounded independent pools';
  holder.userData.effectType = 'weapon-impact-pools';
  const pools = new Map(), ownedGeometry = new Set(), ownedMaterial = new Set(), ownedInstances = new Set();
  let serial = 0, destroyed = false;
  const point = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const ownGeometry = value => { ownedGeometry.add(value); return value; };
  const ownMaterial = value => { ownedMaterial.add(value); return value; };

  function ensurePool(id) {
    if (pools.has(id)) return pools.get(id);
    const profile = WEAPON_IMPACT_PROFILES[id];
    const hammer = id === 'great-hammer';
    const glintGeometry = ownGeometry(hammer
      ? geometryWithTag(new THREE.IcosahedronGeometry(1, 1), 'volumetric-pressure-core', profile.family) : cutGeometry(id));
    const chipGeometry = ownGeometry(geometryWithTag(hammer ? new THREE.BoxGeometry(1, .4, .75) : id === 'great-dao'
      ? new THREE.OctahedronGeometry(1, 0) : id === 'dual-dao' ? new THREE.TetrahedronGeometry(1, 0) : new THREE.BoxGeometry(1, .35, .8), 'armor-chips', profile.family));
    const sliverGeometry = id === 'great-dao' ? ownGeometry(geometryWithTag(new THREE.TetrahedronGeometry(1, 0), 'stylized-dark-red-slivers', profile.family)) : null;
    const pool = { next: 0, slots: [] };
    for (let i = 0; i < WEAPON_IMPACT_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.name = `${profile.styleId}: slot ${i}`;
      group.visible = false;
      group.userData = { effectType: 'weapon-impact', weaponId: id, effectFamily: profile.family, styleId: profile.styleId, poolSlot: i, phase: 'inactive' };
      const glint = new THREE.Mesh(glintGeometry, ownMaterial(transparentMaterial(hammer ? 0xf1ddaa : id === 'great-dao' ? 0xe3c4a9 : id === 'tang-dao' ? 0xebdac4 : 0xd4e3df, { additive: !hammer })));
      glint.name = hammer ? 'Compact solid contact pressure' : 'Directional cutting contact';
      group.add(glint);
      const chips = new THREE.InstancedMesh(chipGeometry, ownMaterial(transparentMaterial(0x59625a, { lit: true })), profile.chips);
      chips.frustumCulled = false;
      chips.name = `${id} faceted armor chips`;
      chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ownedInstances.add(chips);
      group.add(chips);
      const slivers = sliverGeometry ? new THREE.InstancedMesh(sliverGeometry, ownMaterial(transparentMaterial(0x65171b)), 5) : null;
      if (slivers) { slivers.name = 'Dark red stylized cutting slivers'; slivers.frustumCulled = false; ownedInstances.add(slivers); group.add(slivers); }
      holder.add(group);
      const slot = { id, index: i, group, glint, chips, slivers, age: 0, life: profile.duration,
        active: false, serial: 0, seed: i, gain: 1, awaitingPresentation: false, unseenAge: 0,
        gravity: new THREE.Vector3(), direction: FORWARD.clone() };
      if (hammer) for (const mesh of [glint, chips]) mesh.onAfterRender = () => {
        if (slot.active && slot.awaitingPresentation) { slot.awaitingPresentation = false; slot.age = 0; }
      };
      group.userData.snapshot = () => slotSnapshot(slot);
      pool.slots.push(slot);
    }
    pools.set(id, pool);
    return pool;
  }

  function particles(slot, mesh, kind) {
    if (!mesh) return;
    const t = slot.age, progress = clamp(t / slot.life, 0, 1);
    for (let i = 0; i < mesh.count; i++) {
      const seed = slot.seed * 17 + i * 3.7 + (kind === 'sliver' ? 200 : 0);
      const angle = noise(seed) * Math.PI * 2, radial = .8 + noise(seed + 1) * 1.45;
      const forward = (slot.id === 'great-hammer' ? 1.7 : 1.1) + noise(seed + 2) * 1.7;
      const spread = slot.id === 'great-hammer' ? .62 : .5;
      point.set(Math.cos(angle) * radial * t * spread, Math.sin(angle) * radial * t * spread, forward * t);
      point.addScaledVector(slot.gravity, .5 * t * t);
      euler.set(noise(seed + 3) * 6 + t * 11, noise(seed + 4) * 6 - t * 8, angle + t * 9);
      rotation.setFromEuler(euler);
      const size = (.018 + noise(seed + 5) * .028) * (1 - progress * .6);
      if (kind === 'sliver') scale.set(size * .4, size * .65, size * 2.5);
      else scale.set(size, size * (slot.id === 'great-hammer' ? .45 : .8), size);
      matrix.compose(point, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.material.opacity = .95 * (1 - progress * progress);
  }

  function sync(slot) {
    const p = clamp(slot.age / slot.life, 0, 1);
    slot.group.visible = slot.active;
    const phase = !slot.active ? 'inactive' : slot.age < .028 ? 'contact' : p < .52 ? 'burst' : 'fade';
    Object.assign(slot.group.userData, { active: slot.active, phase, age: slot.age, duration: slot.life, serial: slot.serial });
    if (!slot.active) return;
    const flash = Math.max(0, 1 - slot.age / .105);
    slot.glint.visible = flash > 0;
    slot.glint.material.opacity = flash * (slot.id === 'great-hammer' ? .80 : .68);
    if (slot.id === 'great-hammer') {
      const pressure = 1 + Math.min(1, slot.age / .030) * .35;
      slot.glint.scale.set(.082 * pressure * (1 - p * .55), .070 * pressure, .115 * pressure);
      slot.glint.material.color.setHex(slot.age < .025 ? 0xfff1cd : 0xd7b877);
    } else slot.glint.scale.set(1 - p * .55, 1, .85 + p * .65);
    particles(slot, slot.chips, 'chip');
    particles(slot, slot.slivers, 'sliver');
  }

  function slotSnapshot(slot) {
    return { weaponId: slot.id, family: WEAPON_IMPACT_PROFILES[slot.id].family, styleId: WEAPON_IMPACT_PROFILES[slot.id].styleId,
      poolSlot: slot.index, active: slot.active, phase: slot.group.userData.phase, serial: slot.serial, age: slot.age,
      duration: slot.life, direction: slot.direction.toArray(), position: slot.group.position.toArray(),
      quaternion: slot.group.quaternion.toArray(), critical: slot.critical ?? false, combo: slot.combo ?? 0,
      awaitingPresentation: slot.awaitingPresentation,
      geometryRoles: slot.group.children.map(child => child.geometry?.userData.role).filter(Boolean) };
  }

  function snapshot() {
    const slots = [...pools.values()].flatMap(pool => pool.slots.map(slotSnapshot));
    return { poolSizePerWeapon: WEAPON_IMPACT_POOL_SIZE, poolCount: pools.size, capacity: WEAPON_IMPACT_POOL_SIZE * Object.keys(WEAPON_IMPACT_PROFILES).length,
      allocatedSlots: slots.length, activeCount: slots.filter(slot => slot.active).length,
      geometryCount: ownedGeometry.size, materialCount: ownedMaterial.size, destroyed, slots };
  }

  function clear() {
    for (const pool of pools.values()) {
      pool.next = 0;
      for (const slot of pool.slots) { slot.active = false; slot.age = 0; slot.awaitingPresentation = false; sync(slot); }
    }
    holder.removeFromParent();
  }

  return {
    hit(position, direction, weaponId, combo = 0, critical = false, targetRig = null) {
      if (destroyed) throw new Error('Weapon impact has been destroyed');
      if (!WEAPON_IMPACT_PROFILES[weaponId]) throw new RangeError(`Unknown contact weapon: ${weaponId}`);
      const pool = ensurePool(weaponId), slot = pool.slots[pool.next];
      pool.next = (pool.next + 1) % WEAPON_IMPACT_POOL_SIZE;
      slot.active = true; slot.age = 0; slot.serial = ++serial; slot.seed = serial;
      const strokes = weaponId === 'great-hammer' ? 3 : 5;
      slot.combo = ((Math.trunc(combo) % strokes) + strokes) % strokes; slot.critical = !!critical;
      const finisher = slot.combo === strokes - 1;
      slot.life = WEAPON_IMPACT_PROFILES[weaponId].duration * (finisher ? 1.15 : 1);
      slot.gain = (finisher ? 1.18 : 1) * (critical ? 1.12 : 1);
      slot.awaitingPresentation = weaponId === 'great-hammer'; slot.unseenAge = 0;
      slot.group.position.copy(vector(position, new THREE.Vector3()));
      slot.direction.copy(vector(direction));
      if (!Number.isFinite(slot.direction.lengthSq()) || slot.direction.lengthSq() < 1e-10) slot.direction.copy(FORWARD);
      slot.direction.normalize();
      slot.group.quaternion.setFromUnitVectors(FORWARD, slot.direction);
      slot.group.scale.setScalar(slot.gain);
      slot.gravity.set(0, -7.8, 0).applyQuaternion(slot.group.quaternion.clone().invert());
      const colors = colorsFromRig(targetRig);
      slot.chips.material.color.copy(weaponId === 'dual-dao' || weaponId === 'tang-dao' ? colors.metal : colors.armor);
      if (weaponId === 'great-hammer') slot.chips.material.color.lerp(new THREE.Color(0x69716e), .78);
      sync(slot);
      if (holder.parent !== scene) scene.add(holder);
      return slot.group;
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Weapon contact dt must be finite and nonnegative');
      if (dt === 0 || destroyed) return;
      for (const pool of pools.values()) for (const slot of pool.slots) {
        if (!slot.active) continue;
        if (slot.awaitingPresentation) {
          slot.unseenAge += dt;
          if (slot.unseenAge >= .5) slot.active = false;
        } else {
          slot.age = Math.min(slot.life, slot.age + dt);
          if (slot.age >= slot.life) slot.active = false;
        }
        sync(slot);
      }
    },
    presented() {
      for (const pool of pools.values()) for (const slot of pool.slots) {
        if (slot.active && slot.awaitingPresentation) { slot.awaitingPresentation = false; slot.age = 0; }
      }
    },
    clear,
    snapshot,
    diagnostics: snapshot,
    destroy() {
      if (destroyed) return;
      clear();
      for (const instance of ownedInstances) instance.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      for (const material of ownedMaterial) material.dispose();
      ownedGeometry.clear(); ownedMaterial.clear(); ownedInstances.clear(); pools.clear(); holder.clear();
      destroyed = true;
    },
  };
}
