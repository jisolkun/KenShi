import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCharacter, poseCharacter} from '../src/characters.js';
import {getWeapon, isWeaponUnlocked} from '../src/weapons.js';
import {getReviewedAttack, sampleReviewedAttack} from '../src/choreography/index.js';
import {bladeSweepContains} from '../src/weaponCombat.js';

const ID = 'great-dao';
const EPSILON = 1e-5;
const world = node => node.getWorldPosition(new THREE.Vector3());
const degrees = radians => THREE.MathUtils.radToDeg(radians);
const worldQuaternion = node => node.getWorldQuaternion(new THREE.Quaternion());

function fixture() {
  const rig = createCharacter('hero');
  rig.setWeapon(ID);
  assert.equal(rig.weaponId, ID, 'equipping the great dao must not fall back to another weapon');
  return rig;
}

function checkHilt(rig, context) {
  rig.group.updateMatrixWorld(true);
  assert.ok(rig.offhandGrip?.isObject3D, `${context}: a physical rear grip marker exists`);
  assert.equal(rig.arms[0].weapon.visible, false, `${context}: the support hand carries no second blade`);
  const primary = world(rig.arms[1].wrist);
  const support = world(rig.offhandGrip);
  assert.ok(world(rig.arms[0].wrist).distanceTo(support) < EPSILON, `${context}: the support palm leaves the hilt`);
  assert.ok(Math.abs(primary.distanceTo(support) - .22) < EPSILON, `${context}: the hands must fit the actual long hilt`);
  const blades = rig.weaponBlades();
  assert.equal(blades.length, 1, `${context}: exactly one physical blade`);
  const toTip = blades[0].tip.clone().sub(primary);
  const toSupport = support.clone().sub(primary);
  assert.ok(Math.abs(toTip.length() - 1.509) < EPSILON, `${context}: the damage tip matches the rendered great dao length`);
  assert.ok(toSupport.clone().cross(toTip).length() < EPSILON, `${context}: both hands lie on the rigid shaft`);
  assert.ok(toSupport.dot(toTip) < 0, `${context}: the support hand holds behind the primary hand`);
}

function checkBoots(rig, context, requireSupport = false) {
  rig.group.updateMatrixWorld(true);
  const ankleHeights = [];
  const soles = rig.legs.map((leg, index) => {
    const ankle = world(leg.foot);
    ankleHeights.push(ankle.y);
    const length = leg.knee.position.length() + leg.foot.position.length();
    assert.ok(ankle.distanceTo(world(leg.hip)) <= length + EPSILON, `${context}: leg ${index} cannot reach its foot`);
    const bottom = new THREE.Box3().setFromObject(leg.foot, true).min.y;
    assert.ok(bottom >= -EPSILON, `${context}: boot ${index} penetrates the floor by ${-bottom}m`);
    return bottom;
  });
  if (requireSupport) {
    // The retained character boot sits 6.5mm above the floor when its authored
    // ankle target is .075m. Allow that mesh clearance, while requiring an
    // actual planted ankle and keeping the visible sole within a centimeter.
    assert.ok(Math.min(...ankleHeights.map(height => Math.abs(height - .075))) < EPSILON,
      `${context}: the weighted attack loses both support ankles`);
    assert.ok(Math.min(...soles) < .01, `${context}: the weighted attack loses both support soles`);
  }
}

