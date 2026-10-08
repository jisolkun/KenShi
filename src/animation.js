import * as THREE from 'three';
import { getActionClip, ENEMY_CLIPS } from './action-clips.js';

const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = THREE.MathUtils.lerp;
const damp = (a, b, rate, dt) => mix(a, b, 1 - Math.exp(-rate * dt));
const pose = (body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, rightHand) =>
  ({ body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, rightHand });

// Compact asymmetric guard: the blade protects the forward line while the
// empty hand sits near the ribs. Hip and chest wind in opposite directions.
const guard = pose([.20, -.34, -.055], [-.46, -.32, -.30], [-.22, .28, .30], [-.94, .15, -.13], [-1.22, -.14, .21],
  [0, .14, .025], [-.20, 0, -.04], [.14, 0, .04], [.38, 0, 0], [.31, 0, 0], [.48, -.05, -.17]);
const cuts = [
  { // Draw diagonally through the forward shoulder; leave the blade loaded.
    wind: pose([.10, -.90, -.12], [-.68, -.74, -.58], [-.15, .52, .43], [-1.25, .20, -.24], [-1.43, -.14, .22], [0, .29, .055], [-.28, 0, 0], [.18, 0, 0], [.46, 0, 0], [.32, 0, 0], [.56, -.10, .12]),
    hit: pose([.34, .34, .10], [-.88, .35, -1.05], [-.56, -.47, .59], [-.12, -.10, .12], [-1.06, .08, .16], [0, -.24, -.06], [.18, 0, 0], [-.48, 0, 0], [.32, 0, 0], [.51, 0, 0], [.86, -.15, -.33]),
    end: pose([.27, .87, .14], [-.52, .96, -.91], [-.36, -.64, .48], [-.35, -.21, .13], [-1.14, .05, .13], [0, -.31, -.045], [.22, 0, 0], [-.43, 0, 0], [.34, 0, 0], [.50, 0, 0], [.86, -.24, -.40]),
  },
  { // The return cut starts in the first cut's chamber, without an idle reset.
    wind: pose([.22, .83, .12], [-.56, .92, -.91], [-.33, -.53, .44], [-.47, -.21, .13], [-1.15, .07, .12], [0, -.26, -.04], [.16, 0, 0], [-.32, 0, 0], [.34, 0, 0], [.48, 0, 0], [.87, -.23, -.36]),
    hit: pose([.35, -.46, -.11], [-.89, -.43, -.66], [-.23, .52, .65], [-.10, .12, -.13], [-1.19, -.14, .18], [0, .29, .05], [-.44, 0, 0], [.20, 0, 0], [.50, 0, 0], [.31, 0, 0], [.96, .10, .26]),
    end: pose([.22, -.90, -.15], [-.86, -.97, -.31], [-.28, .60, .50], [-.69, .24, -.13], [-1.19, -.11, .17], [0, .32, .06], [-.40, 0, 0], [.22, 0, 0], [.48, 0, 0], [.34, 0, 0], [.60, .15, .28]),
  },
  { // A rising elbow turns the return chamber into a descending execution.
    wind: pose([.01, -.62, -.085], [-2.34, -.51, -.42], [-1.38, .32, .41], [-.94, .12, .07], [-1.26, -.08, .08], [0, .24, .03], [-.31, 0, 0], [.18, 0, 0], [.51, 0, 0], [.36, 0, 0], [.79, -.05, -.06]),
    hit: pose([.43, .31, .09], [-.97, .25, -.84], [-.89, -.28, .42], [-.13, -.03, .04], [-.50, -.09, .11], [0, -.19, -.04], [.23, 0, 0], [-.58, 0, 0], [.43, 0, 0], [.63, 0, 0], [.99, -.04, -.11]),
    end: pose([.40, .55, .12], [-.58, .45, -.65], [-.55, -.38, .36], [-.25, -.06, .04], [-.72, -.04, .10], [0, -.25, -.04], [.27, 0, 0], [-.53, 0, 0], [.43, 0, 0], [.57, 0, 0], [.82, -.06, -.14]),
  },
];
const overhead = {
  wind: pose([-.14, -.58, -.09], [-2.65, -.35, -.36], [-2.12, .24, .34], [-.83, .06, .08], [-1.15, -.06, -.05], [0, .23, .05], [-.30, 0, 0], [.28, 0, 0], [.60, 0, 0], [.48, 0, 0], [.79, -.04, .03]),
  hit: pose([.50, .37, .105], [-1.00, .28, -.88], [-1.01, -.22, .27], [-.10, 0, .04], [-.42, -.04, -.06], [0, -.20, -.045], [.37, 0, 0], [-.69, 0, 0], [.53, 0, 0], [.74, 0, 0], [1.05, -.03, -.09]),
  end: pose([.43, .51, .11], [-.54, .36, -.69], [-.73, -.25, .30], [-.25, 0, .03], [-.56, -.03, -.01], [0, -.25, -.04], [.36, 0, 0], [-.60, 0, 0], [.50, 0, 0], [.66, 0, 0], [.78, -.03, -.08]),
};
const finishing = {
  wind: pose([.31, -.99, -.14], [-.78, -.98, -.32], [-.27, .54, .51], [-1.26, .22, -.12], [-1.32, -.12, .18], [0, .34, .06], [-.38, 0, 0], [.27, 0, 0], [.48, 0, 0], [.38, 0, 0], [.54, .17, .22]),
  hit: pose([.44, .45, .13], [-.70, .37, -1.20], [-.64, -.50, .71], [-.09, -.14, .07], [-.76, .05, .18], [0, -.29, -.06], [.32, 0, 0], [-.66, 0, 0], [.45, 0, 0], [.67, 0, 0], [.99, -.22, -.37]),
  end: pose([.29, 1.01, .16], [-.44, .91, -.88], [-.24, -.62, .53], [-.62, -.24, .13], [-1.23, .04, .15], [0, -.34, -.05], [.19, 0, 0], [-.43, 0, 0], [.35, 0, 0], [.48, 0, 0], [.70, -.24, -.37]),
};
const bowDraw = pose([.13, -.64, .05], [-1.28, .64, -.38], [-1.47, -.49, .43], [-1.59, .15, .03], [-.10, -.12, 0], [0, .20, -.03], [-.25, 0, 0], [.16, 0, 0], [.38, 0, 0], [.31, 0, 0], [0, 0, 0]);
const frostSeal = {
  wind: pose([.12, -.64, -.10], [-.60, -.51, -.43], [-.62, .76, .44], [-1.14, .12, -.09], [-1.55, -.22, .24], [0, .24, .04], [-.26, 0, 0], [.20, 0, 0], [.42, 0, 0], [.35, 0, 0], [.65, .02, -.16]),
  hit: pose([.36, .30, .08], [-.68, -.16, -.52], [-1.51, -.37, .62], [-.64, .09, -.10], [-.08, -.05, .08], [0, -.20, -.04], [.23, 0, 0], [-.34, 0, 0], [.43, 0, 0], [.47, 0, 0], [.62, .04, -.14]),
  end: pose([.27, .57, .09], [-.52, .07, -.45], [-1.27, -.50, .68], [-.85, .08, -.10], [-.35, -.03, .12], [0, -.24, -.03], [.19, 0, 0], [-.31, 0, 0], [.37, 0, 0], [.44, 0, 0], [.60, .04, -.14]),
};
const fanRelease = {
  wind: pose([.17, .65, .07], [-.52, .58, -.70], [-.68, -.45, .52], [-.96, -.21, .12], [-1.66, .15, .17], [0, -.23, -.035], [.19, 0, 0], [-.24, 0, 0], [.34, 0, 0], [.40, 0, 0], [.82, -.20, -.27]),
  hit: pose([.30, -.59, -.11], [-.83, -.45, -.66], [-1.38, .42, .91], [-.18, .13, -.09], [-.08, -.16, .05], [0, .24, .035], [-.34, 0, 0], [.18, 0, 0], [.46, 0, 0], [.35, 0, 0], [.92, .13, .21]),
  end: pose([.25, -.86, -.13], [-.78, -.76, -.44], [-1.11, .60, .99], [-.64, .14, -.11], [-.44, -.14, .09], [0, .29, .04], [-.29, 0, 0], [.20, 0, 0], [.42, 0, 0], [.34, 0, 0], [.66, .13, .22]),
};

