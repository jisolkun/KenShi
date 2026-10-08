import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCharacter, poseCharacter} from '../src/characters.js';
import {getReviewedAttack, sampleReviewedAttack} from '../src/choreography/index.js';

// Test rendered palms and the entire elbow/forearm, rather than grip points or
// blade clearance. A visible hand can still disappear inside opaque armour.
const direction = new THREE.Vector3(.923, .173, .343).normalize();
const samplesByGeometry = new WeakMap();
function surfaceSamples(geometry) {
  if (samplesByGeometry.has(geometry)) return samplesByGeometry.get(geometry);
  const attr = geometry.attributes.position, index = geometry.index;
  const unique = new Map();
  const add = p => unique.set(p.toArray().map(v => v.toFixed(7)).join(','), p);
  for (let i = 0; i < attr.count; i++) add(new THREE.Vector3().fromBufferAttribute(attr, i));
  // Midpoints also detect a long forearm face crossing armour while its corners
  // remain outside. These samples come from the actual rendered triangles.
  for (let i = 0; i < (index?.count ?? attr.count); i += 3) {
    const vertices = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(attr, index ? index.getX(i + k) : i + k));
    for (let k = 0; k < 3; k++) add(vertices[k].clone().lerp(vertices[(k + 1) % 3], .5));
  }
  const samples = [...unique.values()];
  samplesByGeometry.set(geometry, samples);
  return samples;
}
function fixture() {
  const rig = createCharacter('hero');
  rig.setWeapon('tang-dao');
  const obstacles = [...rig.ribcage.children, ...rig.head.children].filter(node => node.isMesh);
  for (const mesh of obstacles) {
    mesh.material = mesh.material.clone();
    mesh.material.side = THREE.DoubleSide;
    mesh.geometry.computeBoundingBox();
  }
  const subjects = rig.arms.flatMap((arm, side) => [
    ...arm.wrist.children.filter(node => node.isMesh).map(mesh => ({mesh, label: `${side ? 'right' : 'left'} palm`})),
    ...arm.elbow.children.filter(node => node.isMesh).map(mesh => ({mesh, label: `${side ? 'right' : 'left'} elbow/forearm ${mesh.geometry.type}`})),
  ]);
  return {rig, obstacles, subjects, ray: new THREE.Raycaster()};
}
function checkClearance(f, context) {
  f.rig.group.updateMatrixWorld(true);
  const targets = f.obstacles.map(mesh => ({mesh, inverse: mesh.matrixWorld.clone().invert()}));
  for (const {mesh, label} of f.subjects) {
    assert.ok(mesh.visible && mesh.scale.x > 0 && mesh.scale.y > 0 && mesh.scale.z > 0, `${context}: ${label} hidden`);
    for (const sample of surfaceSamples(mesh.geometry)) {
      const world = sample.clone().applyMatrix4(mesh.matrixWorld);
      for (const {mesh: obstacle, inverse} of targets) {
        if (!obstacle.geometry.boundingBox.containsPoint(world.clone().applyMatrix4(inverse))) continue;
        f.ray.set(world, direction);
        const hits = f.ray.intersectObject(obstacle, false);
        // Shared triangle edges may produce duplicate intersections. Count
        // distinct surface crossings, not the number of intersected triangles.
        const distances = hits.map(hit => hit.distance).filter((distance, i, all) => i === 0 || distance - all[i - 1] > 1e-7);
        const inside = distances.length % 2 === 1 && distances[0] > 1e-6;
        assert.ok(!inside, `${context}: ${label} penetrates ${obstacle.parent === f.rig.ribcage ? 'rib armour' : 'head'} at world ${world.toArray().map(v => v.toFixed(4))}`);
      }
    }
  }
}
function pose(f, args) {
  poseCharacter(f.rig, {dt: 1 / 60, ...args});
  checkClearance(f, `${args.state} ${args.combo ?? args.skill ?? 0}, phase ${(args.phase ?? 0).toFixed(4)}, time ${args.time.toFixed(3)}`);
}
for (const state of ['idle', 'run']) {
  test(`Tang both palm and forearm volumes clear torso/head throughout ${state}`, () => {
    const f = fixture();
    // Cover a full breathing cycle and several running gait cycles.
    for (let frame = 0; frame <= 240; frame += 2) pose(f, {state, time: frame / 60, speed: state === 'run' ? 1 : 0,
      moveBlend: state === 'run' ? 1 : 0, gaitPhase: frame / 60 * Math.PI * 4, immediate: true, transition: false});
  });
}
for (const state of ['attack', 'skill']) for (let action = 0; action < (state === 'attack' ? 4 : 5); action++) {
  test(`Tang ${state} ${action + 1}: fine sampling exposes no hand trajectory seams`, () => {
    // Normal frame sampling missed a 3.7cm projection jump during a high
    // carry. Cover the whole path finely enough to distinguish fast motion
    // from a positional discontinuity, including between contact windows.
    let previous;
    for (let frame = 0; frame <= 1920; frame++) {
      const phase = frame / 1920, sample = sampleReviewedAttack('tang-dao', action, phase, state);
      if (previous) sample.hands.forEach((hand, side) => {
        const distance = new THREE.Vector3(...hand.grip).distanceTo(new THREE.Vector3(...previous.hands[side].grip));
        assert.ok(distance < .01, `hand ${side} jumps ${(distance * 100).toFixed(2)}cm at phase ${phase}`);
      });
      previous = sample;
    }
  });
  test(`Tang ${state} ${action + 1}: both rendered hands/forearms clear torso/head`, () => {
    const f = fixture(), spec = getReviewedAttack('tang-dao', action, state);
    const phases = new Set([0, 1, ...spec.contacts.flatMap(c => [c.start, c.phase, c.end])]);
    for (let frame = 0; frame <= Math.ceil(spec.duration * 60); frame++) phases.add(Math.min(1, frame / (spec.duration * 60)));
    for (const phase of [...phases].sort((a, b) => a - b)) pose(f, {state, combo: action, skill: action, phase,
      time: phase * spec.duration, immediate: true, transition: false});
  });
  test(`Tang ${state} ${action + 1}: entry and exit blends keep both hands/forearms clear`, () => {
    const spec = getReviewedAttack('tang-dao', action, state);
    for (const locomotion of ['idle', 'run']) {
      const f = fixture();
      let time = 0;
      const locomotionArgs = {state: locomotion, speed: locomotion === 'run' ? 1 : 0, moveBlend: locomotion === 'run' ? 1 : 0};
      pose(f, {...locomotionArgs, time, immediate: true});
      // Execute through the real stateful transition path, including abrupt
      // cancellation mid-swing and ordinary recovery after the full action.
      for (const exitPhase of [.5, 1]) {
        for (let frame = 0; frame <= Math.ceil(spec.duration * exitPhase * 60); frame++) {
          time += 1 / 60;
          pose(f, {state, combo: action, skill: action, phase: Math.min(exitPhase, frame / (spec.duration * 60)), time});
        }
        for (let frame = 0; frame < 12; frame++) {
          time += 1 / 60;
          pose(f, {...locomotionArgs, time});
        }
      }
    }
  });
}