test('great dao is selectable and its four escalating cuts end with the strongest heavy chop', () => {
  const weapon = getWeapon(ID);
  assert.equal(weapon.id, ID);
  assert.equal(weapon.name, '大刀');
  assert.equal(weapon.grip, 'twohand');
  assert.equal(isWeaponUnlocked(ID), true);
  assert.equal(weapon.moves.length, 4);
  assert.ok(!weapon.skillNames?.length, 'adding the great dao does not restore active skills');
  for (let combo = 0; combo < 4; combo++) {
    const action = getReviewedAttack(ID, combo);
    assert.ok(action, `great dao strike ${combo + 1} has authored motion`);
    assert.ok(['cut', 'chop'].includes(action.kind), `${combo}: no point-first attack`);
    assert.ok(action.contacts.length > 0);
    assert.ok(action.contacts.every(contact => ['cut', 'chop'].includes(contact.kind)), `${combo}: every contact cuts with the edge`);
    assert.ok(!['thrust', 'radial'].includes(weapon.moves[combo].shape), `${combo}: no thrust or invisible circular strike`);
    assert.equal(action.supportDistance, .22);
    assert.equal(action.tipLength, 1.509);
    assert.equal(getReviewedAttack(ID, combo, 'skill'), null);
  }
  assert.equal(getReviewedAttack(ID, 3).kind, 'chop', 'the chain resolves into a heavy descending edge cut');
  const earlier = weapon.moves.slice(0, 3), finisher = weapon.moves[3];
  for (const field of ['damage', 'knockback', 'hitstop']) {
    assert.ok(finisher[field] > Math.max(...earlier.map(move => move[field])), `the finisher must have the greatest ${field}`);
  }
});

// Damage coverage comes from the rendered heel-to-tip sweep. An authored reach
// number or decorative slash ring cannot substitute for striking these enemies.
for (const combo of [0, 2]) {
  test(`great dao sweep ${combo + 1} physically strikes enemies across both forward flanks`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    const targets = [-60, 0, 60].map(angle => ({
      x: Math.sin(angle * Math.PI / 180) * 1.4,
      z: Math.cos(angle * Math.PI / 180) * 1.4,
      minY: .18, maxY: 1.85,
    }));
    const hit = new Set();
    const phases = new Set(action.contacts.flatMap(contact => [contact.start, contact.phase, contact.end]));
    for (let frame = 0; frame <= Math.ceil(action.duration * 60); frame++) phases.add(Math.min(1, frame / (action.duration * 60)));
    let previous = null;
    for (const phase of [...phases].sort((a, b) => a - b)) {
      poseCharacter(rig, {state: 'attack', combo, phase, time: phase * action.duration,
        dt: 1 / 60, immediate: true, transition: false});
      if (!action.contacts.some(contact => phase >= contact.start && phase <= contact.end)) {
        previous = null;
        continue;
      }
      const blade = rig.weaponBlades()[0];
      targets.forEach((target, index) => {
        if (bladeSweepContains(blade, previous, target, .22, action.width / 2)) hit.add(index);
      });
      for (const target of [{x: 0, z: 4}, {x: 4, z: 0}, {x: 0, z: -4}, {x: 0, z: 1, minY: 4, maxY: 5}]) {
        assert.equal(bladeSweepContains(blade, previous, target, .22, action.width / 2), false,
          `strike ${combo + 1} must not damage an enemy outside its physical blade path`);
      }
      if (combo === 0) assert.equal(bladeSweepContains(blade, previous, {x: 0, z: -1.4}, .22, action.width / 2), false,
        'the first forward sweep must not gain invisible damage behind the character');
      previous = blade;
    }
    assert.deepEqual([...hit].sort(), [0, 1, 2], 'left, center and right enemies must each meet the actual cutting blade');
  });

  for (const rate of [60, 120]) {
    test(`great dao sweep ${combo + 1} physically reaches all forward flanks on an unassisted ${rate} Hz frame grid`, () => {
      const rig = fixture(), action = getReviewedAttack(ID, combo);
      const targets = [-60, 0, 60].map(angle => ({
        x: Math.sin(angle * Math.PI / 180) * 1.4,
        z: Math.cos(angle * Math.PI / 180) * 1.4,
        minY: .18, maxY: 1.85,
      }));
      const hit = new Set();
      let previous = null;
      // The runtime cannot insert an ideal contact pose between display
      // frames. Exercise only its regular frame times, including no authored
      // start/contact/end phases, so faster cuts still hit all three lanes.
      for (let frame = 0; frame <= Math.floor(action.duration * rate); frame++) {
        const time = frame / rate, phase = time / action.duration;
        poseCharacter(rig, {state: 'attack', combo, phase, time,
          dt: 1 / rate, immediate: true, transition: false});
        if (!action.contacts.some(contact => phase >= contact.start && phase <= contact.end)) {
          previous = null;
          continue;
        }
        const blade = rig.weaponBlades()[0];
        targets.forEach((target, index) => {
          if (bladeSweepContains(blade, previous, target, .22, action.width / 2)) hit.add(index);
        });
        previous = blade;
      }
      assert.deepEqual([...hit].sort(), [0, 1, 2],
        `${rate} Hz frames must hit left, center and right with the physical blade`);
    });
  }
}

