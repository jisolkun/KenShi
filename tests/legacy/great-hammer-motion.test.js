import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCharacter, poseCharacter} from '../../src/characters.js';
import {getWeapon, isWeaponUnlocked} from '../../src/weapons.js';
import {getReviewedAttack, sampleReviewedAttack} from '../../src/choreography/index.js';
import {heavyWeaponStepDelta, resolveGreatDaoStep, HAMMER_STEPS} from '../../src/greatDaoMovement.js';
import {clipHammerHeadSweep, hammerHeadSweepContains, bladeSweepContains} from '../../src/weaponCombat.js';

const ID = 'great-hammer';
const EPSILON = 1e-5;
const FLOOR = .055;
const world = node => node.getWorldPosition(new THREE.Vector3());
const worldQuaternion = node => node.getWorldQuaternion(new THREE.Quaternion());
const degrees = radians => THREE.MathUtils.radToDeg(radians);
const rayDirection = new THREE.Vector3(.923, .173, .343).normalize();
const surfaceCache = new WeakMap();
const bodyEnvelopes = rig => [
  {node: rig.chest, center: new THREE.Vector3(0, .22, 0), radius: new THREE.Vector3(.30, .33, .185)},
  {node: rig.head, center: new THREE.Vector3(0, .11, .025), radius: new THREE.Vector3(.165, .219, .156)},
];

function surfaceSamples(geometry) {
  if (surfaceCache.has(geometry)) return surfaceCache.get(geometry);
  const attr = geometry.attributes.position, index = geometry.index, unique = new Map();
  const add = point => unique.set(point.toArray().map(value => value.toFixed(7)).join(','), point);
  for (let n = 0; n < attr.count; n++) add(new THREE.Vector3().fromBufferAttribute(attr, n));
  for (let n = 0; n < (index?.count ?? attr.count); n += 3) {
    const points = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(attr,
      index ? index.getX(n + k) : n + k));
    for (let k = 0; k < 3; k++) add(points[k].clone().lerp(points[(k + 1) % 3], .5));
  }
  const samples = [...unique.values()];
  surfaceCache.set(geometry, samples);
  return samples;
}

function fixture(angle = 0) {
  const rig = createCharacter('hero');
  rig.setWeapon(ID);
  assert.equal(rig.weaponId, ID, 'equipping the hammer must not silently fall back to a dao');
  rig.group.rotation.y = angle;
  const armour = [...rig.ribcage.children, ...rig.head.children].filter(node => node.isMesh);
  for (const mesh of armour) {
    mesh.material = mesh.material.clone();
    mesh.material.side = THREE.DoubleSide;
    mesh.geometry.computeBoundingBox();
  }
  const hands = rig.arms.flatMap((arm, side) => [
    ...arm.wrist.children.filter(node => node.isMesh).map(mesh => ({mesh, label: `${side ? 'right' : 'left'} palm`})),
    ...arm.elbow.children.filter(node => node.isMesh).map(mesh => ({mesh, label: `${side ? 'right' : 'left'} elbow/forearm`})),
  ]);
  // Derive the rear shaft endpoint from the actual rendered geometry. A
  // scene marker or a collision-only shortening must not hide a long pommel.
  rig.group.updateMatrixWorld(true);
  const root = rig.arms[1].weapon, primary = world(rig.arms[1].wrist);
  const axis = world(rig.hammerHead).sub(primary).normalize();
  let rearHiltLength = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    for (let n = 0; n < positions.count; n++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, n).applyMatrix4(mesh.matrixWorld);
      rearHiltLength = Math.max(rearHiltLength, -point.sub(primary).dot(axis));
    }
  });
  assert.ok(rearHiltLength > .22, 'the actual hilt continues behind the 22cm supporting grip');
  assert.ok(rearHiltLength <= .31 + EPSILON, 'the real rear hilt leaves at most 9cm behind the supporting hand');
  return {rig, armour, hands, rearHiltLength, ray: new THREE.Raycaster()};
}

