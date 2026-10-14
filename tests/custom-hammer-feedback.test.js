import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHammerFeedback, HAMMER_FEEDBACK_BUDGET } from '../src/customHammer/feedback.js';
import { createWeaponImpact } from '../src/sourceMotion/weaponImpact.js';
import { createAudio, HAMMER_AUDIO_PROFILES, MAX_TRANSIENT_VOICES } from '../src/audio.js';

const Y = new THREE.Vector3(0, 1, 0);
const sample = (x = 0, angle = 0, extents = [.26, .18, .17]) => ({
  kind: 'hammer', hand: 1, headCenter: new THREE.Vector3(x, 1.3, .5),
  headQuaternion: new THREE.Quaternion().setFromAxisAngle(Y, angle), headHalfExtents: extents,
});
const approximately = (actual, expected, epsilon = 1e-7) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < epsilon, `${value} ≈ ${expected[index]}`));
};

test('head wake follows measured center, orientation and dimensions without modifying the physical frame', () => {
  const scene = new THREE.Scene(), feedback = createHammerFeedback(scene);
  const previous = sample(0, 0, [.24, .16, .14]), frame = sample(.27, .4);
  const borrowedPosition = frame.headCenter.clone(), borrowedRotation = frame.headQuaternion.clone();
  assert.equal(feedback.trace({ frame, previous, dt: .016, active: true, combo: 2, strikeId: 'drop' }), true);
  const ghosts = feedback.diagnostics().heads;
  assert.equal(ghosts.length, 3);
  for (let i = 0; i < ghosts.length; i++) {
    const fraction = (i + 1) / ghosts.length;
    approximately(ghosts[i].position, previous.headCenter.clone().lerp(frame.headCenter, fraction).toArray());
    const expectedRotation = previous.headQuaternion.clone().slerp(frame.headQuaternion, fraction);
    assert.ok(new THREE.Quaternion().fromArray(ghosts[i].quaternion).angleTo(expectedRotation) < 1e-7);
    approximately(ghosts[i].size, new THREE.Vector3().fromArray(previous.headHalfExtents)
      .lerp(new THREE.Vector3().fromArray(frame.headHalfExtents), fraction).multiplyScalar(2).toArray());
    assert.equal(ghosts[i].combo, 2); assert.equal(ghosts[i].strikeId, 'drop');
  }
  assert.ok(frame.headCenter.equals(borrowedPosition));
  assert.ok(frame.headQuaternion.equals(borrowedRotation));
  assert.equal('hit' in feedback, false, 'visual feedback has no damage API');
  feedback.destroy();
});

test('held hammer, inactive windup, zero time and unrelated teleported frames do not invent a wake', () => {
  const scene = new THREE.Scene(), feedback = createHammerFeedback(scene), frame = sample();
  assert.equal(feedback.trace({ frame, previous: frame, dt: .016, active: true }), false);
  assert.equal(feedback.trace({ frame: sample(.3, .3), previous: frame, dt: .016, active: false }), false);
  assert.equal(feedback.trace({ frame: sample(.3, .3), previous: frame, dt: 0, active: true }), false);
  assert.equal(feedback.trace({ frame: sample(3, .3), previous: frame, dt: .016, active: true }), false);
  assert.equal(feedback.diagnostics().activeHeads, 0);
  assert.equal(scene.children.length, 0);
  feedback.destroy();
});

