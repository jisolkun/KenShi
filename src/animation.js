import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = THREE.MathUtils.lerp;
const damp = (a, b, rate, dt) => mix(a, b, 1 - Math.exp(-rate * dt));
const pose = (body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, rightHand) =>
  ({ body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, rightHand });

// Poses are offsets from the authored bind pose. The sword belongs to the hand,
// so every wrist adjustment also moves the grip, knuckles and thumb.
const guard = pose([.055, -.14, .015], [-.30, -.20, -.19], [-.30, .16, .16], [-.64, .10, -.08], [-.70, -.12, .12],
  [0, .05, 0], [-.12, 0, -.03], [.08, 0, .03], [.24, 0, 0], [.24, 0, 0], [.30, .04, -.10]);
const cuts = [
  {
    wind: pose([-.04, -.66, -.07], [-1.08, -.62, -.67], [-.48, .30, .55], [-1.05, .16, -.12], [-.92, 0, .08], [0, -.22, -.025], [-.25, 0, 0], [.20, 0, 0], [.40, 0, 0], [.25, 0, 0], [.47, -.08, .12]),
    hit: pose([.13, .21, .045], [-.78, .12, -.92], [-.43, -.27, .53], [-.18, -.08, .08], [-.8, 0, .06], [0, .13, .025], [.15, 0, 0], [-.40, 0, 0], [.24, 0, 0], [.42, 0, 0], [.82, -.15, -.28]),
    end: pose([.14, .66, .10], [-.43, .76, -.88], [-.36, -.42, .48], [-.24, -.16, .14], [-.60, 0, 0], [0, .27, .03], [.2, 0, 0], [-.45, 0, 0], [.2, 0, 0], [.4, 0, 0], [.91, -.23, -.34]),
  },
  {
    wind: pose([.02, .62, .08], [-.56, .84, -.84], [-.34, -.34, .53], [-.47, -.15, .12], [-.77, 0, 0], [0, .24, .02], [.20, 0, 0], [-.20, 0, 0], [.25, 0, 0], [.35, 0, 0], [.9, -.2, -.3]),
    hit: pose([.16, -.22, -.025], [-.80, -.42, -.61], [-.38, .20, .57], [-.19, .08, -.08], [-.73, 0, 0], [0, -.10, -.02], [-.32, 0, 0], [.17, 0, 0], [.35, 0, 0], [.25, 0, 0], [.94, .07, .19]),
    end: pose([.10, -.74, -.09], [-.72, -.94, -.30], [-.36, .41, .60], [-.50, .18, -.10], [-.56, 0, 0], [0, -.28, -.03], [-.40, 0, 0], [.22, 0, 0], [.4, 0, 0], [.23, 0, 0], [.51, .11, .25]),
  },
  {
    wind: pose([-.17, -.33, -.035], [-2.30, -.32, -.30], [-1.10, .2, .45], [-.77, .05, .10], [-1.2, -.05, .02], [0, -.12, 0], [-.27, 0, 0], [.2, 0, 0], [.4, 0, 0], [.32, 0, 0], [.72, 0, -.02]),
    hit: pose([.30, .17, .055], [-.78, .16, -.30], [-.71, -.13, .39], [-.18, 0, .02], [-.65, -.08, .08], [0, .09, 0], [.18, 0, 0], [-.47, 0, 0], [.3, 0, 0], [.5, 0, 0], [1.0, 0, -.07]),
    end: pose([.37, .35, .09], [-.36, .28, -.26], [-.55, -.20, .33], [-.13, 0, .02], [-.55, 0, .08], [0, .14, 0], [.28, 0, 0], [-.56, 0, 0], [.33, 0, 0], [.55, 0, 0], [.8, 0, -.09]),
  },
];
const overhead = {
  wind: pose([-.19, -.20, 0], [-2.58, -.18, -.26], [-2.05, .18, .27], [-.63, .03, .05], [-1.0, -.05, -.08], [0, -.09, 0], [-.32, 0, 0], [.24, 0, 0], [.55, 0, 0], [.45, 0, 0], [.8, 0, .04]),
  hit: pose([.38, .14, .035], [-.75, .18, -.23], [-.85, -.12, .22], [-.13, 0, .03], [-.44, -.04, -.06], [0, .065, 0], [.35, 0, 0], [-.66, 0, 0], [.45, 0, 0], [.60, 0, 0], [1.08, 0, -.07]),
  end: pose([.44, .24, .03], [-.38, .22, -.19], [-.64, -.12, .25], [-.17, 0, .02], [-.42, -.03, -.02], [0, .10, 0], [.39, 0, 0], [-.72, 0, 0], [.46, 0, 0], [.64, 0, 0], [.72, 0, -.06]),
};
const bowDraw = pose([.025, -.38, .025], [-1.24, .55, -.38], [-1.43, -.40, .39], [-1.40, .12, .03], [-.13, -.12, 0], [0, -.1, 0], [-.15, 0, 0], [.14, 0, 0], [.24, 0, 0], [.24, 0, 0], [0, 0, 0]);