function blendPose(a, b, t) {
  const result = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[name] || [0, 0, 0], bv = b[name] || [0, 0, 0];
    result[name] = av.map((value, axis) => mix(value, bv[axis], t));
  }
  return result;
}

// A fast stroke is followed by a brief contact accent, then a relaxed
// recovery. Combo recovery keeps the previous blade chamber alive.
function strikePose(progress, clip, timing, recoveryPose = guard, entryPose = guard) {
  const { anticipation, contact, follow, recovery } = timing;
  if (progress < anticipation) return blendPose(entryPose, clip.wind, smooth(progress / anticipation));
  if (progress < contact) return blendPose(clip.wind, clip.hit, smooth((progress - anticipation) / (contact - anticipation)));
  if (progress < follow) return blendPose(clip.hit, clip.end, smooth((progress - contact) / (follow - contact)));
  if (progress < recovery) return blendPose(clip.end, recoveryPose, .18 * smooth((progress - follow) / (recovery - follow)));
  return blendPose(clip.end, recoveryPose, .18 + .82 * smooth((progress - recovery) / (1 - recovery)));
}
function envelope(p, start, end) {
  return smooth(p / start) * (1 - smooth((p - end) / (1 - end)));
}
function lungeFeet(progress, timing, lead = -1, reach = .44, width = .23) {
  const step = clamp((progress - timing.driveStart * .35) / (timing.contact - timing.driveStart * .35));
  return [-1, 1].map(side => ({ x: side * width, z: side === lead ? mix(.06, reach, smooth(step)) : -.28,
    lift: side === lead ? Math.sin(step * Math.PI) * .16 : 0, pitch: 0, planted: side !== lead || step >= 1 }));
}

