// Original choreography for this browser prototype. The verified reference
// supports charge-through attacks and short skill poses, not exact frame data.
// Durations are seconds; all other timeline markers are normalized progress.
const profile = (name, duration, anticipation, contact, follow, recovery, comboOpen, driveStart, driveEnd, trailStart, trailEnd, extra = {}) =>
  Object.freeze({ name, duration, anticipation, contact, follow, recovery, comboOpen, driveStart, driveEnd, trailStart, trailEnd, ...extra });

export const COMBO_CLIPS = Object.freeze([
  profile('drawing-cut', .36, .22, .36, .50, .64, .72, .18, .48, .22, .56),
  profile('return-cut', .38, .18, .32, .47, .62, .70, .16, .46, .18, .54),
  profile('descending-cut', .52, .32, .43, .56, .70, .84, .27, .53, .32, .63),
]);
export const ACTION_CLIPS = Object.freeze({
  attack: COMBO_CLIPS[0],
  heavy: profile('execution-cleave', .74, .39, .51, .60, .72, .91, .31, .58, .39, .68),
  roll: profile('shoulder-vault', .44, .12, .30, .72, .82, .94, .06, .84, 0, 0),
  dash: profile('passing-draw', .42, .14, .29, .58, .73, .91, .13, .70, .14, .73),
  whirl: profile('cross-step-whirl', .84, .14, .27, .73, .85, .95, .14, .78, .16, .79, { contacts: Object.freeze([.27, .53, .72]) }),
  burst: profile('vault-crash', .98, .48, .58, .66, .78, .95, .23, .56, .39, .72),
  frost: profile('ice-seal', .58, .23, .36, .48, .65, .90, .19, .39, 0, 0),
  blades: profile('fan-release', .50, .17, .29, .43, .61, .89, .14, .35, .18, .46),
  finisher: profile('vanishing-cut', .70, .33, .41, .56, .76, .96, .22, .48, .23, .64),
});
export const ENEMY_CLIPS = Object.freeze({
  soldier: Object.freeze({ anticipation: .83, contact: 1, follow: .18, recovery: .36 }),
  brute: Object.freeze({ anticipation: .87, contact: 1, follow: .24, recovery: .46 }),
  boss: Object.freeze({ anticipation: .84, contact: 1, follow: .25, recovery: .48 }),
  archer: Object.freeze({ anticipation: .82, contact: 1, follow: .12, recovery: .28 }),
});
export function getActionClip(type, step = 0) {
  return type === 'attack' ? COMBO_CLIPS[((step % 3) + 3) % 3] : ACTION_CLIPS[type] || ACTION_CLIPS.attack;
}
