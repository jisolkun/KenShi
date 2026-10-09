import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCharacter, poseCharacter} from '../src/characters.js';
import {getReviewedAttack} from '../src/choreography/index.js';
import {GREAT_DAO_STEPS, greatDaoStepDelta, resolveGreatDaoStep} from '../src/greatDaoMovement.js';

const EPSILON = 1e-5;
const world = node => node.getWorldPosition(new THREE.Vector3());
const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// The retained idle solver's actual support ankle can be about 0.3mm below
// .075m. Keep that captured world anchor exact instead of snapping it to a
// nominal height; its visible sole still has the normal 6.5mm clearance.
const plantedAnkle = ankle => ankle.y >= .074 && ankle.y <= .076;
const anklePoses = rig => rig.legs.map(leg => ({position: world(leg.foot),
  quaternion: leg.foot.getWorldQuaternion(new THREE.Quaternion())}));
const bodyEnvelopes = rig => [
  {node: rig.chest, center: new THREE.Vector3(0, .22, 0), radius: new THREE.Vector3(.30, .33, .185)},
  {node: rig.head, center: new THREE.Vector3(0, .11, .025), radius: new THREE.Vector3(.165, .219, .156)},
];

function checkRenderedFrame(rig, previous, context) {
  const joints = [rig.body, rig.chest, rig.head,
    ...rig.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.wrist]),
    ...rig.legs.flatMap(leg => [leg.hip, leg.knee, leg.foot])];
  const quaternions = joints.map(node => node.quaternion.clone());
  const bladeQuaternion = rig.arms[1].weapon.getWorldQuaternion(new THREE.Quaternion());
  if (previous) {
    quaternions.forEach((quaternion, index) => {
      const angle = THREE.MathUtils.radToDeg(quaternion.angleTo(previous.quaternions[index]));
      assert.ok(angle < 30,
        `${context}: joint ${index} (${joints[index].name || 'unnamed'}) local quaternion turns ${angle}° between rendered frames`);
    });
    const angle = THREE.MathUtils.radToDeg(bladeQuaternion.angleTo(previous.bladeQuaternion));
    assert.ok(angle < 30, `${context}: the actual blade world quaternion turns ${angle}° between rendered frames`);
  }
  return {quaternions, bladeQuaternion};
}

function fixture(angle = 0) {
  const rig = createCharacter('hero');
  rig.setWeapon('great-dao');
  rig.group.rotation.y = angle;
  poseCharacter(rig, {state: 'idle', time: 0, speed: 0, moveBlend: 0,
    immediate: true, transition: false});
  rig.group.updateMatrixWorld(true);
  return rig;
}

function stepContext(rig, combo, options = {}) {
  return {start: {x: rig.group.position.x, z: rig.group.position.z},
    angle: rig.group.rotation.y, startPhase: 0, ...GREAT_DAO_STEPS[combo],
    footStarts: rig.legs.map(leg => world(leg.foot)),
    footRotations: rig.legs.map(leg => leg.foot.getWorldQuaternion(new THREE.Quaternion())), ...options};
}

function segmentGap(start, end, circle) {
  const dx = end.x - start.x, dz = end.z - start.z, square = dx * dx + dz * dz;
  const fraction = square ? Math.max(0, Math.min(1,
    ((circle.x - start.x) * dx + (circle.z - start.z) * dz) / square)) : 0;
  return Math.hypot(start.x + dx * fraction - circle.x, start.z + dz * fraction - circle.z);
}

