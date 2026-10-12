// Input and targeting decisions stay separate from animation and damage. The
// player-specific rules below mirror the reference ground input and trigger.
export function isCombatTarget(enemy, enemies) {
  return !!enemy && enemy.state !== 'dead' && enemy.state !== 'spawn' &&
    (enemy.hp === undefined || enemy.hp > 0) &&
    Number.isFinite(enemy.pos?.x) && Number.isFinite(enemy.pos?.z) &&
    (!enemies || enemies.includes(enemy));
}

// The reference project does not pick a player target from a threat score.
// Cha_Control exposes a small forward trigger (mycollider) and starts an
// attack only when an enemy enters that volume.  These values are converted
// from the source units (12.5 units per world unit) so the current scene can
// use the same front-loaded trigger instead of a radial nearest-enemy query.
// The reference map spans roughly twice the width of this scene (source
// bounds are ±2.65*12.5, while this scene is ±17), so preserve the source
// proportions while converting the trigger into current world units.
const REFERENCE_SCENE_SCALE = .5;
// Direction gates use the uploaded controller's world distances, like its
// .625/1.0 input band. Scaling this gate with the sensor mesh would reject a
// stationary player's ordinary 1.55-unit melee contact in this scene.
const REFERENCE_DIRECTION_DISTANCE = 2.5;
export const REFERENCE_ATTACK_SENSOR_RULES = Object.freeze({
  default: { radius: .13 * 12.5 * REFERENCE_SCENE_SCALE, forward: .17 * 12.5 * REFERENCE_SCENE_SCALE },
  dual: { radius: .13 * 12.5 * REFERENCE_SCENE_SCALE, forward: .16 * 12.5 * REFERENCE_SCENE_SCALE },
  spear: { radius: .15 * 12.5 * REFERENCE_SCENE_SCALE, forward: .20 * 12.5 * REFERENCE_SCENE_SCALE },
  staff: { radius: .15 * 12.5 * REFERENCE_SCENE_SCALE, forward: .20 * 12.5 * REFERENCE_SCENE_SCALE },
  ranged: { radius: .15 * 12.5 * REFERENCE_SCENE_SCALE, forward: .25 * 12.5 * REFERENCE_SCENE_SCALE },
  runReady: { radius: .20 * 12.5 * REFERENCE_SCENE_SCALE, forward: .22 * 12.5 * REFERENCE_SCENE_SCALE },
});

function referenceWeaponFamily(weaponId = '') {
  if (weaponId === 'dual-dao' || weaponId === 'dual') return 'dual';
  if (['spear', 'halberd', 'staff'].includes(weaponId)) return weaponId;
  if (['bow', 'crossbow', 'orb', 'magic'].includes(weaponId)) return 'ranged';
  return 'default';
}

/**
 * Return the source-style forward sensor contents and the first newly entered
 * enemy. `previousInside` is intentionally stateful: the source uses
 * OnTriggerEnter, so an enemy that remains in the volume must not retrigger a
 * new attack every frame.
 */
export function referenceAttackSensorTargets({ position, angle = 0, enemies = [],
  weaponId = 'dual-dao', runReady = false, previousInside = new Set() }) {
  const family = referenceWeaponFamily(weaponId);
  const rule = runReady ? REFERENCE_ATTACK_SENSOR_RULES.runReady
    : REFERENCE_ATTACK_SENSOR_RULES[family] || REFERENCE_ATTACK_SENSOR_RULES.default;
  const forward = { x: Math.sin(angle), z: Math.cos(angle) };
  const center = { x: position.x + forward.x * rule.forward,
    z: position.z + forward.z * rule.forward };
  const near = enemies.filter(enemy => isCombatTarget(enemy, enemies)).filter(enemy => {
    const radius = Math.max(0, Number(enemy.radius) || 0);
    return Math.hypot(enemy.pos.x - center.x, enemy.pos.z - center.z) <=
      rule.radius + radius + 1e-6;
  }).sort((a, b) => {
    const da = Math.hypot(a.pos.x - position.x, a.pos.z - position.z);
    const db = Math.hypot(b.pos.x - position.x, b.pos.z - position.z);
    return da - db || (a.id ?? 0) - (b.id ?? 0);
  });
  const inside = new Set(near.map(enemy => enemy.id));
  const entered = near.find(enemy => !previousInside.has(enemy.id)) || null;
  return { center, radius: rule.radius, near, inside, entered };
}

