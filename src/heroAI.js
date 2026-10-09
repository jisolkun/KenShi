// Input and targeting decisions stay separate from animation and damage. These
// rules approximate the original tap-to-chase / nearby automatic slash controls.
export function isCombatTarget(enemy, enemies) {
  return !!enemy && enemy.state !== 'dead' && enemy.state !== 'spawn' &&
    (enemy.hp === undefined || enemy.hp > 0) &&
    Number.isFinite(enemy.pos?.x) && Number.isFinite(enemy.pos?.z) &&
    (!enemies || enemies.includes(enemy));
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
  return weaponId === 'great-dao' ? 1 : combo === 3 ? .96 : .9;
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