function checkPhysical(rig, context, {requireSupport = true, obstacles = [], bounds = null} = {}) {
  rig.group.updateMatrixWorld(true);
  rig.group.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite),
    `${context}: ${node.name || node.type} has a nonfinite world transform`));
  const soles = [], ankles = rig.legs.map((leg, side) => {
    const ankle = world(leg.foot);
    const length = leg.knee.position.length() + leg.foot.position.length();
    assert.ok(ankle.distanceTo(world(leg.hip)) <= length + EPSILON,
      `${context}: leg ${side} cannot reach its actual ankle`);
    const sole = new THREE.Box3().setFromObject(leg.foot, true).min.y;
    assert.ok(sole >= -EPSILON, `${context}: boot ${side} penetrates the floor by ${-sole}m`);
    soles.push(sole);
    for (const obstacle of obstacles) assert.ok(horizontalDistance(ankle, obstacle) >= obstacle.radius + .22 - EPSILON,
      `${context}: foot ${side} is inside the lamp's physical foot-clearance circle`);
    if (bounds) {
      assert.ok(ankle.x >= bounds.minX + .22 - EPSILON && ankle.x <= bounds.maxX - .22 + EPSILON,
        `${context}: ankle ${side} leaves the walkable x bounds`);
      assert.ok(ankle.z >= bounds.minZ + .22 - EPSILON && ankle.z <= bounds.maxZ - .22 + EPSILON,
        `${context}: ankle ${side} leaves the walkable z bounds`);
    }
    return ankle;
  });
  if (requireSupport) {
    assert.ok(ankles.some(plantedAnkle),
      `${context}: the weighted cut loses both planted ankles`);
    assert.ok(Math.min(...soles) < .01,
      `${context}: the support sole leaves the floor beyond the retained 6.5mm mesh clearance`);
  }
  assert.ok(rig.offhandGrip?.isObject3D, `${context}: the support grip exists`);
  const primary = world(rig.arms[1].wrist), support = world(rig.offhandGrip);
  assert.ok(world(rig.arms[0].wrist).distanceTo(support) < EPSILON,
    `${context}: the support palm leaves the actual hilt`);
  assert.ok(Math.abs(primary.distanceTo(support) - .22) < EPSILON,
    `${context}: the two hands leave the rigid 22cm grip spacing`);
  const blades = rig.weaponBlades();
  assert.equal(blades.length, 1, `${context}: a single physical great dao is equipped`);
  assert.ok(Math.abs(blades[0].tip.distanceTo(primary) - 1.509) < EPSILON,
    `${context}: the rendered tip leaves its physical 1.509m length`);
  assert.ok(Math.min(blades[0].heel.y, blades[0].tip.y) >= .05 - EPSILON,
    `${context}: the heavy edge penetrates its ground clearance`);
  for (const [bodyIndex, envelope] of bodyEnvelopes(rig).entries()) {
    for (let section = 0; section <= 40; section++) {
      const local = envelope.node.worldToLocal(blades[0].heel.clone().lerp(blades[0].tip, section / 40))
        .sub(envelope.center).divide(envelope.radius);
      assert.ok(local.length() > 1,
        `${context}: the actual blade segment intersects the ${bodyIndex ? 'head' : 'torso'} envelope at section ${section}`);
    }
  }
  return ankles;
}