/** Match Cha_Control.AttackOn's movement-direction gate. */
export function sourceAttackDirectionAllowed({ position, target, moveDirection = null }) {
  if (!position || !target?.pos) return false;
  const dx = target.pos.x - position.x, dz = target.pos.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return true;
  const direction = { x: dx / distance, z: dz / distance };
  const movement = moveDirection || { x: 0, z: 0 };
  const dot = direction.x * (movement.x || 0) + direction.z * (movement.z || 0);
  return dot >= (distance > REFERENCE_DIRECTION_DISTANCE ? .5 : -.2);
}

export function attackDistances(move, radius = .45, reviewed = false) {
  // Leave the victim inside the physical blade path, rather than using the
  // weapon's full advertised reach as the distance at which to stop running.
  const stop = Math.max(.7, reviewed
    ? move.reach * .8 + radius * .35
    : move.reach + radius - .38);
  return { stop, enter: stop + .08, retain: stop + .16 };
}

export function segmentClear(start, end, obstacles = [], clearance = 0) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  return obstacles.every(obstacle => {
    const t = lengthSquared ? Math.max(0, Math.min(1,
      ((obstacle.x - start.x) * dx + (obstacle.z - start.z) * dz) / lengthSquared)) : 0;
    return Math.hypot(start.x + dx * t - obstacle.x,
      start.z + dz * t - obstacle.z) >= obstacle.radius + clearance - 1e-6;
  });
}

// Resolve the map boundary and prop clearance together. Pushing a character
// out of a prop after clamping to the map can otherwise put it outside the map.
export function projectWalkablePoint(point, obstacles = [], clearance = .5, bounds = null) {
  const limits = bounds && { minX: bounds.minX + clearance, maxX: bounds.maxX - clearance,
    minZ: bounds.minZ + clearance, maxZ: bounds.maxZ - clearance };
  const clamp = p => limits ? {
    x: Math.max(limits.minX, Math.min(limits.maxX, p.x)),
    z: Math.max(limits.minZ, Math.min(limits.maxZ, p.z)),
  } : { x: p.x, z: p.z };
  const requested = clamp(point);
  const valid = p => (!limits || p.x >= limits.minX && p.x <= limits.maxX &&
    p.z >= limits.minZ && p.z <= limits.maxZ) && segmentClear(p, p, obstacles, clearance);
  if (valid(requested)) return requested;
  const candidates = [];
  for (const obstacle of obstacles) {
    const radius = obstacle.radius + clearance + 1e-5;
    const angle = Math.atan2(requested.z - obstacle.z, requested.x - obstacle.x);
    candidates.push({ x: obstacle.x + Math.cos(angle) * radius,
      z: obstacle.z + Math.sin(angle) * radius });
    for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16;
      candidates.push(clamp({ x: obstacle.x + Math.cos(a) * radius,
        z: obstacle.z + Math.sin(a) * radius }));
    }
    if (limits) {
      for (const x of [limits.minX, limits.maxX]) {
        const square = radius * radius - (x - obstacle.x) ** 2;
        if (square >= 0) for (const sign of [-1, 1])
          candidates.push({ x, z: obstacle.z + sign * Math.sqrt(square) });
      }
      for (const z of [limits.minZ, limits.maxZ]) {
        const square = radius * radius - (z - obstacle.z) ** 2;
        if (square >= 0) for (const sign of [-1, 1])
          candidates.push({ x: obstacle.x + sign * Math.sqrt(square), z });
      }
    }
  }
  if (limits) for (const x of [limits.minX, limits.maxX])
    for (const z of [limits.minZ, limits.maxZ]) candidates.push({ x, z });
  let best = requested, distance = Infinity;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - requested.x, candidate.z - requested.z);
    if (d < distance && valid(candidate)) { best = candidate; distance = d; }
  }
  return best;
}