test('first draw survives simulation substeps, zero dt freezes, then short head feedback expires', () => {
  const scene = new THREE.Scene(), feedback = createHammerFeedback(scene);
  feedback.trace({ frame: sample(.2, .3), previous: sample(), dt: .016, active: true, combo: 2, strikeId: 1 });
  for (let i = 0; i < 20; i++) feedback.update(.01);
  assert.ok(feedback.diagnostics().heads.every(head => head.awaitingPresentation && head.age === 0));
  const frozen = feedback.diagnostics(); feedback.update(0);
  assert.deepEqual(feedback.diagnostics(), frozen);
  // The renderer's callback is authoritative for actual drawing; the public
  // presented() hook supports main-loop and headless-test integration as well.
  scene.children[0].getObjectByName('physical-oriented-head-ghosts').onAfterRender();
  assert.ok(feedback.diagnostics().heads.every(head => !head.awaitingPresentation));
  feedback.update(.04); assert.ok(feedback.diagnostics().activeHeads > 0);
  feedback.update(.11); assert.equal(feedback.diagnostics().activeHeads, 0);
  feedback.trace({ frame: sample(.2, .3), previous: sample(), dt: .016, active: true, strikeId: 2 });
  feedback.update(.51); assert.equal(feedback.diagnostics().activeHeads, 0, 'unpresented effects have a bounded retention timeout');
  feedback.destroy();
});

test('ground contact stays at supplied physical point, deduplicates a strike, and uses a compact bounded pool', () => {
  const scene = new THREE.Scene(), feedback = createHammerFeedback(scene), point = new THREE.Vector3(3, .06, -2);
  assert.equal(feedback.ground({ point, direction: new THREE.Vector3(0, -1, 0), combo: 2, strikeId: 'floor' }), true);
  const group = scene.children[0], ring = group.getObjectByName('Measured floor pressure 0');
  approximately(ring.position.toArray(), [3, .068, -2]);
  assert.equal(feedback.ground({ point: new THREE.Vector3(30, 0, 0), combo: 2, strikeId: 'floor' }), false);
  approximately(ring.position.toArray(), [3, .068, -2]);
  const dustMesh = group.getObjectByName('compact-contact-dust'), transform = new THREE.Matrix4();
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (let i = 0; i < dustMesh.count; i++) {
    dustMesh.getMatrixAt(i, transform); transform.decompose(position, quaternion, scale);
    assert.ok(position.distanceTo(point) < .06, 'dust begins at the actual floor contact');
  }
  const geometryReferences = group.children.map(child => child.geometry), materialReferences = group.children.map(child => child.material);
  for (let i = 0; i < 100; i++) {
    feedback.ground({ point, direction: new THREE.Vector3(1, -.5, 0), combo: 2, strikeId: i });
    feedback.trace({ frame: sample(.2, .3), previous: sample(), dt: .016, active: true, combo: i % 3, strikeId: i });
  }
  const diagnostic = feedback.diagnostics();
  assert.equal(diagnostic.activeHeads, HAMMER_FEEDBACK_BUDGET.heads);
  assert.equal(diagnostic.activeDust, HAMMER_FEEDBACK_BUDGET.dust);
  assert.equal(diagnostic.activeChips, HAMMER_FEEDBACK_BUDGET.chips);
  assert.equal(diagnostic.activeContacts, HAMMER_FEEDBACK_BUDGET.contacts);
  assert.equal(diagnostic.geometryCount, 4); assert.equal(diagnostic.materialCount, 7);
  assert.deepEqual(group.children.map(child => child.geometry), geometryReferences);
  assert.deepEqual(group.children.map(child => child.material), materialReferences);
  feedback.presented(); feedback.update(.12);
  for (const mesh of group.children.filter(child => child.name.startsWith('Measured floor pressure'))) assert.ok(mesh.scale.x < .65);
  feedback.update(.5);
  assert.equal(feedback.diagnostics().activeDust, 0); assert.equal(feedback.diagnostics().activeChips, 0);
  assert.equal(feedback.diagnostics().activeContacts, 0);
  feedback.destroy();
});