function checkHandVolumes(f, context) {
  const obstacles = f.armour.map(mesh => ({mesh, inverse: mesh.matrixWorld.clone().invert()}));
  for (const {mesh, label} of f.hands) {
    assert.ok(mesh.visible && mesh.scale.x > 0 && mesh.scale.y > 0 && mesh.scale.z > 0,
      `${context}: the actual ${label} mesh must remain visible`);
    for (const sample of surfaceSamples(mesh.geometry)) {
      const point = sample.clone().applyMatrix4(mesh.matrixWorld);
      for (const {mesh: obstacle, inverse} of obstacles) {
        if (!obstacle.geometry.boundingBox.containsPoint(point.clone().applyMatrix4(inverse))) continue;
        f.ray.set(point, rayDirection);
        const hits = f.ray.intersectObject(obstacle, false);
        const distances = hits.map(hit => hit.distance).filter((distance, n, all) =>
          n === 0 || distance - all[n - 1] > 1e-7);
        const inside = distances.length % 2 === 1 && distances[0] > 1e-6;
        assert.ok(!inside,
          `${context}: rendered ${label} penetrates ${obstacle.parent === f.rig.ribcage ? 'rib armour' : 'head'} at ${point.toArray()}`);
      }
    }
  }
}

// In the ellipsoid's normalized coordinates the physical head is an affine
// box. Minimize its squared distance to the origin over the full box volume,
// rather than allowing an armour ellipsoid to hide between clear corners.
function boxClearance(frame, quaternion, envelope) {
  const localCenter = envelope.node.worldToLocal(frame.headCenter.clone());
  const residual = localCenter.clone().sub(envelope.center).divide(envelope.radius);
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    .map(axis => envelope.node.worldToLocal(frame.headCenter.clone().add(axis.applyQuaternion(quaternion)))
      .sub(localCenter).divide(envelope.radius));
  const half = frame.headHalfExtents.toArray(), coordinates = [0, 0, 0];
  for (let iteration = 0; iteration < 96; iteration++) {
    for (let axis = 0; axis < 3; axis++) {
      const next = THREE.MathUtils.clamp(coordinates[axis] - axes[axis].dot(residual) / axes[axis].lengthSq(),
        -half[axis], half[axis]);
      residual.addScaledVector(axes[axis], next - coordinates[axis]);
      coordinates[axis] = next;
    }
  }
  return residual.length();
}