function motionState(model) {
  if (!model.userData.motion) {
    model.userData.motion = {
      phase: 0, speed: 0, travelX: 0, travelZ: 0, lastX: model.position.x, lastZ: model.position.z,
      lastYaw: model.rotation.y, turn: 0, layer: null, transition: 1, gaitTransition: 1, from: {}, feet: {},
      q: new THREE.Quaternion(), parentQ: new THREE.Quaternion(), euler: new THREE.Euler(),
      point: new THREE.Vector3(), world: new THREE.Vector3(), scale: new THREE.Vector3(),
    };
  }
  return model.userData.motion;
}

function beginLayer(state, key, rig, dt) {
  if (state.layer !== key) {
    state.layer = key;
    state.transition = 0;
    for (const [name, object] of Object.entries(rig)) {
      state.from[name] ||= new THREE.Quaternion();
      state.from[name].copy(object.quaternion);
    }
    for (const [side, foot] of Object.entries(state.feet)) {
      foot.planted = false;
      foot.start ||= new THREE.Vector3();
      rig[`${side}Foot`]?.getWorldPosition(foot.start);
    }
    state.gaitTransition = 0;
    state.handoverLead = key?.type === 'attack' ? (key.step % 2 ? 'right' : 'left') : null;
    state.handoverLeadTime = state.handoverLead ? getActionClip(key.type, key.step || 0).duration * getActionClip(key.type, key.step || 0).contact : 0;
    state.handoverDuration = state.handoverLead ? state.handoverLeadTime + .125 : .12;
  }
  state.transition = Math.min(1, state.transition + dt / .055);
}

function gaitFoot(phase, speed, stride, side, backwards) {
  const u = ((phase / TAU + (side < 0 ? 0 : .5)) % 1 + 1) % 1;
  const stance = .43;
  const onGround = u < stance;
  const swing = clamp((u - stance) / (1 - stance));
  const z = onGround ? mix(.46, -.46, u / stance) : mix(-.46, .46, smooth(swing));
  return {
    x: side * (.19 + .018 * speed), z: z * stride * (backwards ? -1 : 1),
    lift: onGround ? 0 : Math.sin(Math.PI * swing) ** 1.3 * .28 * speed,
    pitch: onGround ? 0 : Math.sin(TAU * swing) * .42 * speed,
    planted: onGround,
  };
}

