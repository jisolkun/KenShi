import { Euler, Quaternion, Vector3 } from 'three';

// Cha_Control.AttackOn and Ef_swing1/Ef_splash from the supplied source.
// Hammer has no original family; it uses the source's heavy two-handed polearm.
export const SOURCE_ATTACK_WORLD_SCALE = 12.5;
const families = Object.freeze({ 'dual-dao': 'dual', 'tang-dao': 'blade', 'great-dao': 'blade', 'great-hammer': 'halberd' });
const f = Math.fround;
const DEG = Math.PI / 180;

function swing(emitter, delay, position, rotation, scale, addForce = 0) {
  return { type: emitter === 'thrust' ? 'thrust' : 'swing', emitter, delay, position, rotation,
    rotationOrder: 'YXZ', scale, layer: emitter === 'thrust' ? 28 : ['swing1', 'swing2'].includes(emitter) ? 20 : 21,
    collider: emitter === 'thrust'
      ? { type: 'capsule', radius: .01, height: .30, direction: 2, center: [0, 0, .07] }
      : ['swing1', 'swing2'].includes(emitter)
        ? { type: 'sphere', radius: .08, center: [0, 0, .04] }
        : { type: 'sphere', radius: .11, center: [-.012, .03, .01] },
    tiles: emitter === 'thrust' ? [4, 1] : [2, 2], fps: 20, impactFrame: 1,
    addForce, duration: .2, collisionDuration: .1, originMode: 'root' };
}

function splash(delay = 0, distance = .1) {
  return { type: 'splash', emitter: 'splash', delay, position: [0, .02, distance], rotation: [0, 0, 0],
    rotationOrder: 'YXZ', scale: [1.6, 1.6, 1.6], collider: { type: 'sphere', radius: .12, center: [0, 0, 0] },
    layer: 21, tiles: [1, 1], fps: 0, impactFrame: 0, addForce: 0, duration: 1.5,
    collisionDuration: .2, originMode: 'snapshot' };
}

export function getSourceAttackRule(weaponId, combo, atkspd = 0) {
  const family = families[weaponId] ?? weaponId;
  if (!['blade', 'dual', 'halberd'].includes(family)) return null;
  const index = ((Math.floor(combo) % 5) + 5) % 5;
  let rule;
  if (family === 'dual') {
    const rows = [
      [120, false, [.15, [0, .06, 0], [0, 0, 180], 0], [.4, [0, .08, 0], [0, 0, -40], 100]],
      [120, false, [.2, [0, .06, 0], [0, 0, 340], 0], [.4, [0, .06, 0], [0, 0, 10], 100]],
      [0, true, [.15, [0, .14, 0], [0, 0, 90], 140], [.31, [0, .16, 0], [0, 0, 90], 80]],
      [150, false, [.11, [0, .06, 0], [-20, 0, -90], 0], null],
      [0, true, [.4, [-.07, .06, 0], [0, 0, 170], 180], [.4, [.07, .055, 0], [0, 0, 10], 0]],
    ];
    const [startForce, rising, main, sub] = rows[index];
    const volume = (emitter, [delay, position, rotation, force]) => swing(emitter, delay, position, rotation, [1.3, 1.7, 1.7], force);
    rule = { startForce, rising, volumes: [volume('swing1', main), ...(sub ? [volume('swing2', sub)] : [])] };
  } else if (family === 'blade') {
    const rows = [[110, false, .15, .055, 180, 0], [110, true, .15, .12, 40, 0],
      [110, false, .2, .1, 330, 0], [30, false, .28, .05, 0, 100], [0, true, .21, .055, 0, 150]];
    const [startForce, rising, delay, y, rotation, force] = rows[index];
    rule = { startForce, rising, volumes: [index === 3
      ? swing('thrust', delay, [0, .05, .08], [0, 0, 0], [.4, 1, 2], force)
      : swing('swing1', delay, [0, y, 0], [0, 0, rotation], [1.6, 2, 2], force)] };
  } else {
    const rows = [[160, true, .15, .06, 0, 0], [130, true, .42, .1, -90, 0],
      [90, false, .5, .1, 180, 90], [0, true, .36, .1, 160, 120], [0, true, .4, .1, -20, 200]];
    const [startForce, rising, delay, y, rotation, force] = rows[index];
    const volumes = [swing(index === 3 ? 'swingex1' : 'swing1', delay, [0, y, 0], [0, 0, rotation],
      index === 3 ? [2.4, 2.4, 2.4] : [2, 2.6, 2.6], force)];
    if (index === 1) volumes.push(splash(.5));
    rule = { startForce, rising, volumes };
  }
  // A new hammer slam uses the original splash emitter and native clocks.
  if(weaponId==='great-hammer'&&index===3)rule.volumes.push(splash(rule.volumes[0].delay+.05));
  // The original adjusts every ordinary descriptor, including polearm splash.
  for (const descriptor of rule.volumes) descriptor.delay = Math.max(0, descriptor.delay - atkspd);
  return { ...rule, family, combo: index };
}