test('great dao completes its four-cut chain in 2.2–2.4 seconds with a long load before each release', () => {
  const actions = Array.from({length: 4}, (_, combo) => getReviewedAttack(ID, combo));
  const duration = actions.reduce((sum, action) => sum + action.duration, 0);
  assert.ok(duration >= 2.2 && duration <= 2.4, `four-cut chain lasts ${duration}s`);
  actions.forEach((action, combo) => {
    const release = action.swing[0];
    assert.ok(release >= .45 && release <= .55 + EPSILON,
      `strike ${combo + 1} must spend 45–55% of its duration loading, got ${release * 100}%`);
    assert.equal(action.width, .22, `strike ${combo + 1} cannot enlarge the physical cutting collision width`);
    assert.ok(!['radial', 'thrust'].includes(getWeapon(ID).moves[combo].shape),
      `strike ${combo + 1} must preserve edge-sweep collision`);
  });
});

for (let combo = 0; combo < 4; combo++) {
  test(`great dao strike ${combo + 1} lowers and tips the body while a real grounded step drives the cut`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    const heights = [], turns = [], tilts = [], feet = [[], []];
    for (let frame = 0; frame <= 240; frame++) {
      const phase = frame / 240;
      poseCharacter(rig, {state: 'attack', combo, phase, time: phase * action.duration,
        attackCarry: 0, immediate: true, transition: false});
      rig.group.updateMatrixWorld(true);
      heights.push(world(rig.body).y);
      turns.push(rig.body.rotation.y);
      tilts.push(Math.max(Math.abs(rig.body.rotation.x), Math.abs(rig.body.rotation.z)));
      rig.legs.forEach((leg, side) => feet[side].push(world(leg.foot)));
      checkBoots(rig, `whole-body strike ${combo + 1}, phase ${phase.toFixed(4)}`, true);
    }
    assert.ok(Math.max(...heights) - Math.min(...heights) > .06,
      `strike ${combo + 1}: the pelvis must visibly sink by more than 6cm`);
    assert.ok(Math.max(...turns) - Math.min(...turns) > .7,
      `strike ${combo + 1}: the waist must turn through a substantial arc`);
    assert.ok(Math.max(...tilts) > .08,
      `strike ${combo + 1}: the heavy blade must also pull the body forward or sideways`);
    const travel = feet.map(positions => Math.max(...positions.map(position =>
      Math.hypot(position.x - positions[0].x, position.z - positions[0].z))));
    assert.ok(Math.max(...travel) > .18,
      `strike ${combo + 1}: a rendered ankle must take a real step beyond 18cm, got ${Math.max(...travel)}m`);
  });

  test(`great dao strike ${combo + 1} accelerates its actual tip through the center and reaches its approach target`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    const target = {x: 0, z: action.reach, minY: .18, maxY: 1.85};
    let previous, loadDistance = 0, loadTime = 0, centerDistance = 0, centerTime = 0, hit = false;
    for (let frame = 0; frame <= Math.ceil(action.duration * 480); frame++) {
      const time = Math.min(action.duration, frame / 480), phase = time / action.duration;
      poseCharacter(rig, {state: 'attack', combo, phase, time,
        attackCarry: 0, immediate: true, transition: false});
      const blade = rig.weaponBlades()[0];
      if (previous && time > previous.time) {
        const dt = time - previous.time, distance = blade.tip.distanceTo(previous.blade.tip);
        if (phase <= action.swing[0]) { loadDistance += distance; loadTime += dt; }
        if (Math.abs(time - action.contact * action.duration) <= .05) {
          centerDistance += distance; centerTime += dt;
        }
      }
      const active = action.contacts.some(contact => phase >= contact.start && phase <= contact.end);
      if (active && bladeSweepContains(blade, previous?.active ? previous.blade : null,
        target, .22, .22 / 2)) hit = true;
      previous = {blade, time, active};
    }
    assert.ok(loadTime > .2 && centerTime > .09, 'measure both the long load and the actual central cutting burst');
    const loadSpeed = loadDistance / loadTime, centerSpeed = centerDistance / centerTime;
    assert.ok(centerSpeed > loadSpeed * 2.5,
      `strike ${combo + 1}: central tip speed ${centerSpeed}m/s must exceed loading speed ${loadSpeed}m/s by 2.5×`);
    assert.equal(hit, true,
      `strike ${combo + 1}: an enemy at the ${action.reach}m approach reach must meet the actual cutting blade`);
  });
}