export function chooseAttackTarget({ position, enemies, manualTarget = null,
  previousTarget = null, move, reviewed = false, moving = false,
  disengage = 0, cooldown = 0, obstacles = [] }) {
  if (moving || disengage > 0 || cooldown > 0) return null;
  const reachable = (enemy, continuing) => {
    if (!isCombatTarget(enemy, enemies)) return false;
    const range = attackDistances(move, enemy.radius, reviewed);
    return Math.hypot(enemy.pos.x - position.x, enemy.pos.z - position.z) <=
      (continuing ? range.retain : range.enter) && segmentClear(position, enemy.pos, obstacles);
  };
  // The selected enemy remains the pursuit command. Until it is in reach,
  // slash only reachable enemies directly along that route; an incidental
  // contact must never turn into a new chase off to either side.
  const pursuing = isCombatTarget(manualTarget, enemies);
  if (pursuing && reachable(manualTarget, manualTarget === previousTarget)) return manualTarget;
  const onRoute = enemy => {
    if (!pursuing) return true;
    const dx=manualTarget.pos.x-position.x, dz=manualTarget.pos.z-position.z;
    const length=Math.hypot(dx,dz);
    if (length < 1e-6) return false;
    const ex=enemy.pos.x-position.x, ez=enemy.pos.z-position.z;
    const along=(ex*dx+ez*dz)/length, side=Math.abs(ex*dz-ez*dx)/length;
    return along > 0 && along < length && along >= Math.hypot(ex,ez)*.7 &&
      side <= Math.max(.6,(enemy.radius??.45)+.3);
  };
  if (reachable(previousTarget, true) && onRoute(previousTarget)) return previousTarget;
  let best = null, distance = Infinity;
  for (const enemy of enemies) {
    if (!reachable(enemy, false) || !onRoute(enemy)) continue;
    const d = Math.hypot(enemy.pos.x - position.x, enemy.pos.z - position.z);
    if (d < distance) { best = enemy; distance = d; }
  }
  return best;
}

// Kept for enemy-AI experiments and compatibility with older callers.  The
// reference player never calls this scorer; its target comes from the forward
// attack sensor above.
export function choosePursuitTarget({ position, enemies, currentTarget = null,
  previousTarget = null, obstacles = [], maxDistance = Infinity }) {
  const valid = enemy => isCombatTarget(enemy, enemies) &&
    Number.isFinite(enemy.pos?.x) && Number.isFinite(enemy.pos?.z) &&
    Math.hypot(enemy.pos.x - position.x, enemy.pos.z - position.z) <= maxDistance;
  if (valid(currentTarget)) return currentTarget;
  let best = null, bestScore = Infinity;
  for (const enemy of enemies) {
    if (!valid(enemy)) continue;
    const dx = enemy.pos.x - position.x, dz = enemy.pos.z - position.z;
    const distance = Math.hypot(dx, dz);
    const clear = segmentClear(position, enemy.pos, obstacles, .5);
    // Archers are the most dangerous when left unattended; a low-health
    // target is a good finisher, while bosses remain a deliberate objective.
    const threat = enemy.type === 'archer' ? -3 : enemy.type === 'boss' ? .8 : 0;
    const health = Number.isFinite(enemy.maxHp) && enemy.maxHp > 0
      ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : .5;
    const finish = health < .35 ? -1.1 : 0;
    const blocked = clear ? 0 : 1.4;
    const continuity = enemy === previousTarget ? -.45 : 0;
    const score = distance * .8 + threat + finish + blocked + continuity;
    if (score < bestScore - 1e-6 ||
      Math.abs(score - bestScore) <= 1e-6 && (enemy.id ?? Infinity) < (best?.id ?? Infinity)) {
      best = enemy;
      bestScore = score;
    }
  }
  return best;
}

