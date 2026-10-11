// Hammer accents follow the head's real travel. The combo supplies its mass
// and cadence; it never supplies an extra damage volume or an invented hit.
const profiles = [
  { direction: [-.72,-.62,.32], impactLife: .20, flashLife: .055, coreScale: [.115,.080,.155],
    dustSpread: .70, dustDrive: 1.8, wakeLife: .090, wakeWidth: 1.50,
    airTone: 98, airDuration: .105, airVolume: .18, airFilter: 380,
    hitTone: 105, hitDuration: .14, hitFilter: 620, hitCrackTone: 174, cameraGain: 1.45, enemyStop: .030 },
  { direction: [.12,.86,.48], impactLife: .19, flashLife: .050, coreScale: [.090,.075,.170],
    dustSpread: .45, dustDrive: 2.7, wakeLife: .085, wakeWidth: 1.35,
    airTone: 110, airDuration: .085, airVolume: .16, airFilter: 420,
    hitTone: 118, hitDuration: .12, hitFilter: 720, hitCrackTone: 184, cameraGain: 1.30, enemyStop: .025 },
  { direction: [.96,.08,.26], impactLife: .22, flashLife: .065, coreScale: [.135,.090,.155],
    dustSpread: 1.05, dustDrive: 2.4, wakeLife: .105, wakeWidth: 1.65,
    airTone: 90, airDuration: .14, airVolume: .21, airFilter: 360,
    hitTone: 92, hitDuration: .16, hitFilter: 570, hitCrackTone: 168, cameraGain: 1.65, enemyStop: .036 },
  { direction: [.02,-.96,.28], impactLife: .24, flashLife: .075, coreScale: [.140,.100,.160],
    dustSpread: .90, dustDrive: 3.1, wakeLife: .115, wakeWidth: 1.80,
    airTone: 76, airDuration: .16, airVolume: .24, airFilter: 310,
    hitTone: 70, hitDuration: .19, hitFilter: 440, hitCrackTone: 138, cameraGain: 2.00, enemyStop: .050 },
].map(profile => Object.freeze({ ...profile,
  direction: Object.freeze(profile.direction), coreScale: Object.freeze(profile.coreScale) }));

export function getHammerFeedback(combo = 0) {
  return profiles[((Math.trunc(combo) % 4) + 4) % 4] ?? profiles[0];
}

export function hammerReactionDirection(headDirection, fallback = { x: 0, z: 1 }) {
  // An almost vertical smash uses the enemy's radial escape direction.
  const finite = value => Number.isFinite(value) ? value : 0;
  let x = finite(headDirection?.x), z = finite(headDirection?.z);
  if (x * x + z * z < .0025) { x = finite(fallback?.x); z = finite(fallback?.z); }
  const length = Math.hypot(x, z);
  return length > 1e-8 ? { x: x / length, y: 0, z: z / length } : { x: 0, y: 0, z: 1 };
}

export function hammerWakeActive(action, phase, headSpeed) {
  return !!action?.swing && Number.isFinite(headSpeed) && headSpeed >= 2.4
    && phase >= action.swing[0] && phase <= action.swing[1];
}

export function hammerContactAccent(hitstop, alreadyAccented = false) {
  return alreadyAccented || !Number.isFinite(hitstop) ? 0 : Math.max(0, Math.min(.065, hitstop));
}