function checkPhysical(f, context, requireSupport = false) {
  const {rig} = f;
  rig.group.updateMatrixWorld(true);
  rig.group.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite),
    `${context}: ${node.name || node.type} has a nonfinite matrix`));
  const frames = rig.weaponBlades();
  assert.equal(frames.length, 1, `${context}: the two-handed hammer has one actual head`);
  const frame = frames[0];
  assert.equal(frame.kind, 'hammer');
  assert.ok(frame.headCenter?.isVector3 && frame.middle?.isVector3, `${context}: physical head and shaft markers exist`);
  assert.deepEqual(frame.headHalfExtents.toArray(), [.27, .19, .19]);
  assert.equal(frame.headRadius, .27);
  assert.equal(frame.headCorners.length, 8);
  assert.ok(rig.hammerHead?.isObject3D && rig.arms[1].weapon.headCenter?.isObject3D,
    `${context}: collision uses the actual rendered head marker`);
  assert.ok(world(rig.hammerHead).distanceTo(frame.headCenter) < EPSILON,
    `${context}: the returned head follows its actual scene marker`);
  assert.equal(rig.arms[0].weapon.visible, false, `${context}: the support hand carries no duplicate hammer`);
  const primary = world(rig.arms[1].wrist), support = world(rig.offhandGrip);
  assert.ok(world(rig.arms[0].wrist).distanceTo(support) < EPSILON,
    `${context}: the supporting palm leaves the rigid hilt`);
  assert.ok(Math.abs(primary.distanceTo(support) - .22) < EPSILON,
    `${context}: both actual hands retain the 22cm grip spacing`);
  assert.ok(Math.abs(primary.distanceTo(frame.headCenter) - 1.25) < EPSILON,
    `${context}: the head center is 1.25m from the actual primary wrist`);
  assert.ok(Math.abs(primary.distanceTo(frame.tip) - 1.44) < EPSILON,
    `${context}: the physical head tip is 1.44m from the actual primary wrist`);
  const axis = frame.headCenter.clone().sub(primary).normalize();
  assert.ok(support.clone().sub(primary).cross(axis).length() < EPSILON,
    `${context}: both palms remain on the actual rigid shaft`);
  assert.ok(support.clone().sub(primary).dot(axis) < 0,
    `${context}: the support hand holds behind the primary grip`);
  const quaternion = worldQuaternion(rig.arms[1].weapon);
  const actualCorners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z =>
    new THREE.Vector3(x * .27, y * .19, z * .19).applyQuaternion(quaternion).add(frame.headCenter))));
  actualCorners.forEach((corner, n) => assert.ok(corner.distanceTo(frame.headCorners[n]) < EPSILON,
    `${context}: head corner ${n} matches the rendered head orientation`));
  const bottom = Math.min(...frame.headCorners.map(corner => corner.y));
  assert.ok(bottom >= FLOOR - EPSILON,
    `${context}: the complete hammer head descends below the .055m stone-floor clearance (${bottom}m)`);
  assert.ok(new THREE.Box3().setFromObject(rig.arms[1].weapon, true).min.y >= FLOOR - EPSILON,
    `${context}: a rendered hammer mesh enters the stone floor`);
  for (const [bodyIndex, envelope] of bodyEnvelopes(rig).entries()) {
    const clearance = boxClearance(frame, quaternion, envelope);
    assert.ok(clearance > 1,
      `${context}: the full head box intersects the ${bodyIndex ? 'head' : 'torso'} envelope (${clearance})`);
    // Cover the long rigid shaft and the portion behind the support grip.
    // Its actual cylinder has thickness; a clear centerline alone is weaker
    // than checking the radial surface around each shaft section.
    const reference = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    for (let section = 0; section <= 40; section++) {
      const center = primary.clone().addScaledVector(axis,
        -f.rearHiltLength + (f.rearHiltLength + 1.25) * section / 40);
      for (let side = 0; side < 8; side++) {
        const angle = side * Math.PI / 4;
        const point = center.clone().addScaledVector(reference, Math.cos(angle) * .045)
          .addScaledVector(normal, Math.sin(angle) * .045);
        const local = envelope.node.worldToLocal(point).sub(envelope.center).divide(envelope.radius);
        assert.ok(local.length() > 1,
          `${context}: the physical shaft surface intersects the ${bodyIndex ? 'head' : 'torso'} envelope`);
      }
    }
  }
  const ankles = [], soles = [];
  rig.legs.forEach((leg, side) => {
    const ankle = world(leg.foot), length = leg.knee.position.length() + leg.foot.position.length();
    assert.ok(ankle.distanceTo(world(leg.hip)) <= length + EPSILON,
      `${context}: actual leg ${side} cannot reach its ankle`);
    const sole = new THREE.Box3().setFromObject(leg.foot, true).min.y;
    assert.ok(sole >= -EPSILON, `${context}: boot ${side} penetrates the floor`);
    ankles.push(ankle);soles.push(sole);
  });
  if (requireSupport) {
    assert.ok(ankles.some(ankle => ankle.y >= .074 && ankle.y <= .076),
      `${context}: a heavy hammer attack loses both planted ankles`);
    assert.ok(Math.min(...soles) < .01, `${context}: the support sole floats above its retained mesh clearance`);
  }
  checkHandVolumes(f, context);
  return {frame, quaternion, bottom, ankles, bodyHeight: rig.body.position.y,
    characterHeadY: world(rig.head).y};
}

function checkContinuity(f, current, previous, context) {
  const joints = [f.rig.body, f.rig.chest, f.rig.head,
    ...f.rig.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.wrist]),
    ...f.rig.legs.flatMap(leg => [leg.hip, leg.knee, leg.foot])];
  const quaternions = joints.map(node => node.quaternion.clone());
  if (previous) {
    quaternions.forEach((quaternion, n) => {
      const turn = degrees(quaternion.angleTo(previous.quaternions[n]));
      assert.ok(turn < 30, `${context}: joint ${n} (${joints[n].name}) turns ${turn}° per frame`);
    });
    const turn = degrees(current.quaternion.angleTo(previous.hammerQuaternion));
    assert.ok(turn < 30, `${context}: the actual hammer world orientation turns ${turn}° per frame`);
  }
  return {quaternions, hammerQuaternion: current.quaternion.clone()};
}