function runStrike(rig, combo, rate, {turn = 0, obstacles = [], bounds = null,
  targets = [], timeOffset = 0, endPhase = 1} = {}) {
  const action = getReviewedAttack('great-dao', combo), attackStep = stepContext(rig, combo, {obstacles, bounds});
  const lead = combo % 2, rear = 1 - lead;
  const anchors = new Map(), counts = new Map(), history = [];
  let previousPhase = 0, previousFeet, previousRendered;
  for (let frame = 0; frame <= Math.ceil(action.duration * endPhase * rate); frame++) {
    const phase = Math.min(endPhase, frame / (action.duration * rate));
    // The root consumes the same frame-to-frame phase delta as gameplay. No
    // ideal lift, landing or contact phase is inserted into the frame grid.
    const angle = attackStep.angle + turn * phase;
    const stride = greatDaoStepDelta(combo, previousPhase, phase);
    const displacement = {x: Math.sin(angle) * stride.forward + Math.cos(angle) * stride.lateral,
      z: Math.cos(angle) * stride.forward - Math.sin(angle) * stride.lateral};
    const resolved = resolveGreatDaoStep(rig.group.position, displacement, {obstacles, bounds, targets});
    rig.group.position.set(resolved.x, 0, resolved.z);
    rig.group.rotation.y = angle;
    const time = timeOffset + phase * action.duration;
    poseCharacter(rig, {state: 'attack', combo, phase, time, dt: 1 / rate,
      attackStep, attackCarry: .65, speed: .65, gaitPhase: time * Math.PI * 3,
      immediate: true, transition: false});
    const context = `cut ${combo + 1}, ${rate} Hz, phase ${phase.toFixed(4)}, turn ${turn}`;
    const feet = checkPhysical(rig, context, {obstacles, bounds});
    // The first attack pose begins a new state. Measure the regular rendered
    // attack frames against each other, retaining the original 30° limit for
    // all 15 joints and for the actual world-space weapon orientation.
    previousRendered = checkRenderedFrame(rig, previousRendered, context);
    for (const [window, side, supported] of [
      ['rear during leading step', rear, phase <= .32],
      ['lead after landing', lead, phase >= .30],
      ['rear after gathering', rear, phase >= .76],
    ]) {
      if (!supported) continue;
      const quaternion = rig.legs[side].foot.getWorldQuaternion(new THREE.Quaternion());
      if (!anchors.has(window)) anchors.set(window, {position: feet[side].clone(), quaternion: quaternion.clone()});
      assert.ok(feet[side].distanceTo(anchors.get(window).position) < EPSILON,
        `${context}: ${window} slides in world space`);
      assert.ok(quaternion.angleTo(anchors.get(window).quaternion) < EPSILON,
        `${context}: ${window} rotates around its world-space support anchor`);
      assert.ok(plantedAnkle(feet[side]),
        `${context}: ${window} is not actually planted`);
      counts.set(window, (counts.get(window) || 0) + 1);
    }
    if (previousFeet) feet.forEach((foot, side) => {
      for (const obstacle of obstacles) assert.ok(segmentGap(previousFeet[side], foot, obstacle) >= obstacle.radius + .22 - EPSILON,
        `${context}: foot ${side} tunnels through the lamp between rendered frames`);
    });
    history.push({phase, feet: feet.map(foot => foot.clone()), root: rig.group.position.clone()});
    previousFeet = feet.map(foot => foot.clone());
    previousPhase = phase;
  }
  if (endPhase === 1) for (const window of ['rear during leading step', 'lead after landing', 'rear after gathering']) {
    assert.ok(counts.get(window) >= 3, `${window} must be exercised for multiple actual rendered frames`);
  }
  const leadTravel = Math.max(...history.map(frame => horizontalDistance(frame.feet[lead], attackStep.footStarts[lead])));
  const rootTravel = horizontalDistance(rig.group.position, attackStep.start);
  return {attackStep, leadTravel, rootTravel, history, duration: action.duration};
}

for (let combo = 0; combo < 4; combo++) {
  for (const rate of [60, 120]) {
    for (const turn of [0, .18]) {
      test(`great dao cut ${combo + 1}, ${rate} Hz, turn=${turn}: actual world support anchors survive root travel`, () => {
        const rig = fixture(.37);
        const result = runStrike(rig, combo, rate, {turn});
        assert.ok(result.leadTravel > .18,
          `the leading ankle must take an actual world-space step, got ${result.leadTravel}m`);
        const planned = Math.hypot(GREAT_DAO_STEPS[combo].forward, GREAT_DAO_STEPS[combo].lateral);
        assert.ok(result.rootTravel > planned * .95, 'the unobstructed character truly advances its world root');
        assert.ok(result.history.some(frame => frame.phase > .06 && frame.phase < .30 &&
          frame.feet[combo % 2].y > .105), 'the advancing lead foot visibly lifts before landing');
        assert.ok(result.history.some(frame => frame.phase > .32 && frame.phase < .76 &&
          frame.feet[1 - combo % 2].y > .095), 'the rear foot lifts and gathers after weight transfers');
      });
    }
  }

  test(`great dao cut ${combo + 1}: blocked root and feet stop at a lamp instead of spending their planned travel`, () => {
    const step = GREAT_DAO_STEPS[combo], planned = Math.hypot(step.forward, step.lateral);
    const obstacles = [{x: step.lateral / planned * .82, z: step.forward / planned * .82, radius: .28}];
    const unblocked = runStrike(fixture(), combo, 60);
    const blocked = runStrike(fixture(), combo, 60, {obstacles});
    assert.ok(blocked.rootTravel < planned * .7, 'the lamp clips the actual world root well before its full step budget');
    assert.ok(blocked.leadTravel < unblocked.leadTravel * .8,
      'a blocked leading foot must shorten its real step with the stopped root');
    assert.ok(blocked.history.at(-1).feet.every(plantedAnkle),
      'the shortened step still finishes with both feet planted');
  });
}