test('clear reuses owned pools and destroy disposes each resource once without touching borrowed scene resources', () => {
  const scene = new THREE.Scene(), borrowedGeometry = new THREE.BoxGeometry(), borrowedMaterial = new THREE.MeshBasicMaterial();
  const borrowed = new THREE.Mesh(borrowedGeometry, borrowedMaterial); scene.add(borrowed);
  let borrowedDisposals = 0;
  borrowedGeometry.addEventListener('dispose', () => borrowedDisposals++);
  borrowedMaterial.addEventListener('dispose', () => borrowedDisposals++);
  const feedback = createHammerFeedback(scene);
  feedback.ground({ point: new THREE.Vector3(), strikeId: 1 });
  const group = scene.children.find(child => child !== borrowed);
  const owned = new Set(group.children.flatMap(child => [child.geometry, child.material]));
  const counts = new Map([...owned].map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  feedback.clear(); assert.deepEqual(scene.children, [borrowed]);
  assert.ok([...counts.values()].every(count => count === 0));
  feedback.ground({ point: new THREE.Vector3(), strikeId: 1 });
  assert.equal(scene.children[1], group, 'clear permits same strike and preserves pool identity');
  feedback.destroy(); feedback.destroy();
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(borrowedDisposals, 0); assert.deepEqual(scene.children, [borrowed]);
  assert.equal(feedback.diagnostics().geometryCount, 0); assert.equal(feedback.diagnostics().materialCount, 0);
  assert.equal(feedback.trace({ frame: sample(.2), previous: sample(), dt: .016, active: true }), false);
  assert.equal(feedback.ground({ point: new THREE.Vector3() }), false);
  borrowedGeometry.dispose(); borrowedMaterial.dispose();
});

test('hammer contact has compact volumetric pressure and directed armor chips without cutting polygons', () => {
  const scene = new THREE.Scene(), feedback = createWeaponImpact(scene), direction = new THREE.Vector3(1, -2, .4).normalize();
  const effect = feedback.hit(new THREE.Vector3(2, .7, -1), direction, 'great-hammer', 2);
  const diagnostic = feedback.snapshot().slots.find(slot => slot.active);
  assert.equal(diagnostic.family, 'solid-pressure');
  assert.deepEqual(diagnostic.geometryRoles, ['volumetric-pressure-core', 'armor-chips']);
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(effect.quaternion).distanceTo(direction) < 1e-7);
  assert.ok(effect.children[0].scale.length() < .25);
  assert.equal(effect.children[0].material.blending, THREE.NormalBlending);
  feedback.update(.2); assert.equal(feedback.snapshot().slots.find(slot => slot.active).age, 0);
  feedback.presented(); feedback.update(.04);
  assert.equal(feedback.snapshot().slots.find(slot => slot.active).phase, 'burst');
  feedback.update(.25); assert.equal(feedback.snapshot().activeCount, 0);
  feedback.destroy();
});

function withAudio(run) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document, previousRandom = Math.random;
  const events = new Map(), contexts = [];
  const parameter = () => ({ value: 0, setValueAtTime(value, time) { this.start = value; this.time = time; },
    exponentialRampToValueAtTime(value, time) { this.end = value; this.endTime = time; },
    cancelScheduledValues() {}, setTargetAtTime(value) { this.target = value; } });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), stops: 0,
    connect() {}, disconnect() { this.disconnected = true; }, start(time = 0) { this.startTime = time; },
    stop(time) { this.stops++; this.stopTime = time; } });
  class AudioContext {
    constructor() { this.currentTime = 10; this.sampleRate = 100; this.state = 'suspended'; this.destination = {};
      this.oscillators = []; this.filters = []; this.sources = []; contexts.push(this); }
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
    createBuffer() { return { getChannelData: () => new Float32Array(200) }; }
    createBufferSource() { const value = node(); this.sources.push(value); return value; }
    createBiquadFilter() { const value = node(); this.filters.push(value); return value; }
    createOscillator() { const value = node(); this.oscillators.push(value); return value; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext }; globalThis.document = { hidden: false,
    addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name) };
  Math.random = () => .5;
  const audio = createAudio();
  try { audio.unlock(); run({ audio, context: contexts[0], events }); }
  finally { audio.destroy(); globalThis.window = previousWindow; globalThis.document = previousDocument; Math.random = previousRandom; }
}
function capture(context, play) {
  const startOscillators = context.oscillators.length, startSources = context.sources.length, startFilters = context.filters.length;
  context.currentTime += .5; play();
  return { oscillators: context.oscillators.slice(startOscillators), sources: context.sources.slice(startSources),
    filters: context.filters.slice(startFilters) };
}
const signature = sounds => JSON.stringify([
  ...sounds.oscillators.map(node => [node.type, node.frequency.start, node.frequency.end, node.stopTime - node.startTime]),
  ...sounds.filters.map(node => [node.type, node.frequency.start, node.frequency.end, node.frequency.endTime - node.frequency.time]),
]);