export function pursuitTargetPoint(target, leadTime = .18) {
  if (!target?.pos) return null;
  const point = { x: target.pos.x, z: target.pos.z };
  if (target.velocity && Number.isFinite(target.velocity.x) && Number.isFinite(target.velocity.z)) {
    point.x += Math.max(-.7, Math.min(.7, target.velocity.x * leadTime));
    point.z += Math.max(-.7, Math.min(.7, target.velocity.z * leadTime));
  }
  return point;
}

export function attackCanTrack(phase, move, reviewedAttack = null) {
  const windows = reviewedAttack?.contacts?.map(contact => contact.window) || [move.active];
  const first = Math.min(...windows.map(window => window[0]));
  const last = Math.max(...windows.map(window => window[1]));
  // Fix the root facing across all contacts of a stroke; turning between two
  // contacts would create an extra swept damage arc unrelated to the blade.
  return phase < first || phase > last;
}

export function attackRecoveryPhase(move, reviewedAttack = null) {
  if (Number.isFinite(move.recoverAt)) return move.recoverAt;
  return reviewedAttack ? Math.max(.66, move.active[1] + .08) : .66;
}

export function attackChainPhase(weaponId, combo) {
  return ['great-dao','great-hammer'].includes(weaponId) ? 1 : combo === 3 ? .96 : .9;
}

// A small visibility graph around circular props. The 16-sided perimeter is
// outside the collision circle, including its edges, so following the returned
// waypoints cannot put the hero against a pillar and keep pushing into it.
export function planObstaclePath(start, end, obstacles = [], clearance = .5, bounds = null, fullGraph = false) {
  if (segmentClear(start, end, obstacles, clearance)) return [{ x: end.x, z: end.z }];
  const valid = point => (!bounds || point.x >= bounds.minX + clearance &&
    point.x <= bounds.maxX - clearance && point.z >= bounds.minZ + clearance &&
    point.z <= bounds.maxZ - clearance) && segmentClear(point, point, obstacles, clearance);
  if (!valid(start) || !valid(end)) return [];
  const nodes = [{ x: start.x, z: start.z }, { x: end.x, z: end.z }];
  const dx = end.x - start.x, dz = end.z - start.z, lengthSquared = dx * dx + dz * dz;
  // Distant scenery cannot affect a short chase. Keep the usual graph local,
  // while testing every candidate edge against the complete collision world.
  const candidates = fullGraph ? obstacles : obstacles.filter(obstacle => {
    const t = lengthSquared ? Math.max(0, Math.min(1,
      ((obstacle.x - start.x) * dx + (obstacle.z - start.z) * dz) / lengthSquared)) : 0;
    return Math.hypot(start.x + t * dx - obstacle.x, start.z + t * dz - obstacle.z)
      <= obstacle.radius + clearance + 3;
  });
  for (const obstacle of candidates) {
    const radius = (obstacle.radius + clearance + .04) / Math.cos(Math.PI / 16);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const point = { x: obstacle.x + Math.cos(angle) * radius,
        z: obstacle.z + Math.sin(angle) * radius };
      if (valid(point)) nodes.push(point);
    }
  }
  const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1);
  const visited = new Set();
  distances[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (current === -1 || distances[i] < distances[current])) current = i;
    if (current === -1 || !Number.isFinite(distances[current])) break;
    if (current === 1) {
      const path = [];
      for (let node = 1; node !== 0; node = previous[node]) path.unshift(nodes[node]);
      return path;
    }
    visited.add(current);
    for (let i = 1; i < nodes.length; i++) {
      if (visited.has(i) || !segmentClear(nodes[current], nodes[i], obstacles, clearance)) continue;
      const next = distances[current] + Math.hypot(nodes[i].x - nodes[current].x, nodes[i].z - nodes[current].z);
      if (next < distances[i]) { distances[i] = next; previous[i] = current; }
    }
  }
  // A wide barrier can require leaving the local corridor entirely.
  return !fullGraph && candidates.length < obstacles.length
    ? planObstaclePath(start, end, obstacles, clearance, bounds, true) : [];
}