// Solve hip -> knee -> ankle against a world-space foot contact. A planted foot
// stays at its contact point while the body moves past it, eliminating skating.
function solveFoot(model, rig, state, side, footTarget, dt, lock) {
  const prefix = side < 0 ? 'left' : 'right';
  const leg = rig[`${prefix}Leg`], shin = rig[`${prefix}Shin`], foot = rig[`${prefix}Foot`];
  if (!leg || !shin || !foot) return;
  const lengths = model.userData.legLengths || { thigh: .474, shin: .425, sole: .116 };
  const contact = state.feet[prefix] ||= { planted: false, anchor: new THREE.Vector3(), yaw: 0 };
  model.getWorldScale(state.scale);
  const yaw = model.rotation.y;
  const localX = footTarget.x * state.scale.x, localZ = footTarget.z * state.scale.z;
  state.world.set(model.position.x + Math.cos(yaw) * localX + Math.sin(yaw) * localZ,
    (lengths.sole + footTarget.lift + Math.abs(Math.sin(footTarget.pitch)) * .17) * state.scale.y,
    model.position.z - Math.sin(yaw) * localX + Math.cos(yaw) * localZ);
  if (state.gaitTransition < 1 && contact.start) {
    const progress = state.handoverLead
      ? prefix === state.handoverLead ? clamp(state.gaitTransition * state.handoverDuration / state.handoverLeadTime) : clamp((state.gaitTransition * state.handoverDuration - state.handoverLeadTime) / .125)
      : state.gaitTransition;
    const blend = smooth(progress);
    state.world.lerpVectors(contact.start, state.world, blend);
    state.world.y += Math.sin(blend * Math.PI) * .10;
    // One foot supports the change of combo lead while the other swings.
    // Release only the moving contact; the new lead lands before its mate lifts.
    if (progress > 0 && progress < 1 || !state.handoverLead) lock = false;
  }
  if (footTarget.planted && lock) {
    if (!contact.planted) { contact.anchor.copy(state.world); contact.yaw = yaw; }
    state.world.copy(contact.anchor);
  } else contact.yaw = yaw;
  contact.planted = footTarget.planted && lock;
  state.point.copy(state.world);
  rig.hips.worldToLocal(state.point).sub(leg.position);
  // Contacts outside reach occur after teleports, hard turns or knockback.
  // Release that contact and place the foot beneath the moving center of mass.
  const reach = lengths.thigh + lengths.shin - .002;
  if (state.point.length() > reach - .002 && contact.planted) {
    contact.planted = false;
    contact.anchor.set(model.position.x + Math.cos(yaw) * localX + Math.sin(yaw) * localZ,
      lengths.sole * state.scale.y, model.position.z - Math.sin(yaw) * localX + Math.cos(yaw) * localZ);
    state.point.copy(contact.anchor); rig.hips.worldToLocal(state.point).sub(leg.position);
  }
  const distance = clamp(state.point.length(), .16, reach);
  const upper = lengths.thigh, lower = lengths.shin;
  // Quaternion two-bone solve keeps the ankle at the exact contact even with
  // a banked, counter-rotating pelvis. Euler hip spread skews the knee plane.
  state.legIK ||= { direction: new THREE.Vector3(), pole: new THREE.Vector3(), knee: new THREE.Vector3(),
    lower: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0), upperQ: new THREE.Quaternion(), lowerQ: new THREE.Quaternion() };
  const ik = state.legIK;
  ik.direction.copy(state.point).normalize();
  ik.pole.set(0, 0, 1).addScaledVector(ik.direction, -ik.direction.z).normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  ik.knee.copy(ik.direction).multiplyScalar(along).addScaledVector(ik.pole, height);
  ik.lower.copy(ik.direction).multiplyScalar(distance).sub(ik.knee).normalize();
  ik.upperQ.setFromUnitVectors(ik.down, ik.knee.normalize());
  ik.lowerQ.setFromUnitVectors(ik.down, ik.lower);
  leg.quaternion.copy(ik.upperQ);
  shin.quaternion.copy(ik.upperQ.invert().multiply(ik.lowerQ));
  // A world-aligned ankle cancels the parent's hip/knee rotation. This also
  // lets the toes retain their facing direction through torso counter-rotation.
  shin.updateWorldMatrix(true, false);
  shin.getWorldQuaternion(state.parentQ).invert();
  state.q.setFromEuler(state.euler.set(footTarget.pitch, contact.yaw, 0, 'YXZ'));
  foot.quaternion.copy(state.parentQ.multiply(state.q));
}

// Place the support hand on the lower hilt during two-handed cuts. The elbow
// pole keeps the bend outside the torso, with the wrist following the grip.
function supportSword(model, rig, amount) {
  if (!rig.leftHand || !rig.weapon || amount <= 0) return;
  model.updateWorldMatrix(true, true);
  const wristRotation = rig.rightHand.getWorldQuaternion(new THREE.Quaternion());
  const destination = rig.weapon.localToWorld(new THREE.Vector3(0, -.14, 0));
  destination.add(new THREE.Vector3(0, .036, -.034).applyQuaternion(wristRotation));
  rig.body.worldToLocal(destination);
  const shoulder = rig.leftArm.position;
  const direction = destination.clone().sub(shoulder);
  const length = clamp(direction.length(), .08, .715);
  direction.normalize();
  const upper = .37, lower = .35;
  const along = (upper * upper + length * length - lower * lower) / (2 * length);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const pole = new THREE.Vector3(-1, -.28, .1);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, height);
  const down = new THREE.Vector3(0, -1, 0);
  const upperQ = new THREE.Quaternion().setFromUnitVectors(down, elbow.clone().sub(shoulder).normalize());
  const lowerQ = new THREE.Quaternion().setFromUnitVectors(down, destination.clone().sub(elbow).normalize());
  rig.leftArm.quaternion.slerp(upperQ, amount);
  rig.leftForearm.quaternion.slerp(upperQ.clone().invert().multiply(lowerQ), amount);
  rig.leftForearm.updateWorldMatrix(true, false);
  const wristQ = rig.leftForearm.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wristRotation);
  rig.leftHand.quaternion.slerp(wristQ, amount);
}

