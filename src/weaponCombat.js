// Collision uses the same move definition that drives the pose and visual path.
export function weaponStrikeContains(move, dx, dz, angle, radius = 0) {
  const distance = Math.hypot(dx, dz);
  if (distance > move.reach + radius) return false;
  const forwardX = Math.sin(angle), forwardZ = Math.cos(angle);
  const along = dx * forwardX + dz * forwardZ;
  const side = Math.abs(dx * forwardZ - dz * forwardX);
  if (move.shape === 'thrust') return along >= -radius * 0.3 && side <= move.width + radius * 0.7;
  if (move.shape === 'radial') return true;
  const dot = distance < 0.01 ? 1 : along / distance;
  const margin = Math.asin(Math.min(1, radius / Math.max(distance, 0.01)));
  if (dot < Math.cos(Math.min(Math.PI, move.halfAngle + margin))) return false;
  return move.shape !== 'crush' || side <= move.width + radius + 0.32;
}
