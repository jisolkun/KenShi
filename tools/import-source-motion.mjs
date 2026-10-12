// Import only the original hero locomotion and ordinary combo curves.
// Usage: node tools/import-source-motion.mjs /path/to/reference/src [/path/to/src.rar]
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../src/sourceMotion');
const source = resolve(process.argv[2] ?? '/workspace/reference-motion-src/src');
const archive = process.argv[3];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const families = ['blade', 'dual', 'halberd'];
const actions = ['idle', 'walk', 'run'];
const sourceFiles = [
  'reference-motion-data.js', 'reference-curve-data.js',
  'reference-curve-scale-data.js', 'reference-curve-hermite.js',
  'reference-curve-motion.js',
];
const [motion, curves, scales] = await Promise.all([
  import(pathToFileURL(join(source, sourceFiles[0]))),
  import(pathToFileURL(join(source, sourceFiles[1]))),
  import(pathToFileURL(join(source, sourceFiles[2]))),
]);

function profileOnly(profile) {
  return JSON.parse(JSON.stringify(profile, (key, value) => {
    // The evaluator uses these as registration/mount markers. Baked poses are
    // deliberately omitted: every imported pose is evaluated from source keys.
    if (key === 'frames' || key === 'dualWeaponFrames') return !!value;
    if (key === 'before' || key === 'after') return undefined;
    return value;
  }));
}

const attacks = {hero: {}};
const loops = {hero: {}};
const profiles = [];
for (const family of families) {
  attacks.hero[family] = motion.referenceWeaponAttackProfiles.hero[family].map(profileOnly);
  loops.hero[family] = Object.fromEntries(actions.map(action => [
    action, profileOnly(motion.referenceActionProfiles.hero[family][action]),
  ]));
  profiles.push(...attacks.hero[family], ...Object.values(loops.hero[family]));
}
const clipHashes = new Set();
for (const profile of profiles) {
  if (profile.segments) for (const segment of profile.segments) clipHashes.add(segment.sha256);
  else {
    clipHashes.add(profile.sha256);
    if (profile.recoveryRaw > 0) clipHashes.add(profile.recoverySha256);
  }
}

// Copy the original float bytes rather than reserializing values. This keeps
// every key time, raw quaternion component and tangent bit-for-bit intact.
function packTracks(originalTracks, originalBinary, originalClips, scalesOnly = false) {
  const bytes = Buffer.from(originalBinary, 'base64');
  const map = new Map();
  const tracks = [];
  const parts = [];
  let offset = 0;
  function importTrack(index) {
    if (map.has(index)) return map.get(index);
    const [components, count, start] = originalTracks[index];
    const size = count * (1 + 3 * components);
    const mapped = tracks.length;
    tracks.push([components, count, offset]);
    parts.push(bytes.subarray(start * 4, (start + size) * 4));
    offset += size;
    map.set(index, mapped);
    return mapped;
  }
  const importRows = rows => rows.map(([node, track]) => [node, importTrack(track)]);
  const clips = {};
  for (const hash of [...clipHashes].sort()) {
    const original = originalClips[hash];
    if (!original) throw new Error(`Missing source clip ${hash}`);
    clips[hash] = scalesOnly ? importRows(original) : {
      ...original,
      positions: importRows(original.positions),
      rotations: importRows(original.rotations),
    };
  }
  const packed = Buffer.concat(parts);
  return {tracks, clips, binary: packed.toString('base64'), numbers: offset,
    binaryBytes: packed.length, binarySha256: digest(packed)};
}

const curvePayload = packTracks(curves.referenceCurveTracks, curves.referenceCurveBinary, curves.referenceCurveClips);
const scalePayload = packTracks(scales.referenceScaleTracks, scales.referenceScaleBinary, scales.referenceScaleClips, true);
const curveMetadata = {...curves.referenceCurveMetadata, profiles: profiles.length,
  sourceClips: curves.referenceCurveMetadata.clips, clips: clipHashes.size,
  uniqueCurves: curvePayload.tracks.length, numbers: curvePayload.numbers,
  binaryBytes: curvePayload.binaryBytes, binarySha256: curvePayload.binarySha256};
const scaleMetadata = {...scales.referenceScaleMetadata,
  sourceClips: scales.referenceScaleMetadata.clips, clips: clipHashes.size,
  uniqueCurves: scalePayload.tracks.length, numbers: scalePayload.numbers,
  binaryBytes: scalePayload.binaryBytes, binarySha256: scalePayload.binarySha256,
  positionQuaternionTableSha256: curvePayload.binarySha256};

const provenance = {format: 1, source: 'User-provided src.rar',
  retained: {families, actions, ordinaryCombosPerFamily: 5, profiles: profiles.length,
    clips: clipHashes.size},
  sourceSha256: Object.fromEntries(await Promise.all(sourceFiles.map(async name => [
    name, digest(await readFile(join(source, name))),
  ])))};
if (archive) provenance.archiveSha256 = digest(await readFile(resolve(archive)));
const exported = (name, value) => `export const ${name} = ${JSON.stringify(value)};\n`;
const banner = '// Generated from the user-provided original source by tools/import-source-motion.mjs.\n';

await mkdir(destination, {recursive: true});
await writeFile(join(destination, 'data.js'), banner +
  exported('referenceMotionMetadata', motion.referenceMotionMetadata) +
  exported('referenceWeaponAttackProfiles', attacks) +
  exported('referenceActionProfiles', loops) +
  exported('referenceSkillProfiles', {}) + exported('referenceCastProfiles', {}) +
  'export const referenceAttackProfiles = {hero: referenceWeaponAttackProfiles.hero.blade};\n');
await writeFile(join(destination, 'curves.js'), banner +
  exported('referenceCurveMetadata', curveMetadata) +
  exported('referenceCurveNodes', curves.referenceCurveNodes) +
  exported('referenceCurveTracks', curvePayload.tracks) +
  exported('referenceCurveClips', curvePayload.clips) +
  exported('referenceCurveBinary', curvePayload.binary));
await writeFile(join(destination, 'scales.js'), banner +
  exported('referenceScaleMetadata', scaleMetadata) +
  exported('referenceScaleTracks', scalePayload.tracks) +
  exported('referenceScaleClips', scalePayload.clips) +
  exported('referenceScaleBinary', scalePayload.binary));
await writeFile(join(destination, 'hermite.js'), await readFile(join(source, 'reference-curve-hermite.js')));

let sampler = await readFile(join(source, 'reference-curve-motion.js'), 'utf8');
for (const [before, after] of [
  ['reference-curve-data.js', 'curves.js'], ['reference-curve-scale-data.js', 'scales.js'],
  ['reference-curve-hermite.js', 'hermite.js'], ['reference-motion-data.js', 'data.js'],
]) sampler = sampler.replaceAll(before, after);
// Layered special skills are outside this game's ordinary attack/locomotion
// import. The ordinary evaluator and source loop blend stay unmodified.
const layeredStart = sampler.indexOf('export function createReferenceCurveLayeredWorkspace');
const mappingStart = sampler.indexOf('function mapCurrentSourceToLowPoly');
if (layeredStart < 0 || mappingStart < layeredStart) throw new Error('Source evaluator layout changed');
sampler = sampler.slice(0, layeredStart) + sampler.slice(mappingStart);
await writeFile(join(destination, 'sampler.js'), banner + sampler);
await writeFile(join(destination, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({profiles: profiles.length, clips: clipHashes.size,
  curveBytes: curvePayload.binaryBytes, scaleBytes: scalePayload.binaryBytes}));
