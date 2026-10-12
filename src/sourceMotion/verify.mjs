// Numerical regression check against the user-provided original evaluator.
// Usage: node src/sourceMotion/verify.mjs /path/to/original/src
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import * as actualData from './data.js';
import * as actual from './sampler.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] ?? '/workspace/reference-motion-src/src');
const directory = await mkdtemp(join(tmpdir(), 'original-motion-check-'));
let profiles = 0, poses = 0, blends = 0, maxError = 0;
try {
  // Bare 'three' resolves through the installed game dependency. All original
  // source/data imports still point at the untouched extracted attachment.
  await symlink(join(project, 'node_modules'), join(directory, 'node_modules'), 'dir');
  let originalModule = await readFile(join(source, 'reference-curve-motion.js'), 'utf8');
  originalModule = originalModule.replace(/from '\.\/([^']+)'/g,
    (_, name) => `from '${pathToFileURL(join(source, name)).href}'`);
  const originalPath = join(directory, 'original.mjs');
  await writeFile(originalPath, originalModule);
  const original = await import(pathToFileURL(originalPath));
  const originalData = await import(pathToFileURL(join(source, 'reference-motion-data.js')));

  function compare(expected, received) {
    assert.equal(received === null, expected === null);
    if (expected === null) return;
    for (const key of ['frame', 'attachments']) {
      assert.equal(received[key].length, expected[key].length);
      for (let i = 0; i < expected[key].length; i++) {
        assert(Number.isFinite(received[key][i]));
        const error = Math.abs(received[key][i] - expected[key][i]);
        maxError = Math.max(maxError, error);
        assert.equal(error, 0, `${key}[${i}] differs: ${received[key][i]} / ${expected[key][i]}`);
      }
    }
  }

  for (const family of ['blade', 'dual', 'halberd']) {
    const expectedProfiles = [
      ...originalData.referenceWeaponAttackProfiles.hero[family],
      ...['idle', 'walk', 'run'].map(action => originalData.referenceActionProfiles.hero[family][action]),
    ];
    const receivedProfiles = [
      ...actualData.referenceWeaponAttackProfiles.hero[family],
      ...['idle', 'walk', 'run'].map(action => actualData.referenceActionProfiles.hero[family][action]),
    ];
    for (let i = 0; i < expectedProfiles.length; i++) {
      const expectedProfile = expectedProfiles[i], receivedProfile = receivedProfiles[i];
      assert(actual.hasReferenceCurveMotion(receivedProfile));
      const phases = Array.from({length: 1001}, (_, step) => step / 1000);
      for (const boundary of expectedProfile.clipBoundaries ?? []) {
        phases.push(boundary.phase - 1e-10, boundary.phase, boundary.phase + 1e-10);
      }
      phases.push(-1, 2);
      for (const phase of phases) {
        compare(original.sampleReferenceCurveMotion(expectedProfile, phase),
          actual.sampleReferenceCurveMotion(receivedProfile, phase));
        poses++;
      }
      profiles++;
    }

    const expectedWorkspace = original.createReferenceCurveBlendWorkspace();
    const receivedWorkspace = actual.createReferenceCurveBlendWorkspace();
    for (let step = 0; step <= 100; step++) {
      for (const combination of [['idle', 'walk'], ['walk', 'run'], ['idle', 'walk', 'run']]) {
        const expectedSamples = combination.map((action, index) => ({
          profile: originalData.referenceActionProfiles.hero[family][action],
          phase: (step * (index + 1) % 101) / 100,
          weight: ((step + index * 17) % 101) / 100,
        }));
        const receivedSamples = expectedSamples.map((sample, index) => ({
          ...sample, profile: actualData.referenceActionProfiles.hero[family][combination[index]],
        }));
        compare(original.sampleReferenceCurveBlend(expectedSamples, expectedWorkspace),
          actual.sampleReferenceCurveBlend(receivedSamples, receivedWorkspace));
        blends++;
      }
    }
  }
  console.log(JSON.stringify({profiles, poses, blends, maxError}));
} finally {
  await rm(directory, {recursive: true, force: true});
}
