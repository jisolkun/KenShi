# Original motion curves

These files are imported from the user's `src.rar`. The archive and relevant source files are identified by SHA-256 in `provenance.json`.

`data.js` exports the original hero profiles for `blade`, `dual` and `halberd`: idle, walk, run and all five ordinary attack/recovery pairs. Baked frame arrays are replaced with registration markers. Key times, positions, quaternion components, Hermite tangents, source skeleton, axis calibration, playback speed and clip boundaries retain the source values.

`sampler.js` exports `sampleReferenceCurveMotion(profile, phase)`, `sampleReferenceCurveBlend(samples, workspace)`, `createReferenceCurveBlendWorkspace()` and `hasReferenceCurveMotion(profile)`. Sample outputs contain calibrated world rotations, original target joint offsets and source weapon mount attachments. Locomotion blending sums raw Hermite quaternion components before normalizing, exactly as in the original evaluator. The caller retargets these poses to the current character rig.

Frame layout: hip position at `0`, sixteen world quaternions at `3`, five joint positions at `67`, weapon tip at `82`, weapon grip at `85`. The separate ten-number `attachments` buffer contains right mount position, left mount position and left weapon world quaternion. Buffer contents are reused by the sampler; copy values that must outlive the next sample of the same profile/workspace.

Regenerate with `node tools/import-source-motion.mjs /path/to/original/src /path/to/src.rar`.

Verify the port against the original evaluator with `node src/sourceMotion/verify.mjs /path/to/original/src`. This compares every profile across 1,001 phases, exact attack/recovery boundaries and three locomotion blend combinations. All sampled frame and attachment numbers must match exactly.