test('great dao foot targets remain inside the arena when the real root is clipped at its edge', () => {
  const bounds = {minX: -3, maxX: 3, minZ: -3, maxZ: 1.02};
  const rig = fixture(), result = runStrike(rig, 3, 120, {bounds});
  assert.ok(result.rootTravel < Math.hypot(GREAT_DAO_STEPS[3].forward, GREAT_DAO_STEPS[3].lateral) * .8,
    'the arena edge reduces the actual root travel');
});

test('great dao feet shorten their step when a nearby combat target prevents the planned root advance', () => {
  const combo = 3, targets = [{x: 0, z: 1.22, radius: .45}];
  const unblocked = runStrike(fixture(), combo, 60);
  const blocked = runStrike(fixture(), combo, 60, {targets});
  assert.ok(blocked.rootTravel < unblocked.rootTravel * .6, 'the target stop gap limits actual root advance');
  assert.ok(blocked.leadTravel < unblocked.leadTravel * .8,
    'the feet use the stopped root displacement rather than reaching for the full planned lunge');
});

for (const rate of [60, 120]) {
  test(`great dao uninterrupted chain at ${rate} Hz keeps both real ankle positions and orientations across all joins`, () => {
    const rig = fixture(.29);
    let time = 0;
    for (let combo = 0; combo < 4; combo++) {
      const previousFeet = anklePoses(rig), attackStep = stepContext(rig, combo);
      poseCharacter(rig, {state: 'attack', combo, phase: 0, time, dt: 1 / rate,
        attackStep, attackCarry: .65, speed: .65, immediate: true, transition: false});
      const nextFeet = anklePoses(rig);
      if (combo > 0) nextFeet.forEach((pose, side) => {
        assert.ok(pose.position.distanceTo(previousFeet[side].position) < EPSILON,
          `join ${combo}→${combo + 1}: ankle ${side} teleports in world space`);
        assert.ok(pose.quaternion.angleTo(previousFeet[side].quaternion) < EPSILON,
          `join ${combo}→${combo + 1}: boot ${side} snaps its world orientation`);
      });
      const result = runStrike(rig, combo, rate, {timeOffset: time, turn: .10});
      time += result.duration;
    }
    assert.ok(horizontalDistance(rig.group.position, {x: 0, z: 0}) > 1.8,
      'four chained attacks accumulate real world travel instead of returning the root to its start');
  });
}

for (const cancelPhase of [.20, .52, .82]) {
  test(`great dao cancellation at phase ${cancelPhase} releases foot anchors into real navigation gait`, () => {
    const rig = fixture();
    const result = runStrike(rig, 0, 60, {endPhase: cancelPhase});
    const before = anklePoses(rig), origin = rig.group.position.clone();
    let lifted = false, legMotion = 0;
    const initialHip = rig.legs[0].hip.quaternion.clone();
    for (let frame = 1; frame <= 48; frame++) {
      const elapsed = frame / 60, distance = elapsed * 3.2;
      rig.group.position.set(origin.x, 0, origin.z + distance);
      poseCharacter(rig, {state: 'run', time: result.duration * cancelPhase + elapsed,
        attackStep: null, speed: .7, moveBlend: 1, gaitPhase: distance * Math.PI * 2 / 2.285,
        dt: 1 / 60});
      const feet = checkPhysical(rig, `cancel ${cancelPhase}, navigation frame ${frame}`, {requireSupport: false});
      lifted ||= feet.some(foot => foot.y > .105);
      legMotion = Math.max(legMotion, rig.legs[0].hip.quaternion.angleTo(initialHip));
    }
    assert.ok(lifted, 'navigation resumes a visible lifted gait instead of retaining attack anchors');
    assert.ok(legMotion > .1, 'the legs articulate during real navigation');
    assert.ok(anklePoses(rig).some((pose, side) => horizontalDistance(pose.position, before[side].position) > .8),
      'the feet actually follow the navigating root after cancellation');
  });
}