test('three original hammer releases and contacts have distinct short low rush, body and steel voices', () => {
  assert.equal(HAMMER_AUDIO_PROFILES.length, 3);
  withAudio(({ audio, context }) => {
    const releases = [], contacts = [];
    for (let combo = 0; combo < 3; combo++) {
      const release = capture(context, () => audio.weaponSlash('great-hammer', combo));
      const contact = capture(context, () => audio.weaponHit('great-hammer', 1.5, combo));
      assert.equal(release.oscillators.length + release.sources.length, 4);
      assert.ok(contact.oscillators.length + contact.sources.length <= 5);
      assert.ok(release.filters.some(filter => filter.type === 'bandpass' && filter.frequency.start < 400));
      assert.ok(contact.oscillators.some(oscillator => oscillator.frequency.start < 150));
      for (const sound of [release, contact]) for (const source of [...sound.oscillators, ...sound.sources]) {
        assert.ok(source.stopTime - source.startTime <= .191, 'short transient avoids a tail masking the next load');
      }
      releases.push(signature(release)); contacts.push(signature(contact));
    }
    assert.equal(new Set(releases).size, 3); assert.equal(new Set(contacts).size, 3);
    const repeated = capture(context, () => audio.weaponSlash('great-hammer', 3));
    assert.equal(signature(repeated), releases[0], 'custom combo wraps after three strokes');
  });
});

test('audio crowd and floor events are rate limited, voice budget is hard bounded, and pause clears all hammer tails', () => {
  withAudio(({ audio, context, events }) => {
    capture(context, () => audio.weaponHit('great-hammer', 1.5, 2));
    const before = context.oscillators.length + context.sources.length;
    for (let i = 0; i < 20; i++) audio.weaponHit('great-hammer', 1.5, 2);
    assert.equal(context.oscillators.length + context.sources.length, before);
    const ground = capture(context, () => audio.weaponGround('great-hammer', 2));
    assert.equal(ground.oscillators.length + ground.sources.length, 4);
    const groundBefore = context.oscillators.length + context.sources.length;
    audio.weaponGround('great-hammer', 2); assert.equal(context.oscillators.length + context.sources.length, groundBefore);
    for (let i = 0; i < 50; i++) capture(context, () => audio.weaponHit('great-hammer', 1.5, i % 3));
    assert.equal(audio.diagnostics().transientVoices, MAX_TRANSIENT_VOICES);
    assert.ok(context.oscillators.some(source => source.stops === 2 && source.disconnected), 'oldest tails are evicted');
    audio.pause(); assert.equal(audio.diagnostics().transientVoices, 0); assert.equal(context.state, 'suspended');
    const paused = capture(context, () => { audio.weaponSlash('great-hammer', 2); audio.weaponGround('great-hammer', 2); });
    assert.equal(paused.oscillators.length + paused.sources.length, 0);
    audio.resume(); const resumed = capture(context, () => audio.weaponSlash('great-hammer', 1));
    assert.equal(resumed.oscillators.length + resumed.sources.length, 4);
    globalThis.document.hidden = true; events.get('visibilitychange')();
    assert.equal(audio.diagnostics().transientVoices, 0);
    const hidden = capture(context, () => audio.weaponHit('great-hammer', 1.5, 2));
    assert.equal(hidden.oscillators.length + hidden.sources.length, 0);
  });
});