function strikeFrames(f, combo, rate, {stepping = false, turn = 0, carry = 0} = {}) {
  const action = getReviewedAttack(ID, combo), {rig} = f, history = [];
  assert.ok(action, `hammer strike ${combo + 1} exists in the reviewed motion registry`);
  let previousPhase = 0, previous;
  let attackStep = null;
  if (stepping) {
    poseCharacter(rig, {state: 'idle', time: 0, speed: 0, moveBlend: 0, immediate: true, transition: false});
    const budget = HAMMER_STEPS[combo];
    attackStep = {start: {x: rig.group.position.x, z: rig.group.position.z},
      angle: rig.group.rotation.y, startPhase: 0, ...budget,
      footStarts: rig.legs.map(leg => world(leg.foot)),
      footRotations: rig.legs.map(leg => worldQuaternion(leg.foot))};
  }
  for (let frame = 0; frame <= Math.ceil(action.duration * rate); frame++) {
    const time = Math.min(action.duration, frame / rate), phase = time / action.duration;
    if (attackStep) {
      const stride = heavyWeaponStepDelta(ID, combo, previousPhase, phase);
      const angle = attackStep.angle + turn * phase;
      const forward = stride.forward, lateral = stride.lateral;
      const resolved = resolveGreatDaoStep(rig.group.position,
        {x: Math.sin(angle) * forward + Math.cos(angle) * lateral,
          z: Math.cos(angle) * forward - Math.sin(angle) * lateral});
      rig.group.position.set(resolved.x, 0, resolved.z);
      rig.group.rotation.y = angle;
    }
    poseCharacter(rig, {state: 'attack', combo, phase, time, dt: 1 / rate,
      attackStep, attackCarry: carry, speed: carry, gaitPhase: time * Math.PI * 3,
      immediate: true, transition: false});
    const context = `hammer ${combo + 1}, ${rate} Hz, phase ${phase.toFixed(5)}, step=${stepping}`;
    const current = checkPhysical(f, context, stepping || carry === 0);
    previous = checkContinuity(f, current, previous, context);
    history.push({...current, phase, time});
    previousPhase = phase;
  }
  return {action, history};
}

test('great hammer exposes four distinct two-handed smash actions with physical head metadata', () => {
  const weapon = getWeapon(ID);
  assert.equal(weapon.id, ID);
  assert.equal(weapon.name, '大锤');
  assert.equal(weapon.grip, 'twohand');
  assert.equal(isWeaponUnlocked(ID), true);
  assert.equal(weapon.moves.length, 4);
  assert.ok(!weapon.skillNames?.length, 'the heavy hammer does not reintroduce active skills');
  const names = new Set();
  for (let combo = 0; combo < 4; combo++) {
    const action = getReviewedAttack(ID, combo);
    assert.ok(action);
    assert.equal(action.weaponId, ID);
    assert.equal(action.kind, 'smash');
    assert.equal(action.strikeVolume, 'hammer-head');
    assert.equal(action.supportDistance, .22);
    assert.equal(action.headLength, 1.25);
    assert.equal(action.tipLength, 1.44);
    assert.equal(action.headRadius, .27);
    assert.ok(action.duration >= .35 && action.duration <= .75,
      `hammer ${combo + 1} keeps a short readable swing instead of a long chamber and recovery`);
    assert.ok(action.contacts.length > 0 && action.contacts.every(contact => contact.kind === 'smash'));
    assert.equal(getReviewedAttack(ID, combo, 'skill'), null);
    assert.notDeepEqual([.2, .5, .8].map(phase => sampleReviewedAttack(ID, combo, phase).hands),
      [.2, .5, .8].map(phase => sampleReviewedAttack('great-dao', combo, phase).hands),
      `hammer ${combo + 1} must have its own physical head trajectory`);
    names.add(action.name);
  }
  assert.equal(names.size, 4, 'all four escalating hammer actions have distinct identities');
  const chainDuration=[0,1,2,3].reduce((total,combo)=>total+getReviewedAttack(ID,combo).duration,0);
  assert.ok(chainDuration>=2.0&&chainDuration<=2.35,
    `the four attacks should read as a fast continuous chain near 2.18s, got ${chainDuration}s`);
  assert.ok(getReviewedAttack(ID, 3).duration > getReviewedAttack(ID, 0).duration,
    'the terminal overhead smash has a longer commitment than the opening strike');
});