for (let combo = 0; combo < 4; combo++) {
  for (const cancelPhase of [.20, .52, .82]) {
    for (const rate of [60, 120]) {
      test(`great dao cut ${combo + 1}, phase ${cancelPhase}, ${rate} Hz: clearing attackStep during the same attack blends into travelling feet`, () => {
        const rig = fixture(.37), reference = fixture(.37);
        const result = runStrike(rig, combo, rate, {endPhase: cancelPhase});
        const before = anklePoses(rig), origin = rig.group.position.clone();
        const pace = 3.2 / 5.8, cycleDistance = .85 + 2.05 * pace;
        const direction = new THREE.Vector3(Math.sin(.37), 0, Math.cos(.37));
        let previousRendered = checkRenderedFrame(rig, null, `same-state cancellation ${combo + 1}`);
        // Gameplay clears attackStep while retaining state='attack' during
        // recovery. A locomotion state-change test cannot exercise this
        // separate mode transition, especially once action phase exceeds .32.
        for (let frame = 1; frame <= Math.ceil(.14 * rate); frame++) {
          const elapsed = frame / rate, distance = elapsed * 3.2;
          const phase = Math.min(.995, cancelPhase + elapsed / result.duration);
          rig.group.position.copy(origin).addScaledVector(direction, distance);
          const pose = {state: 'attack', combo, phase, attackStep: null,
            attackCarry: pace, speed: pace, time: cancelPhase * result.duration + elapsed,
            gaitPhase: distance * Math.PI * 2 / cycleDistance, dt: 1 / rate};
          poseCharacter(rig, pose);
          const context = `same cut ${combo + 1}, cancel ${cancelPhase}, ${rate} Hz navigation frame ${frame}`;
          const feet = checkPhysical(rig, context, {requireSupport: false});
          previousRendered = checkRenderedFrame(rig, previousRendered, context);
          if (frame === 1) feet.forEach((foot, side) => {
            assert.ok(foot.distanceTo(before[side].position) <= distance + EPSILON,
              `${context}: releasing foot ${side} adds a pose jump beyond the real single-frame root advance`);
          });
          if (elapsed >= .13) {
            reference.group.position.copy(rig.group.position);
            reference.group.rotation.copy(rig.group.rotation);
            poseCharacter(reference, {...pose, immediate: true, transition: false});
            const expected = anklePoses(reference);
            feet.forEach((foot, side) => assert.ok(foot.distanceTo(expected[side].position) < EPSILON,
              `${context}: the 100ms mode blend must finish in the actual independent travelling foot pose`));
          }
        }
        assert.ok(horizontalDistance(rig.group.position, origin) > .4,
          'the recovering attack continues actual navigation while its foot mode changes');
      });
    }
  }
}

test('great dao attackStep=null retains the independent carry gait instead of freezing attack feet', () => {
  const rig = fixture(), feet = [[], []];
  for (let frame = 0; frame <= 120; frame++) {
    const time = frame / 60;
    poseCharacter(rig, {state: 'attack', combo: 1, phase: .90, time, dt: 1 / 60,
      attackStep: null, attackCarry: 1, speed: 1, gaitPhase: time * Math.PI * 2,
      immediate: true, transition: false});
    const ankles = checkPhysical(rig, `unstepped travelling attack frame ${frame}`, {requireSupport: false});
    ankles.forEach((ankle, side) => feet[side].push(ankle));
  }
  feet.forEach((positions, side) => {
    assert.ok(Math.max(...positions.map(foot => foot.y)) > .13,
      `unstepped ankle ${side} must retain its lifted carry gait`);
    assert.ok(Math.max(...positions.map(foot => foot.z)) - Math.min(...positions.map(foot => foot.z)) > .25,
      `unstepped ankle ${side} must retain a substantial independent stride`);
  });
});