for (const combo of [0, 2]) {
  test(`great dao sweep ${combo + 1} carries the physical shaft through the forward center within 120ms`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    const centerTimes = [];
    for (let frame = 0; frame <= Math.ceil(action.duration * 480); frame++) {
      const time = Math.min(action.duration, frame / 480), phase = time / action.duration;
      if (phase < action.swing[0] || phase > action.swing[1]) continue;
      poseCharacter(rig, {state: 'attack', combo, phase, time,
        attackCarry: 0, immediate: true, transition: false});
      const axis = rig.weaponBlades()[0].tip.clone().sub(world(rig.arms[1].wrist));
      if (axis.z > 0 && Math.abs(Math.atan2(axis.x, axis.z)) <= Math.PI / 4) centerTimes.push(time);
    }
    assert.ok(centerTimes.length > 2, 'the real blade traverses the central forward arc');
    const duration = centerTimes.at(-1) - centerTimes[0];
    assert.ok(duration > 1 / 60 && duration <= .12,
      `strike ${combo + 1}: crossing the forward ±45° arc takes ${duration}s`);
  });
}

test('great dao carries body, chest, hands and ankles directly across its three combo joins', () => {
  const rig = fixture();
  const snapshot = (combo, phase) => {
    const action = getReviewedAttack(ID, combo);
    poseCharacter(rig, {state: 'attack', combo, phase, time: phase * action.duration,
      attackCarry: 0, immediate: true, transition: false});
    rig.group.updateMatrixWorld(true);
    const nodes = [rig.body, rig.chest, ...rig.arms.map(arm => arm.wrist), ...rig.legs.map(leg => leg.foot)];
    return nodes.map(node => ({position: world(node), quaternion: worldQuaternion(node)}));
  };
  const initial = snapshot(0, 0);
  for (let combo = 0; combo < 3; combo++) {
    const end = snapshot(combo, 1), next = snapshot(combo + 1, 0);
    const labels = ['body', 'chest', 'support palm', 'primary palm', 'left ankle', 'right ankle'];
    end.forEach((pose, index) => {
      assert.ok(pose.position.distanceTo(next[index].position) < EPSILON,
        `join ${combo + 1}→${combo + 2}: ${labels[index]} must retain its exact physical position`);
      assert.ok(pose.quaternion.angleTo(next[index].quaternion) < EPSILON,
        `join ${combo + 1}→${combo + 2}: ${labels[index]} must retain its exact physical orientation`);
    });
    assert.ok(end[0].quaternion.angleTo(initial[0].quaternion) > .08 ||
      end[1].quaternion.angleTo(initial[1].quaternion) > .08,
    `strike ${combo + 1} must carry its waist/chest follow-through into the next cut`);
    assert.ok(end.slice(4).some((pose, side) => Math.hypot(
      pose.position.x - initial[side + 4].position.x,
      pose.position.z - initial[side + 4].position.z) > .04),
    `strike ${combo + 1} must carry its stepped stance into the next cut`);
  }
});