for (let combo = 0; combo < 4; combo++) {
  for (const rate of [60, 120]) {
    test(`great hammer strike ${combo + 1}, ${rate} Hz: full head, shaft, real palms and 15 joints stay clear and continuous`, () => {
      strikeFrames(fixture(), combo, rate);
    });
    test(`great hammer strike ${combo + 1}, ${rate} Hz: moving and turning world root preserves the physical hammer and reachable support`, () => {
      const f = fixture(.37);
      const {history} = strikeFrames(f, combo, rate, {stepping: true, turn: .18, carry: .65});
      const budget = HAMMER_STEPS[combo];
      assert.ok(f.rig.group.position.length() > Math.hypot(budget.forward, budget.lateral) * .95,
        'the hammer attack performs its actual world-root travel budget');
      const lead = getReviewedAttack(ID, combo).step;
      assert.ok(Math.max(...history.map(frame => Math.hypot(
        frame.ankles[lead].x - history[0].ankles[lead].x,
        frame.ankles[lead].z - history[0].ankles[lead].z))) > .18,
      'the leading ankle takes a visible actual step under the loaded hammer');
      const action = getReviewedAttack(ID, combo);
      const impactWindow=combo%2?[action.contact,action.finish+.02]:[action.contact-.04,action.contact+.04];
      const active = history.filter(frame => frame.phase >= impactWindow[0] && frame.phase <= impactWindow[1]);
      assert.ok(active.length > 1, 'the frame grid samples the actual area pulse or ground impact');
      for (let side = 0; side < 2; side++) {
        const planted = active[0].ankles[side];
        assert.ok(active.every(frame => frame.ankles[side].distanceTo(planted) < .035),
          `support foot ${side} slides while the actual hammer head is striking`);
        assert.ok(active.every(frame => Math.abs(frame.ankles[side].y - .075) < .005),
          `support foot ${side} lifts during the loaded impact`);
      }
    });
  }

  test(`great hammer strike ${combo + 1} drives a fast substantial real head path through its short release`, () => {
    const f = fixture(), action = getReviewedAttack(ID, combo);
    const [start, end] = action.active;
    const speeds = [];
    let previous,travel=0;
    for (let frame = 0; frame <= Math.ceil(action.duration * 240); frame++) {
      const time = Math.min(action.duration, frame / 240), phase = time / action.duration;
      poseCharacter(f.rig, {state: 'attack', combo, phase, time, attackCarry: 0,
        immediate: true, transition: false});
      const head = f.rig.weaponBlades()[0].headCenter;
      if (previous && time > previous.time) {
        const speed = head.distanceTo(previous.head) / (time - previous.time);
        if (phase >= start && phase <= end) {
          speeds.push(speed);travel+=head.distanceTo(previous.head);
        }
      }
      previous = {head, time};
    }
    assert.ok(speeds.length>2,'the short attack still has multiple real motion samples');
    const peak = Math.max(...speeds);
    assert.ok(peak > 8,
      'the actual hammer head develops a fast forceful release through the enemy height');
    assert.ok(travel>1.0,'the fast release moves the actual head across a large visible span');
  });

  for (const rate of [60, 120]) {
    test(`great hammer strike ${combo + 1}, ${rate} Hz: physical head collision follows the visible head and leaves the handle harmless`, () => {
      const f = fixture(), {action, history} = strikeFrames(f, combo, rate);
      const target = {x: 0, z: Math.min(action.reach,action.headLength+.45), minY: .18, maxY: 1.85};
      let previous, hit = false, contacts = 0;
      for (const current of history) {
        for (const contact of action.contacts) {
          const clipped = clipHammerHeadSweep(current.frame.headCenter, previous?.frame.headCenter,
            current.phase, previous?.phase, [contact.start, contact.end]);
          if (!clipped) continue;
          contacts++;
          const halfHeight = Math.max(current.frame.headHalfHeight, previous?.frame.headHalfHeight ?? 0);
          if (hammerHeadSweepContains(clipped.current, clipped.previous, target, .22, .27, halfHeight)) hit = true;
          for (const far of [{x: 0, z: 4}, {x: 4, z: 0}, {x: 0, z: -4}, {x: 0, z: 1.4, minY: 4, maxY: 5}]) {
            assert.equal(hammerHeadSweepContains(clipped.current, clipped.previous, far, .22, .27, halfHeight), false,
              'no damage is created beyond the swept physical head volume');
          }
          if (current.phase < contact.start || current.phase > contact.end) continue;
          const head = current.frame.headCenter, shaft = current.frame.middle.clone().lerp(current.frame.heel, .65);
          const handleTarget = {x: shaft.x, z: shaft.z, minY: shaft.y - .02, maxY: shaft.y + .02};
          assert.equal(bladeSweepContains(current.frame, null, handleTarget, .025, .015), true,
            'the counterexample actually meets the visible shaft segment');
          assert.equal(hammerHeadSweepContains(head, null, handleTarget, .025, .27, current.frame.headHalfHeight), false,
            'touching the long visible handle must not substitute for meeting the damaging head');
        }
        previous = current;
      }
      assert.ok(contacts > 1, 'the regular rendered frame grid exercises a real contact interval');
      assert.equal(hit, true, 'the actual active hammer head crosses a forward enemy without inserting ideal contact poses');
    });
  }
}

