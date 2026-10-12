// Cha_Control's ordinary player decisions, adapted to this project's four
// authored attacks. Geometry, damage and authored weapon steps stay with the
// current combat system; source input distances remain in its world units.
export const SOURCE_HERO_RULES = Object.freeze({
  closeDistance: .625,
  farDistance: 1,
  initialFactor: 7,
  inputFactor: 6.5,
  attackFactor: 5.2,
  decay: 2,
  runThreshold: 4.5,
  stopThreshold: .2,
  worldScale: 12.5,
  turnRate: 8,
  comboDecay: 2,
});

export function createHeroControl({ comboCount = 4 } = {}) {
  if (!Number.isInteger(comboCount) || comboCount < 1)
    throw new RangeError('comboCount must be a positive integer');
  return {
    direction: { x: 0, z: 0 },
    speedFactor: SOURCE_HERO_RULES.initialFactor,
    comboCount,
    cursor: 0,
    comboTime: 1,
    sensorEnabled: true,
    sensorInside: new Set(),
    locomotion: 'idle',
  };
}

export function resetHeroControl(control, { comboCount = control.comboCount } = {}) {
  Object.assign(control, createHeroControl({ comboCount }));
  return control;
}

// A weapon change resets only the shared attack cursor. It preserves the
// signed combo clock, just as ChangeCharacter does in the reference source.
export function resetHeroAttackFamily(control) {
  control.cursor = 0;
}

export function sampleHeroMovement(control, position, point) {
  if (!point) return;
  const dx = point.x - position.x, dz = point.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < SOURCE_HERO_RULES.closeDistance) {
    control.direction = { x: 0, z: 0 };
  } else if (distance > SOURCE_HERO_RULES.farDistance) {
    control.direction = { x: dx / distance, z: dz / distance };
    control.speedFactor = SOURCE_HERO_RULES.inputFactor;
  }
  // Both boundaries belong to the band that retains direction and factor.
}

export function disableHeroSensor(control) {
  control.sensorEnabled = false;
  control.sensorInside.clear();
  // An attack/reaction or rejected AttackOn owns the control state now. A
  // later run/walk observation must enter its state again, even if it was
  // the locomotion used before the interruption.
  control.locomotion = 'disabled';
}

export function setHeroLocomotion(control, action) {
  if ((action === 'run' || action === 'walk') && control.locomotion !== action) {
    control.sensorEnabled = true;
    control.sensorInside.clear();
  }
  control.locomotion = action;
}

export function stepHeroMovement(control, angle, dt, maxSpeed) {
  const direction = control.direction;
  if (!direction.x && !direction.z) {
    setHeroLocomotion(control, 'idle');
    return { direction, speed: 0, distance: 0, angle, action: 'idle' };
  }

  let action, speed;
  if (control.speedFactor > SOURCE_HERO_RULES.runThreshold) {
    control.speedFactor -= SOURCE_HERO_RULES.decay * dt;
    action = 'run';
    speed = maxSpeed;
  } else if (control.speedFactor > SOURCE_HERO_RULES.stopThreshold) {
    // The source subtracts first, then uses the new factor for walk speed.
    control.speedFactor -= SOURCE_HERO_RULES.decay * dt;
    action = 'walk';
    speed = control.speedFactor / 12 * SOURCE_HERO_RULES.worldScale;
  } else {
    control.direction = { x: 0, z: 0 };
    action = control.locomotion === 'walk' ? 'walk' : 'idle';
    setHeroLocomotion(control, action);
    return { direction: control.direction, speed: 0, distance: 0, angle, action };
  }

  const target = Math.atan2(direction.x, direction.z);
  const delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
  const mix = Math.min(1, SOURCE_HERO_RULES.turnRate * dt);
  // Normalized Quaternion.Lerp for a yaw rotation, including the shortest
  // turn across +/- PI. A scalar/exponential angle lerp has different timing.
  angle += 2 * Math.atan2(mix * Math.sin(delta / 2),
    1 - mix + mix * Math.cos(delta / 2));
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  setHeroLocomotion(control, action);
  return { direction, speed, distance: speed * dt, angle, action };
}

export function selectHeroAttack(control) {
  control.cursor = control.comboTime > 0
    ? (control.cursor + 1) % control.comboCount : 0;
  disableHeroSensor(control);
  control.speedFactor = SOURCE_HERO_RULES.attackFactor;
  return control.cursor;
}

// Call after the selected victim's facing has been captured by beginAttack.
// Selection does not change input direction before its direction gate runs.
export function startHeroAttack(control, index, angle) {
  control.cursor = ((index % control.comboCount) + control.comboCount) % control.comboCount;
  control.direction = { x: Math.sin(angle), z: Math.cos(angle) };
  control.speedFactor = SOURCE_HERO_RULES.attackFactor;
  disableHeroSensor(control);
}

export function stepHeroCombo(control, dt, {
  attacking = false, combo = control.cursor, recovering = false,
} = {}) {
  // The final source attack never refreshes combotime. Recovery belongs to
  // its layer0 movement state, so it consumes the same half-second window.
  if (attacking && !recovering && combo !== control.comboCount - 1)
    control.comboTime = 1;
  if (!attacking || recovering)
    control.comboTime = Math.fround(control.comboTime -
      Math.fround(SOURCE_HERO_RULES.comboDecay * Math.fround(dt)));
  return control.comboTime;
}

export function clearHeroCombo(control) {
  control.comboTime = 0;
}