for (let combo = 0; combo < 4; combo++) {
  test(`great dao strike ${combo + 1} visibly loads, accelerates through the edge contact and brakes before recovery`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    const [start, end] = action.active;
    const [release, finish] = action.swing;
    const speeds = {windup: [], chamber: [], strike: [], brake: []};
    let previous;
    // Measure the physical tip instead of trusting a named easing curve. A
    // uniform-speed sword flourish cannot satisfy a held chamber and release.
    for (let frame = 0; frame <= Math.ceil(action.duration * 240); frame++) {
      const phase = Math.min(1, frame / (action.duration * 240));
      const time = phase * action.duration;
      poseCharacter(rig, {state: 'attack', combo, phase, time, immediate: true, transition: false});
      const tip = rig.weaponBlades()[0].tip;
      if (previous && time > previous.time) {
        const speed = tip.distanceTo(previous.tip) / (time - previous.time);
        // Contact windows begin once the edge has accelerated and end before
        // it stops. The visible chamber/brake belong to the full swing bounds.
        if (phase < release - .045) speeds.windup.push(speed);
        if (phase >= release - .045 && phase <= release) speeds.chamber.push(speed);
        if (phase >= start && phase <= end) speeds.strike.push(speed);
        if (phase >= finish && phase <= finish + .05) speeds.brake.push(speed);
      }
      previous = {tip, time};
    }
    for (const [segment, values] of Object.entries(speeds)) assert.ok(values.length > 2, `${segment} must last long enough to be visible`);
    const peak = Math.max(...speeds.strike);
    assert.ok(peak > Math.max(...speeds.windup) * 1.5, 'the weighted edge visibly accelerates out of the windup');
    assert.ok(Math.max(...speeds.chamber) < peak * .2, 'the chamber holds the blade before committing the body to the swing');
    assert.ok(Math.max(...speeds.brake) < peak * .25, 'the swing slows into its heavy follow-through before returning to carry');
  });

  test(`great dao strike ${combo + 1} keeps both palms on the hilt and a boot planted through windup, contact and recovery`, () => {
    const rig = fixture(), action = getReviewedAttack(ID, combo);
    for (let frame = 0; frame <= Math.ceil(action.duration * 60); frame++) {
      const phase = Math.min(1, frame / (action.duration * 60));
      poseCharacter(rig, {state: 'attack', combo, phase, time: frame / 60,
        attackCarry: 0, dt: 1 / 60, immediate: true, transition: false});
      const context = `strike ${combo + 1}, phase ${phase.toFixed(4)}`;
      checkHilt(rig, context);
      checkBoots(rig, context, true);
    }
  });

  test(`great dao strike ${combo + 1} has no hidden trajectory seams between rendered frames`, () => {
    let previous;
    // Fine sampling exposes an abrupt shaft projection or pole switch that a
    // single 60 Hz contact pose can miss. These limits permit a fast real cut.
    for (let frame = 0; frame <= 1920; frame++) {
      const phase = frame / 1920, sample = sampleReviewedAttack(ID, combo, phase);
      assert.ok(sample, 'great dao must be present in the reviewed sampler');
      if (previous) sample.hands.forEach((hand, side) => {
        const jump = new THREE.Vector3(...hand.grip).distanceTo(new THREE.Vector3(...previous.hands[side].grip));
        const turn = degrees(new THREE.Quaternion().fromArray(hand.quaternion).angleTo(new THREE.Quaternion().fromArray(previous.hands[side].quaternion)));
        assert.ok(jump < .01, `strike ${combo + 1}, hand ${side}, phase ${phase}: ${jump}m trajectory jump`);
        assert.ok(turn < 2, `strike ${combo + 1}, hand ${side}, phase ${phase}: ${turn}° shaft snap`);
      });
      previous = sample;
    }
  });
}