for(const combo of [1,3])test(`great hammer ground strike ${combo+1} brings the complete physical head down to the stone floor`, () => {
  const f = fixture(), action = getReviewedAttack(ID, combo), [release, finish] = action.swing;
  const samples = [];
  for (let frame = 0; frame <= 240; frame++) {
    const phase = release + (finish - release) * frame / 240;
    poseCharacter(f.rig, {state: 'attack', combo, phase, time: phase * action.duration,
      attackCarry: 0, immediate: true, transition: false});
    const current = checkPhysical(f, `finisher release phase ${phase}`, true);
    samples.push(current);
  }
  const heads = samples.map(sample => sample.frame.headCenter), first = heads[0], last = heads.at(-1);
  assert.ok(first.y > samples[0].characterHeadY + (combo===3?.4:.1), 'the actual smash begins above the character head');
  assert.ok(first.y - last.y > (combo===3?1.2:.9), 'the actual heavy head descends through a substantial enemy-height span');
  const dt = (finish - release) * action.duration / 240;
  const vertical = heads.slice(1).map((head, n) => (head.y - heads[n].y) / dt);
  assert.ok(Math.min(...vertical) < -5, 'the actual descending hammer develops a forceful vertical velocity');
  const bottom = Math.min(...samples.map(sample => sample.bottom));
  assert.ok(bottom >= FLOOR - EPSILON && bottom < .10,
    `the whole head visibly finishes near the floor while retaining stone clearance, got ${bottom}m`);
  assert.ok(heads.some(head => head.y > .5 && head.y < 1.7 && head.z > 1),
    'the descending head actually crosses the forward enemy volume');
});

test('the real hammer chain changes strike planes and compresses into a planted finishing impact', () => {
  const f = fixture();
  const paths = [0, 1, 2, 3].map(combo => {
    const action = getReviewedAttack(ID, combo);
    const samples = [];
    for (let frame = 0; frame <= 180; frame++) {
      const phase = frame / 180;
      poseCharacter(f.rig, {state: 'attack', combo, phase, time: phase * action.duration,
        attackCarry: 0, immediate: true, transition: false});
      f.rig.group.updateMatrixWorld(true);
      samples.push({phase, head: f.rig.weaponBlades()[0].headCenter,
        height: f.rig.body.position.y});
    }
    const at = phase => samples.reduce((best, sample) =>
      Math.abs(sample.phase - phase) < Math.abs(best.phase - phase) ? sample : best);
    const release = at(action.release), finish = at(action.finish);
    return {action, samples, release, finish, delta: finish.head.clone().sub(release.head)};
  });
  assert.ok(Math.abs(paths[0].delta.x) > 1.5 &&
    Math.abs(paths[0].delta.x) > Math.abs(paths[0].delta.y) * 1.5,
    'the opening head makes a broad horizontal sweep through the crowd');
  assert.ok(paths[1].delta.y < -.9,
    'the second attack drives the real head down instead of repeating the lateral sweep');
  assert.ok(Math.abs(paths[2].delta.x) > 1.8 &&
    Math.abs(paths[2].delta.x) > Math.abs(paths[2].delta.y) * 1.6,
    'the body pivot creates a large lateral head path across a different crowd sector');
  assert.ok(paths[3].delta.y < -1.2 &&
    Math.abs(paths[3].delta.y) > Math.abs(paths[3].delta.x) * 2,
    'the final head commits to a vertical smash rather than another side sweep');
  const finisher = paths[3];
  const impact = finisher.samples.filter(sample => sample.phase >= finisher.action.contact &&
    sample.phase <= finisher.action.finish + .04);
  const compressed = Math.min(...impact.map(sample => sample.height));
  const acceleration = finisher.samples.filter(sample => sample.phase >= finisher.action.release &&
    sample.phase < finisher.action.contact);
  const recovery = finisher.samples.filter(sample => sample.phase >= finisher.action.brake);
  assert.ok(Math.max(...acceleration.map(sample => sample.height)) - compressed > .04,
    'the pelvis visibly compresses as the loaded head reaches impact');
  assert.ok(Math.max(...recovery.map(sample => sample.height)) - compressed > .025,
    'the body recovers height after absorbing the finishing impact');
  const rebound = finisher.samples.filter(sample => sample.phase >= finisher.action.finish &&
    sample.phase <= finisher.action.brake);
  assert.ok(Math.max(...rebound.map(sample => sample.head.y)) - finisher.finish.head.y > .06,
    'the head makes a small visible rebound after its floor-level arrest');
});

