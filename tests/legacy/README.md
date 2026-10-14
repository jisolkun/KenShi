# Historical procedural motion tests

These files preserve tests for the superseded procedural hero rig. They describe
four authored attacks, independent travelling leg IK, fixed world foot anchors,
two handed great dao grips and generic cone/radial attack shapes. Those are no
longer the hero's animation or collision contracts after the original animation
clips and original slash colliders were restored.

The active suite is `node --test tests/*.test.js`. This folder is deliberately
outside that glob; these historical tests are documentation, not an alternative
passing test target for the current runtime. Their assertions have been retained
and only relative source imports were adjusted for this directory.

Entire historical suites moved here: `characters.test.js`,
`great-dao-footwork.test.js`, `great-dao.test.js`,
`reviewed-motion.test.js`, and `tang-wide-combat.test.js`.

The original versions of `weapons.test.js`, `weapon-combat.test.js`, and
`tang-hand-clearance.test.js` are also preserved here; their active replacements
retain catalogue, collider and rendered hand/forearm geometry coverage.

Replacement coverage lives in:

- `source-motion-rig.test.js`: exact original blade/dual bone rotations, five
  whole body attacks, walking/running motion, source transition clocks, pause
  and state changes.
- `source-motion-clock.test.js`: native clip durations, queued recovery,
  locomotion clocks, blend advancement and the fifth ordinary attack.
- `source-motion-combat.test.js` and `weapon-combat.test.js`: original slash
  atlas contact frames, world oriented effect volumes and separate dual emitters.
- `weapons.test.js`: the active three weapon catalogue, all fifteen source moves,
  actual grip mapping, equip lifecycle and finite transforms.
- `hero-ai.test.js`: target selection, navigation, contact range and combo
  completion using the current source collision rules.
- `world-combat.test.js`: blade/prop sweep, effect pooling and pause invariants.
- `tang-hand-clearance.test.js`: rendered blade hands and forearms remain clear
  through source attacks and state transitions.

Generic physical blade collision, obstacle motion constraints, control,
audio, prop damage and particle pooling tests remain active in
the parent directory.