/** Layered procedural animation with grounded foot contacts and contact-timed attacks. */
export function animateCharacter(model, walk, action, time, dt, isPlayer = false, entity = null) {
  const rig = model.userData.rig || {};
  const rest = model.userData.rest || Object.fromEntries(Object.entries(rig).map(([name, joint]) => [name, joint.userData.base]));
  const state = motionState(model);
  dt = clamp(dt, 0, .1);
  const dx = model.position.x - state.lastX, dz = model.position.z - state.lastZ;
  state.lastX = model.position.x; state.lastZ = model.position.z;
  const distance = Math.hypot(dx, dz);
  const teleported = distance > 2;
  if (teleported) for (const foot of Object.values(state.feet)) foot.planted = false;
  const velocity = dt > 0 && !teleported ? distance / dt : 0;
  state.speed = damp(state.speed, Math.min(velocity, 9), 12, dt);
  const yaw = model.rotation.y;
  const turn = Math.atan2(Math.sin(yaw - state.lastYaw), Math.cos(yaw - state.lastYaw));
  state.lastYaw = yaw;
  state.turn = damp(state.turn, dt > 0 ? clamp(turn / dt, -4, 4) : 0, 8, dt);
  const moving = clamp(walk) * clamp(state.speed / .6);
  // Travel advances the gait, so slow enemies, retreating archers and the hero
  // all keep their feet in time with their actual displacement.
  const strideScale = isPlayer ? 1 : .85;
  if (distance > 0 && !teleported && !action) state.phase += distance / (2.14 * strideScale) * TAU;
  const cycle = state.phase, stride = Math.sin(cycle);
  const backwards = dx * Math.sin(yaw) + dz * Math.cos(yaw) < -.0001;
  let target = blendPose({}, guard, isPlayer ? 1 : .72);
  const breathe = Math.sin(time * 2.1), settle = Math.sin(time * 1.05);
  const speedLean = moving * clamp(state.speed / 5.6);
  target.body = [.20 + speedLean * .20 + breathe * .009, -.34 + stride * .15 * moving - state.turn * .028, -.055 - state.turn * .046 * moving + settle * .008];
  target.hips = [0, .14 - stride * .11 * moving + state.turn * .012, .025 + Math.cos(cycle) * .040 * moving];
  target.leftArm = [-.22 + stride * .61 * moving, .28 - stride * .12 * moving, .30 + moving * .11];
  target.rightArm = [-.46 - stride * .15 * moving, -.32 + stride * .10 * moving, -.30 - moving * .12];
  target.leftForearm = [-1.22 - Math.max(0, -stride) * .22 * moving, -.14, .21];
  target.rightForearm = [-.94 - Math.max(0, stride) * .20 * moving, .15, -.13];
  target.rightHand = [.48 + moving * .09, -.05, -.17];
  let pelvisY = -.17 + breathe * .006 - moving * .025 + Math.cos(cycle * 2) * .013 * moving;
  let pelvisZ = .035 + speedLean * .045, pelvisX = settle * .008, rootY = 0, spin = 0, airborne = false;
  let footwork = null;
  const type = action?.type;
  const timing = action ? getActionClip(type, action.step || 0) : null;
  const p = action ? clamp(action.age / (action.duration || timing.duration)) : 0;
  const enemySweep = !action && entity?.attackKind === 'sweep' && (entity.mode === 'windup' || entity.mode === 'recover');
  if (action) {
    if (type === 'attack' || type === 'heavy' || type === 'finisher') {
      const heavy = type === 'heavy', step = (action.step || 0) % 3;
      const clip = heavy ? overhead : type === 'finisher' ? finishing : cuts[step];
      const chained = type === 'attack' && step < 2;
      const chamber = chained ? blendPose(clip.end, cuts[step + 1].wind, .28) : guard;
      target = strikePose(p, clip, timing, chamber, type === 'attack' && step > 0 ? cuts[step - 1].end : guard);
      const load = envelope(p, timing.anticipation, timing.recovery);
      const contactWeight = smooth((p - timing.anticipation) / (timing.contact - timing.anticipation));
      pelvisY = -.17 - load * (heavy ? .115 : type === 'finisher' ? .10 : .055);
      pelvisZ = .025 + load * .10;
      pelvisX = load * (step === 1 ? .065 : -.055) * (1 - contactWeight * 1.6);
      footwork = lungeFeet(p, timing, step === 1 ? 1 : -1, heavy ? .52 : .46);
      if (type === 'finisher') spin = smooth((p - timing.contact) / (timing.follow - timing.contact)) * .33 * (1 - smooth((p - timing.recovery) / (1 - timing.recovery)));
    } else if (type === 'roll') {
      const tuck = envelope(p, .12, .77);
      const folded = pose([1.01, .12, -.19], [-1.40, .29, -.42], [-1.82, -.29, .49], [-1.42, .12, .03], [-1.65, -.04, .02],
        [0, 0, 0], [-1.69, 0, -.08], [-2.04, 0, .13], [2.20, 0, 0], [2.35, 0, 0], [.18, -.07, -.02]);
      target = blendPose(guard, folded, tuck);
      target.head = [.45 * tuck, -.10 * tuck, .09 * tuck];
      target.hips = [smooth((p - .06) / .84) * TAU, 0, -.11 * Math.sin(p * Math.PI)];
      target.leftFoot = [-.50 * tuck, 0, 0]; target.rightFoot = [-.44 * tuck, 0, 0];
      pelvisY = -.17 - .20 * tuck;
      pelvisZ = .08 * tuck;
      rootY = .065 * Math.sin(Math.PI * p);
      airborne = true;
    } else if (type === 'whirl') {
      const extend = envelope(p, timing.anticipation, timing.recovery);
      const spiral = pose([.27, -.26, -.15], [-.68, -.16, -1.33], [-.32, .37, .81], [-.13, .07, -.11], [-1.02, -.15, .20],
        [0, .18, .04], [-.30, 0, -.08], [.23, 0, .08], [.45, 0, 0], [.38, 0, 0], [.84, -.12, -.26]);
      target = blendPose(guard, spiral, extend);
      // Cross-step, accelerating draw, then two tight pivots and a brake.
      const rotate = smooth((p - .10) / .73);
      spin = rotate * TAU * 2;
      target.body[0] += Math.sin(p * TAU * 3) * .055 * extend;
      target.body[1] += Math.sin(p * TAU * 3) * .19 * extend;
      pelvisY = -.17 - extend * .07;
      footwork = [-1, 1].map(side => ({ x: side * (.22 + .025 * Math.sin(p * TAU * 3)), z: Math.sin(spin * 1.5 + (side < 0 ? 0 : Math.PI)) * .20,
        lift: Math.max(0, side * Math.sin(spin * 1.5)) * .14, pitch: 0, planted: false }));
    } else if (type === 'burst') {
      target = strikePose(p, overhead, timing);
      const flight = p >= .22 && p < timing.contact ? Math.sin(clamp((p - .22) / (timing.contact - .22)) * Math.PI) : 0;
      const load = Math.sin(clamp(p / .22) * Math.PI) * (p < .22 ? 1 : 0);
      const land = smooth((p - .49) / .09) * (1 - smooth((p - .68) / .30));
      rootY = .94 * flight;
      pelvisY = -.17 - .11 * load - .14 * land;
      const fold = Math.max(0, flight);
      target.leftLeg[0] -= fold * .88; target.rightLeg[0] -= fold * .72;
      target.leftShin[0] += fold * 1.10; target.rightShin[0] += fold * 1.10;
      target.leftFoot = [-.32 * fold, 0, 0]; target.rightFoot = [-.25 * fold, 0, 0];
      target.body[1] -= .30 * flight;
      airborne = flight > .10 && p > .24 && p < timing.contact - .025;
      footwork = [-1, 1].map(side => ({ x: side * .28, z: side * -.18, lift: 0, pitch: 0, planted: true }));
    } else if (type === 'dash') {
      const draw = pose([.57, -.82, -.14], [-.58, -.99, -.29], [-.83, .48, .61], [-1.08, .21, -.14], [-1.36, -.10, .16],
        [0, .27, .04], [.12, 0, -.08], [-.86, 0, .10], [.48, 0, 0], [.86, 0, 0], [.52, .12, .24]);
      const passing = { wind: draw, hit: cuts[0].hit, end: finishing.end };
      target = strikePose(p, passing, timing);
      const drive = envelope(p, timing.anticipation, timing.driveEnd);
      target.body[0] += .13 * drive;
      pelvisY = -.17 - .10 * drive;
      pelvisZ = .10 * drive;
      footwork = [-1, 1].map(side => gaitFoot(p * TAU * 1.55, drive, .83, side, false));
    } else if (type === 'frost') {
      target = strikePose(p, frostSeal, timing);
      target.leftHand = [-.38 * envelope(p, timing.anticipation, timing.recovery), .13, -.22];
      pelvisY = -.17 - .075 * envelope(p, timing.anticipation, timing.recovery);
      pelvisZ = .065;
      footwork = lungeFeet(p, timing, -1, .35, .26);
    } else if (type === 'blades') {
      target = strikePose(p, fanRelease, timing);
      target.leftHand = [.23 * envelope(p, timing.anticipation, timing.follow), -.16, .26];
      pelvisY = -.17 - .035 * Math.sin(p * Math.PI);
      footwork = lungeFeet(p, timing, 1, .34);
    }
  } else if (entity) {
    const enemyTiming = ENEMY_CLIPS[entity.type] || ENEMY_CLIPS.soldier;
    const enemyClip = entity.attackKind === 'sweep' ? cuts[0] : overhead;
    if (entity.mode === 'windup') {
      const progress = clamp(1 - entity.timer / (entity.windupDuration || 1));
      const release = enemyTiming.anticipation;
      if (entity.type === 'archer') {
        target = blendPose(guard, bowDraw, smooth(progress / .65));
        target.rightForearm[0] -= .07 * Math.sin(progress * Math.PI);
      } else if (progress < release) target = blendPose(guard, enemyClip.wind, smooth(progress / (release * .70)));
      else target = blendPose(enemyClip.wind, enemyClip.hit, smooth((progress - release) / (1 - release)));
      pelvisY = -.11 - .075 * Math.sin(progress * Math.PI);
      pelvisZ = .045 * smooth((progress - release) / (1 - release));
      if (enemySweep) spin = smooth((progress - release) / (1 - release)) * Math.PI;
      footwork = lungeFeet(progress, { driveStart: release, contact: 1 }, -1, .35);
    } else if (entity.mode === 'recover') {
      const progress = clamp(1 - entity.timer / (entity.recoverDuration || .6));
      if (entity.type === 'archer') {
        const released = blendPose(bowDraw, guard, .28);
        released.rightForearm = [-.94, .35, -.05];
        released.leftForearm = [-.17, -.13, 0];
        target = blendPose(released, guard, smooth((progress - .08) / .92));
      } else if (progress < enemyTiming.follow) target = blendPose(enemyClip.hit, enemyClip.end, smooth(progress / enemyTiming.follow));
      else target = blendPose(enemyClip.end, guard, smooth((progress - enemyTiming.recovery) / (1 - enemyTiming.recovery)));
      pelvisY = -.11 - .08 * (1 - smooth(progress));
      if (enemySweep) spin = Math.PI + smooth(progress / .48) * Math.PI;
    }
    if (entity.stun > 0) {
      const reaction = entity.reactionAge == null ? clamp(entity.stun / .25) : 1 - smooth(entity.reactionAge / (entity.reactionDuration || .25));
      const strength = reaction * (entity.reactionStrength || 1);
      const direction = entity.reactionYaw || 0;
      target.body[0] -= Math.cos(direction) * .40 * strength;
      target.body[1] += Math.sin(direction) * .34 * strength;
      target.body[2] -= Math.sin(direction) * .20 * strength;
      target.head = [-.20 * strength, -.12 * Math.sin(direction) * strength, .06 * strength];
      target.rightArm[2] -= .26 * strength; target.leftArm[2] += .32 * strength;
      target.rightForearm[0] += .24 * strength;
      pelvisY -= .035 * strength;
      pelvisX += .055 * Math.sin(direction) * strength;
    }
  }
  if (enemySweep && spin > 0) {
    footwork = [-1, 1].map(side => ({ x: side * .23, z: Math.sin(spin) * side * .15,
      lift: Math.max(0, side * Math.sin(spin)) * .08, pitch: 0, planted: false }));
  }
  if (isPlayer && entity?.hurtTimer > 0) {
    const recoil = clamp(entity.hurtTimer / (entity.hurtDuration || .23));
    const direction = entity.reactionYaw || 0;
    target.body[0] -= .38 * Math.cos(direction) * recoil; target.body[2] -= .18 * Math.sin(direction) * recoil;
    target.body[1] += .25 * Math.sin(direction) * recoil;
    target.head = [-.22 * recoil, .10 * recoil, .05 * recoil];
    target.leftArm[2] += .31 * recoil; target.rightArm[2] -= .24 * recoil; pelvisY -= .035 * recoil;
  }
  if (entity?.type === 'archer') target.rightHand = [0, 0, 0];
  target.head ||= [-target.body[0] * .56 + breathe * .006, -target.body[1] * .67 + state.turn * .036, -target.body[2] * .60];
  // Layer delayed motion down the cloth chain. Acceleration and turning move
  // the fabric; a low-amplitude breeze keeps a resting silhouette alive.
  const energy = moving + (action ? envelope(p, timing.anticipation, timing.recovery) * .9 : 0);
  const twist = target.body[1] - guard.body[1];
  target.cape = [.10 + energy * .28 + Math.sin(time * 3.1) * .025, -state.turn * .05 - twist * .13, Math.sin(time * 2.8) * .023 - twist * .07];
  target.capeTail = [.06 + energy * .32 + Math.sin(time * 5.6 - .9) * (.04 + energy * .04), -state.turn * .035 - twist * .10, Math.sin(time * 3.1 - 1) * .05 - twist * .06];
  target.scarf = [.16 + energy * .32, -state.turn * .065, Math.sin(time * 5.3) * .04];
  target.scarfTip = [.13 + energy * .4 + Math.sin(time * 7 - .9) * .075, -state.turn * .04, Math.sin(time * 6.2 - 1) * .065];
  if (type === 'roll') {
    const fold = Math.sin(p * Math.PI);
    target.cape[0] -= fold * .55; target.capeTail[0] -= fold * .7;
    target.scarf[0] -= fold * 1.25; target.scarfTip[0] -= fold * .8;
  }
  target.skirtLeft = [.07 + moving * Math.max(0, -stride) * .37 + (action ? .08 : 0), 0, -.055];
  target.skirtRight = [.07 + moving * Math.max(0, stride) * .37 + (action ? .08 : 0), 0, .055];
  const layer = action || (entity?.stun > 0 ? 'stunned' : entity?.mode || 'locomotion');
  beginLayer(state, layer, rig, dt);
  const transition = smooth(state.transition);
  for (const [name, base] of Object.entries(rest)) {
    const object = rig[name]; if (!object?.rotation || !base) continue;
    const offset = target[name] || [0, 0, 0];
    state.euler.set(base.rotation.x + offset[0], base.rotation.y + offset[1], base.rotation.z + offset[2], base.rotation.order);
    state.q.setFromEuler(state.euler);
    if (type === 'roll' && name === 'hips') object.rotation.copy(state.euler);
    else {
      if (state.from[name] && transition < 1) state.q.copy(state.from[name]).slerp(new THREE.Quaternion().setFromEuler(state.euler), transition);
      object.quaternion.slerp(state.q, 1 - Math.exp(-(name.startsWith('cape') || name.startsWith('scarf') ? 12 : action || entity?.mode === 'windup' || entity?.hurtTimer > 0 || entity?.stun > 0 ? 150 : 22) * dt));
    }
    object.position.copy(base.position);
    if (name === 'hips') { object.position.y += pelvisY; object.position.z += pelvisZ; object.position.x += pelvisX; }
  }
  model.position.y = rootY;
  model.rotation.x = 0; model.rotation.z = 0; model.rotation.y = yaw + spin;
  if (!airborne) {
    model.updateWorldMatrix(true, true);
    const useGait = !action && (!entity || entity.mode === 'chase' || entity.mode == null) && moving > .05;
    if (state.wasMoving !== undefined && state.wasMoving !== useGait) {
      state.gaitTransition = 0;
      state.handoverLead = null;
      state.handoverDuration = .12;
      for (const side of ['left', 'right']) {
        const foot = state.feet[side];
        if (foot) { foot.planted = false; foot.start ||= new THREE.Vector3(); rig[`${side}Foot`]?.getWorldPosition(foot.start); }
      }
    }
    state.wasMoving = useGait;
    state.gaitTransition = Math.min(1, state.gaitTransition + dt / (state.handoverDuration || .12));
    for (const side of [-1, 1]) {
      const desired = footwork?.[side < 0 ? 0 : 1] || (useGait ? gaitFoot(cycle, moving, strideScale * moving, side, backwards)
        : { x: side * .24, z: side < 0 ? .20 : -.18, lift: 0, pitch: 0, planted: true });
      solveFoot(model, rig, state, side, desired, dt, type !== 'whirl' && type !== 'dash' && !enemySweep);
    }
  } else {
    for (const foot of Object.values(state.feet)) foot.planted = false;
  }
  if (type === 'heavy' || type === 'burst' || type === 'attack' && action.step === 2) {
    supportSword(model, rig, smooth(p / .22) * (1 - smooth((p - .72) / .24)));
  }
  if (type === 'burst' && airborne) {
    // The landing begins when an articulated sole reaches the floor; keep the
    // last airborne frames clear before ground IK takes over on both ankles.
    model.updateWorldMatrix(true, true);
    state.bounds ||= new THREE.Box3();
    const soleY = Math.min(state.bounds.setFromObject(rig.leftFoot).min.y, state.bounds.setFromObject(rig.rightFoot).min.y);
    model.position.y += Math.max(0, .002 - soleY);
  }
  if (type === 'roll' && rig.rightHand && rig.weapon) {
    // Carry the dao outside the shoulder roll, tilted safely above the ground.
    // Counter-rotation is applied to the entire gripping hand, not the blade.
    rig.rightForearm.updateWorldMatrix(true, false);
    rig.rightForearm.getWorldQuaternion(state.parentQ).invert();
    state.point.set(-Math.sin(yaw) * .76, .65, -Math.cos(yaw) * .76).normalize();
    state.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), state.point);
    state.q.multiply(rig.weapon.quaternion.clone().invert());
    rig.rightHand.quaternion.copy(state.parentQ.multiply(state.q));
    // The shoulder is the rolling contact, not the head. Correct the short
    // inverted section against the floor using the actual articulated head.
    rig.head.updateWorldMatrix(true, false);
    rig.head.getWorldPosition(state.point);
    let clearance = Math.max(0, .23 - state.point.y);
    model.updateWorldMatrix(true, true);
    state.bounds ||= new THREE.Box3();
    for (const joint of [rig.head, rig.leftFoot, rig.rightFoot, rig.scarf, rig.skirtLeft, rig.skirtRight]) {
      if (joint) clearance = Math.max(clearance, .002 - state.bounds.setFromObject(joint).min.y);
    }
    model.position.y += clearance;
  }
}