test('adjacent hammer actions retain the real head, hands and support feet at their shared carry', () => {
  const f = fixture();
  const nodes = [f.rig.body, f.rig.chest, f.rig.head,
    ...f.rig.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.wrist]),
    ...f.rig.legs.flatMap(leg => [leg.hip, leg.knee, leg.foot]), f.rig.arms[1].weapon];
  for (let combo = 0; combo < 4; combo++) {
    const snapshot = (index, phase) => {
      poseCharacter(f.rig, {state: 'attack', combo: index, phase,
        time: phase * getReviewedAttack(ID, index).duration, attackCarry: 0,
        immediate: true, transition: false});
      f.rig.group.updateMatrixWorld(true);
      return nodes.map(node => ({position: world(node), quaternion: worldQuaternion(node)}));
    };
    const finish = snapshot(combo, 1), next = snapshot((combo + 1) % 4, 0);
    for (let joint = 0; joint < nodes.length; joint++) {
      assert.ok(finish[joint].position.distanceTo(next[joint].position) < .015,
        `combo ${combo + 1}: ${nodes[joint].name} jumps between its real carry endpoints`);
      assert.ok(degrees(finish[joint].quaternion.angleTo(next[joint].quaternion)) < 3,
        `combo ${combo + 1}: ${nodes[joint].name} rotates abruptly into the next attack`);
    }
  }
});

test('great hammer real head and hand volumes retain clearance throughout idle and running gait', () => {
  for (const state of ['idle', 'run']) {
    const f = fixture();
    let previous;
    for (let frame = 0; frame <= 180; frame++) {
      const time = frame / 60;
      poseCharacter(f.rig, {state, time, dt: 1 / 60, speed: state === 'run' ? 1 : 0,
        moveBlend: state === 'run' ? 1 : 0, gaitPhase: time * Math.PI * 4,
        immediate: true, transition: false});
      const context = `hammer ${state}, frame ${frame}`;
      const current = checkPhysical(f, context);
      previous = checkContinuity(f, current, previous, context);
    }
  }
});

for (let combo = 0; combo < 4; combo++) {
  test(`great hammer strike ${combo + 1}: idle/run entry and cancellation keep the complete head and real hand volumes clear`, () => {
    for (const state of ['idle', 'run']) {
      for (const exitPhase of [.5, 1]) {
        const f = fixture(), action = getReviewedAttack(ID, combo);
        let time = 0, previous;
        const pose = args => {
          poseCharacter(f.rig, {...args, time, dt: 1 / 60});
          const context = `hammer ${combo + 1}, ${state} entry/exit, ${args.state}, t=${time.toFixed(4)}`;
          const current = checkPhysical(f, context);
          previous = checkContinuity(f, current, previous, context);
          time += 1 / 60;
        };
        const travel = {state, speed: state === 'run' ? 1 : 0, moveBlend: state === 'run' ? 1 : 0};
        for (let frame = 0; frame < 12; frame++) pose({...travel, gaitPhase: time * Math.PI * 4});
        for (let frame = 0; frame <= Math.ceil(action.duration * exitPhase * 60); frame++) {
          pose({state: 'attack', combo, phase: Math.min(exitPhase, frame / (action.duration * 60))});
        }
        for (let frame = 0; frame < 12; frame++) pose({...travel, gaitPhase: time * Math.PI * 4});
      }
    }
  });
}