function blendPose(a, b, t) {
  const result = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[name] || [0, 0, 0], bv = b[name] || [0, 0, 0];
    result[name] = av.map((value, axis) => mix(value, bv[axis], t));
  }
  return result;
}

// Contact markers match the gameplay hit windows. The cutting stroke is quick;
// anticipation, follow-through and recovery have independent readable timings.
function strikePose(progress, clip, contact = .42, heavy = false) {
  const release = contact - (heavy ? .15 : .17);
  const follow = contact + (heavy ? .11 : .13);
  if (progress < release) return blendPose(guard, clip.wind, smooth(progress / release));
  if (progress < contact) return blendPose(clip.wind, clip.hit, smooth((progress - release) / (contact - release)));
  if (progress < follow) return blendPose(clip.hit, clip.end, smooth((progress - contact) / (follow - contact)));
  return blendPose(clip.end, guard, smooth((progress - follow) / (1 - follow)));
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
    for (const foot of Object.values(state.feet)) foot.planted = false;
  }
  state.transition = Math.min(1, state.transition + dt / .085);
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
    const blend = smooth(state.gaitTransition);
    state.world.lerpVectors(contact.start, state.world, blend);
    state.world.y += Math.sin(blend * Math.PI) * .10;
    lock = false;
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
  if (state.point.length() > reach + .10 && contact.planted) {
    contact.planted = false;
    contact.anchor.set(model.position.x + Math.cos(yaw) * localX + Math.sin(yaw) * localZ,
      lengths.sole * state.scale.y, model.position.z - Math.sin(yaw) * localX + Math.cos(yaw) * localZ);
    state.point.copy(contact.anchor); rig.hips.worldToLocal(state.point).sub(leg.position);
  }
  const distance = clamp(state.point.length(), .16, reach);
  const upper = lengths.thigh, lower = lengths.shin;
  const knee = Math.PI - Math.acos(clamp((upper * upper + lower * lower - distance * distance) / (2 * upper * lower), -1, 1));
  const hipBend = Math.acos(clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
  const pitch = Math.atan2(-state.point.z, -state.point.y);
  const spread = Math.atan2(state.point.x, Math.hypot(state.point.y, state.point.z));
  leg.rotation.set(pitch - hipBend, 0, spread);
  shin.rotation.set(knee, 0, 0);
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
  const breathe = Math.sin(time * 2.25);
  target.body = [.055 + moving * .15 + breathe * .008, -.11 + stride * .065 * moving, -state.turn * .017 * moving];
  target.hips = [0, .04 - stride * .055 * moving, Math.cos(cycle) * .025 * moving];
  target.leftArm = [-.29 + stride * .43 * moving, .14, .16 + moving * .045];
  target.rightArm = [-.31 - stride * .23 * moving, -.2, -.19];
  target.leftForearm = [-.70 - Math.max(0, -stride) * .30 * moving, -.12, .12];
  target.rightForearm = [-.64 - Math.max(0, stride) * .17 * moving, .10, -.08];
  let pelvisY = -.07 + breathe * .007 - moving * .06;
  let pelvisZ = 0, rootY = 0, spin = 0, airborne = false;
  let footwork = null;
  const p = action ? clamp(action.age / action.duration) : 0;
  const type = action?.type;
  const enemySweep = !action && entity?.attackKind === 'sweep' && (entity.mode === 'windup' || entity.mode === 'recover');
  if (action) {
    if (type === 'attack' || type === 'heavy' || type === 'finisher') {
      const heavy = type === 'heavy';
      target = strikePose(p, heavy ? overhead : cuts[type === 'finisher' ? 0 : (action.step || 0) % 3], heavy ? .55 : type === 'finisher' ? .43 : .42, heavy);
      const weight = Math.sin(Math.PI * p);
      pelvisY = -.075 - weight * (heavy ? .13 : .07);
      pelvisZ = weight * .065;
      const step = clamp(p / (heavy ? .48 : .37));
      footwork = [-1, 1].map(side => ({ x: side * .24, z: side < 0 ? mix(.02, .40, smooth(step)) : -.25,
        lift: side < 0 ? Math.sin(step * Math.PI) * .14 : 0, pitch: 0, planted: side > 0 || step >= 1 }));
    } else if (type === 'roll') {
      const tuck = smooth(p / .15) * (1 - smooth((p - .80) / .20));
      const folded = pose([1.08, 0, -.13], [-1.48, .18, -.33], [-1.70, -.2, .38], [-1.30, .1, 0], [-1.57, 0, 0],
        [0, 0, 0], [-1.73, 0, -.07], [-1.92, 0, .1], [2.25, 0, 0], [2.27, 0, 0], [.15, 0, 0]);
      target = blendPose(guard, folded, tuck);
      target.head = [.43 * tuck, 0, 0];
      target.hips = [smooth((p - .06) / .88) * TAU, 0, 0];
      target.leftFoot = [-.50 * tuck, 0, 0]; target.rightFoot = [-.50 * tuck, 0, 0];
      pelvisY = -.07 - .25 * tuck;
      rootY = .055 * Math.sin(Math.PI * p);
      airborne = true;
    } else if (type === 'whirl') {
      const extend = smooth(p / .18) * (1 - smooth((p - .8) / .2));
      target = blendPose(guard, pose([.09, .17, -.06], [-.53, -.04, -1.29], [-.44, .02, 1.03], [-.16, 0, -.06], [-.47, 0, .06],
        [0, 0, 0], [-.2, 0, -.06], [.2, 0, .06], [.3, 0, 0], [.3, 0, 0], [.56, 0, -.12]), extend);
      spin = smooth(p) * TAU * 2;
      pelvisY = -.10;
      footwork = [-1, 1].map(side => ({ x: side * .23, z: Math.sin(p * TAU * 2 + (side < 0 ? 0 : Math.PI)) * .16,
        lift: Math.max(0, side * Math.sin(p * TAU * 2)) * .10, pitch: 0, planted: false }));
    } else if (type === 'burst') {
      target = strikePose(p, overhead, .57, true);
      const takeoff = smooth((p - .18) / .12), landing = smooth((p - .48) / .09);
      const flight = p >= .22 && p <= .57 ? Math.sin(clamp((p - .22) / .35) * Math.PI) : 0;
      rootY = 1.05 * flight;
      pelvisY = -.07 - .19 * (1 - takeoff) * Math.sin(clamp(p / .22) * Math.PI / 2) - .24 * landing * (1 - smooth((p - .66) / .34));
      const fold = Math.max(0, flight);
      target.leftLeg[0] -= fold * .70; target.rightLeg[0] -= fold * .65;
      target.leftShin[0] += fold * .9; target.rightShin[0] += fold * .8;
      target.leftFoot = [-.32 * fold, 0, 0]; target.rightFoot = [-.3 * fold, 0, 0];
      airborne = flight > .015 && p > .27 && p < .51;
      footwork = [-1, 1].map(side => ({ x: side * .26, z: side * -.12, lift: 0, pitch: 0, planted: true }));
    } else if (type === 'dash') {
      const drive = smooth(p / .12) * (1 - smooth((p - .75) / .25));
      target = blendPose(guard, pose([.55, -.23, -.06], [-.72, -.8, -.36], [-.85, .3, .57], [-.32, .14, -.15], [-1.0, .05, .06],
        [0, -.08, 0], [.1, 0, -.07], [-.8, 0, .09], [.4, 0, 0], [.75, 0, 0], [.60, .05, .18]), drive);
      pelvisY = -.07 - .22 * drive;
      const dashPhase = p * TAU * 1.4;
      footwork = [-1, 1].map(side => gaitFoot(dashPhase, drive, .75, side, false));
    } else if (type === 'frost') {
      const gather = pose([-.07, -.23, 0], [-.62, -.24, -.34], [-.77, .52, .46], [-1.10, .08, -.04], [-1.32, -.16, .17],
        [0, -.08, 0], [-.15, 0, 0], [.16, 0, 0], [.35, 0, 0], [.35, 0, 0], [.62, .05, -.15]);
      const release = pose([.16, .18, .03], [-.58, -.15, -.45], [-1.38, -.24, .56], [-.36, .05, -.05], [-.16, 0, .12],
        [0, .06, 0], [.18, 0, 0], [-.28, 0, 0], [.4, 0, 0], [.4, 0, 0], [.52, .08, -.1]);
      target = strikePose(p, { wind: gather, hit: release, end: release }, .36);
      target.leftHand = [-.24 * Math.sin(p * Math.PI), 0, -.18];
      pelvisY = -.11 - Math.sin(p * Math.PI) * .10;
    } else if (type === 'blades') {
      const gather = blendPose(guard, cuts[1].wind, .7);
      gather.leftArm = [-1.0, .1, .58]; gather.leftForearm = [-1.45, -.2, .12];
      const release = blendPose(guard, cuts[1].hit, .7);
      release.leftArm = [-1.42, -.23, .55]; release.leftForearm = [-.1, 0, .04];
      target = strikePose(p, { wind: gather, hit: release, end: release }, .30);
      pelvisY = -.1;
    }
  } else if (entity) {
    if (entity.mode === 'windup') {
      const progress = clamp(1 - entity.timer / (entity.windupDuration || 1));
      const archer = entity.type === 'archer';
      const clip = entity.attackKind === 'sweep' ? cuts[0] : overhead;
      // Enemies finish their stroke in the final telegraph frames. Contact is
      // already authored when gameplay switches to recovery and applies damage.
      if (archer) target = blendPose(guard, bowDraw, smooth(progress / .8));
      else if (progress < .77) target = blendPose(guard, clip.wind, smooth(progress / .77));
      else target = blendPose(clip.wind, clip.hit, smooth((progress - .77) / .23));
      pelvisY = -.07 - Math.sin(progress * Math.PI) * .11;
      if (enemySweep) spin = smooth((progress - .77) / .23) * Math.PI;
    } else if (entity.mode === 'recover') {
      const progress = clamp(1 - entity.timer / (entity.recoverDuration || .6));
      if (entity.type === 'archer') {
        const released = blendPose(bowDraw, guard, .32);
        released.leftForearm = [-.25, -.13, 0];
        target = blendPose(released, guard, smooth(progress));
      } else {
        const clip = entity.attackKind === 'sweep' ? cuts[0] : overhead;
        target = progress < .20 ? blendPose(clip.hit, clip.end, smooth(progress / .2))
          : blendPose(clip.end, guard, smooth((progress - .2) / .8));
      }
      pelvisY = -.075 - .09 * (1 - smooth(progress));
      if (enemySweep) spin = Math.PI + smooth(progress / .4) * Math.PI;
    }
    if (entity.stun > 0) {
      target.body[0] -= .40; target.body[2] += .13;
      target.head = [-.18, .08, 0]; target.rightArm[2] -= .2; target.leftArm[2] += .25; pelvisY -= .06;
    }
  }
  if (enemySweep && spin > 0) {
    footwork = [-1, 1].map(side => ({ x: side * .23, z: Math.sin(spin) * side * .15,
      lift: Math.max(0, side * Math.sin(spin)) * .08, pitch: 0, planted: false }));
  }
  if (isPlayer && entity?.hurtTimer > 0) {
    const recoil = clamp(entity.hurtTimer / .15);
    target.body[0] -= .39 * recoil; target.body[2] -= .12 * recoil;
    target.head = [-.22 * recoil, .10 * recoil, .05 * recoil];
    target.leftArm[2] += .27 * recoil; target.rightArm[2] -= .2 * recoil; pelvisY -= .065 * recoil;
  }
  if (entity?.type === 'archer') target.rightHand = [0, 0, 0];
  target.head ||= [-target.body[0] * .43 + breathe * .006, -target.body[1] * .55, -target.body[2] * .5];
  // Layer delayed motion down the cloth chain. Acceleration and turning move
  // the fabric; a low-amplitude breeze keeps a resting silhouette alive.
  const energy = moving + (action ? Math.sin(p * Math.PI) * .6 : 0);
  target.cape = [.10 + energy * .28 + Math.sin(time * 3.1) * .025, -state.turn * .05, Math.sin(time * 2.8) * .023];
  target.capeTail = [.06 + energy * .32 + Math.sin(time * 5.6 - .9) * (.04 + energy * .04), -state.turn * .035, Math.sin(time * 3.1 - 1) * .05];
  target.scarf = [.16 + energy * .32, -state.turn * .065, Math.sin(time * 5.3) * .04];
  target.scarfTip = [.13 + energy * .4 + Math.sin(time * 7 - .9) * .075, -state.turn * .04, Math.sin(time * 6.2 - 1) * .065];
  if (type === 'roll') {
    const fold = Math.sin(p * Math.PI);
    target.cape[0] -= fold * .55; target.capeTail[0] -= fold * .7;
    target.scarf[0] -= fold * 1.25; target.scarfTip[0] -= fold * .8;
  }
  target.skirtLeft = [moving * Math.max(0, -stride) * .37 + (action ? .08 : 0), 0, -.055];
  target.skirtRight = [moving * Math.max(0, stride) * .37 + (action ? .08 : 0), 0, .055];
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
      object.quaternion.slerp(state.q, 1 - Math.exp(-(name.startsWith('cape') || name.startsWith('scarf') ? 12 : action || entity?.mode === 'windup' ? 65 : 19) * dt));
    }
    object.position.copy(base.position);
    if (name === 'hips') { object.position.y += pelvisY; object.position.z += pelvisZ; }
  }
  model.position.y = rootY;
  model.rotation.x = 0; model.rotation.z = 0; model.rotation.y = yaw + spin;
  if (!airborne) {
    model.updateWorldMatrix(true, true);
    const useGait = !action && (!entity || entity.mode === 'chase' || entity.mode == null) && moving > .05;
    if (state.wasMoving !== undefined && state.wasMoving !== useGait) {
      state.gaitTransition = 0;
      for (const side of ['left', 'right']) {
        const foot = state.feet[side];
        if (foot) { foot.planted = false; foot.start ||= new THREE.Vector3(); rig[`${side}Foot`]?.getWorldPosition(foot.start); }
      }
    }
    state.wasMoving = useGait;
    state.gaitTransition = Math.min(1, state.gaitTransition + dt / .12);
    for (const side of [-1, 1]) {
      const desired = footwork?.[side < 0 ? 0 : 1] || (useGait ? gaitFoot(cycle, moving, strideScale * moving, side, backwards)
        : { x: side * .20, z: side < 0 ? .10 : -.10, lift: 0, pitch: 0, planted: true });
      solveFoot(model, rig, state, side, desired, dt, type !== 'whirl' && type !== 'dash' && !enemySweep);
    }
  } else {
    for (const foot of Object.values(state.feet)) foot.planted = false;
  }
  if (type === 'heavy' || type === 'burst' || type === 'attack' && action.step === 2) {
    supportSword(model, rig, smooth(p / .22) * (1 - smooth((p - .72) / .24)));
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
    for (const joint of [rig.head, rig.leftFoot, rig.rightFoot, rig.scarf]) {
      if (joint) clearance = Math.max(clearance, .002 - state.bounds.setFromObject(joint).min.y);
    }
    model.position.y += clearance;
  }
}