export function createSourceSwingClock(descriptor) {
  return { delay: f(descriptor.delay ?? 0), elapsed: 0, frame: 0, oldFrame: -1,
    frames: (descriptor.tiles?.[0] ?? 2) * (descriptor.tiles?.[1] ?? 2), fps: f(descriptor.fps ?? 20),
    impactFrame: descriptor.impactFrame ?? 1, efon: true, visible: false, colliding: false,
    finished: false, particleOn: false, justStarted: false, justImpact: false };
}

export function stepSourceSwingClock(clock, deltaTime) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Nonnegative finite display delta required');
  clock.justStarted = clock.justImpact = false;
  if (clock.finished) return clock;
  const dt = f(deltaTime);
  if (clock.efon) {
    if (clock.delay > 0) clock.delay = f(clock.delay - dt);
    else { clock.visible = true; clock.elapsed = 0; clock.efon = false; clock.justStarted = true; }
  }
  if (!clock.visible) return clock;
  clock.elapsed = f(clock.elapsed + dt);
  clock.frame = Math.trunc(f(clock.elapsed * clock.fps));
  if (clock.frame !== clock.oldFrame) {
    if (clock.frame >= clock.frames) {
      clock.visible = false; clock.colliding = false; clock.particleOn = false; clock.finished = true;
    } else if (clock.frame === clock.impactFrame || clock.frame === clock.impactFrame + 1) {
      clock.colliding = true;
      if (!clock.particleOn) { clock.justImpact = true; clock.particleOn = true; }
    } else clock.colliding = false;
    clock.oldFrame = clock.frame;
  }
  return clock;
}

function createSplashClock() {
  return { kind: 'splash', pending: true, showtime: f(1.5), elapsed: 0, frame: 0, visible: false,
    colliding: false, finished: false, tint: 1, fireFrame: 0, fireVisible: false, justStarted: false };
}

function stepSplashClock(clock, deltaTime) {
  if (clock.pending || clock.finished) return clock;
  const dt = f(deltaTime);
  clock.justStarted = false;
  clock.showtime = f(clock.showtime - dt); clock.elapsed = f(clock.elapsed + dt);
  if (clock.fireVisible) { clock.fireFrame = Math.trunc(f(clock.elapsed * 18)); if (clock.fireFrame >= 16) clock.fireVisible = false; }
  if (clock.showtime > f(1.3)) return clock;
  clock.colliding = false;
  if (clock.showtime > f(.5)) return clock;
  if (clock.showtime > 0) {
    const amount = Math.min(1, Math.max(0, f(dt * 14)));
    clock.tint = f(clock.tint + f(f(-clock.tint) * amount));
  } else { clock.visible = false; clock.fireVisible = false; clock.finished = true; }
  return clock;
}

export function createSourceAttackVolumes(weaponId, combo, atkspd = 0) {
  const rule = getSourceAttackRule(weaponId, combo, atkspd);
  return (rule?.volumes ?? []).map(descriptor => ({ descriptor,
    clock: descriptor.type === 'splash' ? createSplashClock() : createSourceSwingClock(descriptor),
    age: 0, inside: new Set(), hitTargets: new Set(), cancelled: false, started: false,
    rising: rule.rising, origin: null, facing: null }));
}

function positionOf(entity) {
  if (entity?.isObject3D) return entity.getWorldPosition(new Vector3());
  const p = entity?.pos ?? entity?.position ?? entity ?? {};
  return new Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0);
}
function facingOf(entity) {
  if (Number.isFinite(entity?.facing)) return entity.facing;
  if (Number.isFinite(entity?.angle)) return entity.angle;
  if (entity?.isObject3D) {
    const forward = new Vector3(0, 0, 1).applyQuaternion(entity.getWorldQuaternion(new Quaternion()));
    return Math.atan2(forward.x, forward.z);
  }
  return 0;
}