test('great dao finisher brings the actual high chamber down through enemy height into a low follow-through', () => {
  const rig = fixture(), action = getReviewedAttack(ID, 3);
  const [start, end] = action.active;
  const tips = [], verticalSpeeds = [];
  for (let frame = 0; frame <= 120; frame++) {
    const phase = start + (end - start) * frame / 120;
    poseCharacter(rig, {state: 'attack', combo: 3, phase, time: phase * action.duration,
      immediate: true, transition: false});
    const tip = rig.weaponBlades()[0].tip;
    if (tips.length) verticalSpeeds.push((tip.y - tips.at(-1).y) / ((end - start) * action.duration / 120));
    tips.push(tip);
    if (frame === 0) assert.ok(tip.y > world(rig.head).y + .4, 'the heavy chop starts visibly over the head');
  }
  const first = tips[0], last = tips.at(-1);
  assert.ok(first.y - last.y > 1.2, 'the actual cutting tip must descend through a substantial enemy-height range');
  assert.ok(Math.min(...verticalSpeeds) < -5, 'the falling edge builds a forceful downward velocity');
  assert.ok(last.y < .8 && last.y >= .05, 'the edge follows through low while clearing the floor');
  assert.ok(tips.some(tip => tip.y >= .8 && tip.y <= 1.8 && tip.z > 1), 'the falling blade physically crosses the forward enemy space');
});

test('great dao idle/run entry, chained strikes and cancellation/recovery retain the physical two-hand grip and clear boots', () => {
  for (const opening of ['idle', 'run']) {
    for (const exitPhase of [.5, 1]) {
      const rig = fixture();
      let time = 0;
      const pose = args => {
        poseCharacter(rig, {...args, time, dt: 1 / 60});
        const context = `${opening}, ${args.state} ${args.combo ?? 0}, time ${time.toFixed(3)}`;
        checkHilt(rig, context);
        checkBoots(rig, context);
        time += 1 / 60;
      };
      const travel = {state: opening, speed: opening === 'run' ? 1 : 0, moveBlend: opening === 'run' ? 1 : 0};
      // Cover full breathing and gait cycles before entering the actual blend.
      for (let frame = 0; frame < 120; frame++) pose({...travel, gaitPhase: frame / 60 * Math.PI * 4});
      for (let combo = 0; combo < 4; combo++) {
        const action = getReviewedAttack(ID, combo);
        for (let frame = 0; frame <= Math.ceil(action.duration * exitPhase * 60); frame++) {
          pose({state: 'attack', combo, phase: Math.min(exitPhase, frame / (action.duration * 60))});
        }
        // Real state changes include both a mid-swing cancellation and an exit
        // after full recovery. The next strike re-enters from locomotion.
        for (let frame = 0; frame < 12; frame++) pose({...travel, gaitPhase: time * Math.PI * 4});
      }
      // Also run the uninterrupted four-hit chain: every next windup blends
      // directly from the preceding recovery instead of passing through idle.
      for (let combo = 0; combo < 4; combo++) {
        const action = getReviewedAttack(ID, combo);
        for (let frame = 0; frame <= Math.ceil(action.duration * 60); frame++) {
          pose({state: 'attack', combo, phase: Math.min(1, frame / (action.duration * 60))});
        }
      }
      for (let frame = 0; frame < 12; frame++) pose({...travel, gaitPhase: time * Math.PI * 4});
    }
  }
});