for (let combo = 0; combo < 4; combo++) {
  for (const rate of [60, 120]) {
    test(`great dao cut ${combo + 1}, ${rate} Hz: a travelling phase-0.4 capture keeps its real feet and consumes only future root deltas`, () => {
      const rig = fixture(.29), cycleDistance = 2.285;
      // Arrive on a genuine distance-driven run support frame. The rear foot
      // is planted while the leading foot still has its actual travelling
      // height and orientation; neither foot is replaced by a rest pose.
      const travelDistance = cycleDistance * (combo % 2 ? 1.5 : 1);
      for (let frame = 0; frame <= 60; frame++) {
        const distance = travelDistance * frame / 60;
        rig.group.position.set(Math.sin(.29) * distance, 0, Math.cos(.29) * distance);
        poseCharacter(rig, {state: 'run', time: frame / 60, speed: .7, moveBlend: 1,
          gaitPhase: distance * Math.PI * 2 / cycleDistance, dt: 1 / 60,
          immediate: true, transition: false});
        checkPhysical(rig, `mid-capture travel ${combo}, frame ${frame}`, {requireSupport: false});
      }
      const firstPhase = .40, before = anklePoses(rig), rootBefore = rig.group.position.clone();
      const attackStep = stepContext(rig, combo, {startPhase: firstPhase});
      const action = getReviewedAttack('great-dao', combo);
      poseCharacter(rig, {state: 'attack', combo, phase: firstPhase, time: 1, dt: 0,
        attackStep, attackCarry: .7, speed: .7, immediate: true, transition: false});
      const captured = anklePoses(rig);
      assert.ok(rig.group.position.distanceTo(rootBefore) < EPSILON,
        'capturing a middle attack phase must not repay the already elapsed root-travel budget');
      captured.forEach((pose, side) => {
        assert.ok(pose.position.distanceTo(before[side].position) < EPSILON,
          `cut ${combo + 1}: capturing the attack teleports ankle ${side}`);
        assert.ok(pose.quaternion.angleTo(before[side].quaternion) < EPSILON,
          `cut ${combo + 1}: capturing the attack snaps boot ${side}`);
      });
      checkPhysical(rig, `mid-capture cut ${combo + 1}, first phase`);
      let previousPhase = firstPhase;
      let previousRendered = checkRenderedFrame(rig, null, `mid-capture cut ${combo + 1}, first phase`);
      for (let frame = 1; frame <= Math.ceil((1 - firstPhase) * action.duration * rate); frame++) {
        const phase = Math.min(1, firstPhase + frame / (action.duration * rate));
        const stride = greatDaoStepDelta(combo, previousPhase, phase), angle = attackStep.angle;
        const displacement = {x: Math.sin(angle) * stride.forward + Math.cos(angle) * stride.lateral,
          z: Math.cos(angle) * stride.forward - Math.sin(angle) * stride.lateral};
        const start = rig.group.position.clone();
        const resolved = resolveGreatDaoStep(start, displacement);
        rig.group.position.set(resolved.x, 0, resolved.z);
        poseCharacter(rig, {state: 'attack', combo, phase, time: 1 + (phase - firstPhase) * action.duration,
          dt: 1 / rate, attackStep, attackCarry: .7, speed: .7,
          immediate: true, transition: false});
        if (frame === 1) {
          assert.ok(Math.abs(rig.group.position.x - start.x - displacement.x) < EPSILON &&
            Math.abs(rig.group.position.z - start.z - displacement.z) < EPSILON,
          'the first rendered attack delta uses phase 0.4 as its previous phase');
          assert.ok(horizontalDistance(rig.group.position, rootBefore) < .10,
            'the first attack frame must not insert the skipped 0→0.4 travel');
        }
        checkPhysical(rig, `mid-capture cut ${combo + 1}, ${rate} Hz frame ${frame}`);
        previousRendered = checkRenderedFrame(rig, previousRendered,
          `mid-capture cut ${combo + 1}, ${rate} Hz frame ${frame}`);
        previousPhase = phase;
      }
      const budget = Math.hypot(GREAT_DAO_STEPS[combo].forward, GREAT_DAO_STEPS[combo].lateral);
      assert.ok(horizontalDistance(rig.group.position, rootBefore) < budget * .65,
        'resuming from phase 0.4 consumes the remaining root budget, never a complete extra step');
    });
  }
}