export function advanceSourceAttackVolumes(volumes, deltaTime, root) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Nonnegative finite display delta required');
  const onsets = [], active = [], impacts = [];
  for (const volume of volumes) {
    if (volume.cancelled || volume.clock.finished) continue;
    const { descriptor, clock } = volume;
    volume.age += deltaTime;
    let showedSplash = false;
    if (clock.kind === 'splash') {
      if (clock.pending && volume.age >= descriptor.delay - 1e-10) {
        clock.pending = false; clock.visible = clock.colliding = clock.fireVisible = true;
        showedSplash = true;
      }
      stepSplashClock(clock, deltaTime);
      clock.justStarted = showedSplash;
    } else stepSourceSwingClock(clock, deltaTime);
    if (clock.justStarted && !volume.started) {
      volume.started = true;
      if (descriptor.originMode === 'snapshot') {
        const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facingOf(root));
        volume.origin = new Vector3().fromArray(descriptor.position).multiplyScalar(SOURCE_ATTACK_WORLD_SCALE).applyQuaternion(yaw).add(positionOf(root));
        volume.facing = facingOf(root);
      }
      onsets.push({ volume, descriptor, addForce: descriptor.addForce });
    }
    if (clock.justImpact) impacts.push(volume);
    if (clock.visible && clock.colliding) active.push(volume);
    else volume.inside.clear();
  }
  return { onsets, active, impacts, finished: volumes.every(volume => volume.cancelled || volume.clock.finished) };
}

export function sourceVolumeGeometry(descriptor, attacker, options = {}) {
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), options.facing ?? facingOf(attacker));
  const rotation = descriptor.quaternion ? new Quaternion().fromArray(descriptor.quaternion).normalize()
    : new Quaternion().setFromEuler(new Euler(...(descriptor.rotation ?? [0, 0, 0]).map(value => value * DEG), descriptor.rotationOrder ?? 'YXZ'));
  const rootScale = options.rootScale ?? attacker?.sourceRootScale ?? 1;
  const scale = new Vector3().fromArray(descriptor.scale ?? [1, 1, 1]).multiplyScalar(rootScale * SOURCE_ATTACK_WORLD_SCALE);
  const origin = options.origin ? positionOf(options.origin)
    : new Vector3().fromArray(descriptor.position).multiplyScalar(rootScale * SOURCE_ATTACK_WORLD_SCALE).applyQuaternion(yaw).add(positionOf(attacker));
  const collider = descriptor.collider;
  const center = new Vector3().fromArray(collider.center).multiply(scale).applyQuaternion(rotation).applyQuaternion(yaw).add(origin);
  if (collider.type !== 'capsule') return { type: 'sphere', center, origin,
    radius: collider.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) };
  const axis = collider.direction ?? collider.axis ?? 1;
  const sizes = [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)];
  const radius = collider.radius * Math.max(...sizes.filter((_, index) => index !== axis));
  const halfSegment = Math.max(0, collider.height * sizes[axis] / 2 - radius);
  const direction = new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0).applyQuaternion(rotation).applyQuaternion(yaw);
  return { type: 'capsule', center, origin, radius,
    start: center.clone().addScaledVector(direction, -halfSegment), end: center.clone().addScaledVector(direction, halfSegment) };
}

// Source enemy collider records are absent from this project's enemy rig.
// Use its actual body sphere while retaining the original 3D emitter volume.
export function sourceVolumeContains(volume, target, attacker, options = {}) {
  const descriptor = volume.descriptor ?? volume;
  const geometry = sourceVolumeGeometry(descriptor, attacker, {
    origin: volume.origin ?? options.origin, facing: volume.facing ?? options.facing, ...options });
  const center = positionOf(target).add(new Vector3(0, target.colliderHeight ?? target.height ?? .9, 0));
  const radius = target.colliderRadius ?? target.radius ?? .45;
  let nearest = geometry.center;
  if (geometry.type === 'capsule') {
    const axis = geometry.end.clone().sub(geometry.start), lengthSq = axis.lengthSq();
    const t = lengthSq ? Math.max(0, Math.min(1, center.clone().sub(geometry.start).dot(axis) / lengthSq)) : 0;
    nearest = geometry.start.clone().addScaledVector(axis, t);
  }
  return nearest.distanceToSquared(center) <= (geometry.radius + radius) ** 2 + 1e-10;
}

// Source Rigidbody mass 2, drag 5 and fixed delta .02. Matches its damped
// per-tick travel; callers subtract consecutive samples to obtain each step.
export function sourceForceTravel(force, time, mass = 2, drag = 5) {
  if (time <= 0) return 0;
  const step = .02, damping = Math.max(0, 1 - drag * step);
  const ticks = Math.floor(time / step + 1e-10), remainder = Math.max(0, time - ticks * step);
  const velocity = force / mass * step * SOURCE_ATTACK_WORLD_SCALE;
  if (damping === 1) return velocity * time;
  return velocity * step * damping * (1 - damping ** ticks) / (1 - damping)
    + velocity * damping ** (ticks + 1) * remainder;
}
