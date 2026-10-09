// Attack travel changes the character's world position. It is separate from
// the waist/hand offsets in the authored pose and never returns on recovery.
export const GREAT_DAO_STEPS = [
  { forward: .52, lateral: .18 },
  { forward: .50, lateral: -.22 },
  { forward: .60, lateral: .28 },
  { forward: .72, lateral: -.10 },
];
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function greatDaoStepProgress(phase) {
  if (phase <= .06) return 0;
  if (phase < .24) return .12 * smooth((phase - .06) / .18);
  if (phase < .55) return .12 + .76 * smooth((phase - .24) / .31);
  return .88 + .12 * smooth((phase - .55) / .21);
}

export function greatDaoStepDelta(combo, previousPhase, phase) {
  const step = GREAT_DAO_STEPS[((combo % 4) + 4) % 4];
  const distance = Math.max(0, greatDaoStepProgress(phase) - greatDaoStepProgress(previousPhase));
  return { forward: step.forward * distance, lateral: step.lateral * distance };
}

export function greatDaoTargetGap(radius = .45) {
  return Math.max(1.18, .5 + radius + .14);
}

// Clip the entire segment, not just its endpoint. Projecting an endpoint out
// of a lamp can otherwise put a fast step on the other side of the lamp.
export function resolveGreatDaoStep(start, displacement, { obstacles = [], bounds = null,
  targets = [], clearance = .5 } = {}) {
  const { x: dx, z: dz } = displacement;
  const square = dx * dx + dz * dz;
  if (square < 1e-14) return { x: start.x, z: start.z };
  let fraction = 1;
  if (bounds) {
    for (const [position, delta, low, high] of [
      [start.x, dx, bounds.minX + clearance, bounds.maxX - clearance],
      [start.z, dz, bounds.minZ + clearance, bounds.maxZ - clearance],
    ]) {
      if (delta > 0) fraction = Math.min(fraction, Math.max(0, (high - position) / delta));
      if (delta < 0) fraction = Math.min(fraction, Math.max(0, (low - position) / delta));
    }
  }
  for (const circle of [...obstacles.map(prop => ({ ...prop, gap: prop.radius + clearance })),
    ...targets.map(target => ({ ...target, gap: greatDaoTargetGap(target.radius) }))]) {
    const x = start.x - circle.x, z = start.z - circle.z;
    const b = x * dx + z * dz;
    const c = x * x + z * z - circle.gap * circle.gap;
    // An enemy can approach an already planted hero. Allow a step away from
    // that overlap, but never use the overlap to cut through its centre.
    if (c <= 1e-9) {
      if (b < -1e-10) fraction = 0;
      continue;
    }
    const discriminant = b * b - square * c;
    if (b >= 0 || discriminant < 0) continue;
    const contact = (-b - Math.sqrt(discriminant)) / square;
    if (contact >= 0 && contact <= fraction) fraction = Math.max(0, contact - 1e-6);
  }
  return { x: start.x + dx * clamp(fraction), z: start.z + dz * clamp(fraction) };
}
