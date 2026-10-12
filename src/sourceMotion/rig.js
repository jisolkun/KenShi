import * as THREE from 'three';
import {sampleSourceStyledWeapon} from './authored.js';
import {getSourceActionProfile, getSourceAttackProfile, getSourceMotionProvenance} from './catalogue.js';
import {sampleSourceLocomotion} from './clock.js';
import {sampleReferenceCurveMotion, sampleReferenceCurveBlend, createReferenceCurveBlendWorkspace} from './sampler.js';

export const SOURCE_HERO_RIG_SCALE = .9;
const boneParents = [-1,0,1,1,3,4,1,6,7,0,9,10,0,12,13,8];
const inverse = new THREE.Quaternion();
const modelAxis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), Math.PI);
const point = new THREE.Vector3(), wrist = new THREE.Vector3();
const shoeCorners = [-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z =>
  new THREE.Vector3(x*.0715, y > 0 ? .036 : -.0685, z > 0 ? .198 : -.072))));

/** Match the reference evaluator's skeleton before geometry is merged. The
 * longitudinal mesh adjustment keeps each sleeve/boot spanning its joints. */
export function configureSourceHeroSkeleton({body,chest,head,arms,legs,cloths}) {
  const scale = SOURCE_HERO_RIG_SCALE;
  body.position.y = scale;
  // Armour and cape keep their visual height when the chest pivot moves from
  // .15 to the source's pelvis origin. Animated joint anchors are independent.
  for (const child of chest.children) if (child.isMesh) child.position.y += .15;
  for (const cloth of cloths) if (cloth.parent === chest) cloth.position.y += .15;
  chest.position.set(0,0,0);
  head.position.set(0,.73*scale,.02*scale);
  const stretch = (node, ratio) => {
    for (const child of node.children) if (child.isMesh) {
      child.position.y *= ratio;
      child.scale.y *= ratio;
    }
  };
  for (const arm of arms) {
    arm.shoulder.position.set(arm.side*.42*scale,.52*scale,0);
    stretch(arm.shoulder,.39*scale/.29);
    stretch(arm.elbow,.35*scale/.27);
    arm.elbow.position.set(0,-.39*scale,0);
    arm.wrist.position.set(0,-.35*scale,.015*scale);
  }
  for (const leg of legs) {
    leg.hip.position.set(leg.side*.19*scale,-.05*scale,0);
    stretch(leg.hip,.46*scale/.41);
    stretch(leg.knee,.43*scale/.395);
    leg.knee.position.set(0,-.46*scale,0);
    leg.foot.position.set(0,-.43*scale,0);
  }
}

function createState(rig) {
  const bones = [rig.body,rig.chest,rig.head,
    rig.arms[0].shoulder,rig.arms[0].elbow,rig.arms[0].wrist,
    rig.arms[1].shoulder,rig.arms[1].elbow,rig.arms[1].wrist,
    rig.legs[0].hip,rig.legs[0].knee,rig.legs[0].foot,
    rig.legs[1].hip,rig.legs[1].knee,rig.legs[1].foot,rig.arms[1].weapon];
  return {
    weaponId: rig.weaponId, bones,
    world: bones.map(() => new THREE.Quaternion()),
    leftWeaponWorld: new THREE.Quaternion(),
    blend: createReferenceCurveBlendWorkspace(),
    frame: new Float64Array(91), attachments: new Float64Array(10),
    lastTime: null, lastLocomotion: 'idle', lastSample: null,
    secondaryClock: 0, active: false,
  };
}

export function resetSourceHeroPose(rig) {
  rig.sourceMotionState = undefined;
  rig.sourceLocomotionClock = undefined;
  rig.sourcePose = undefined;
  rig.sourceMotionDebug = undefined;
}

function clearProceduralConstraints(rig) {
  rig.attackFootTargets = null;
  rig.reviewedShaftBlend = null;
  rig.reviewedAttackSample = null;
  rig.weaponCarryOffset = undefined;
}

function sourceShoeMinimum(rig) {
  let minimum = Infinity;
  for (const leg of rig.legs) for (const corner of shoeCorners) {
    point.copy(corner).applyMatrix4(leg.foot.matrixWorld);
    rig.group.worldToLocal(point);
    minimum = Math.min(minimum,point.y);
  }
  return minimum;
}

/** Source bone rotations are expressed in character space. Convert each to
 * its actual parent's local rotation, then correct only the weapon model's
 * longitudinal axis (+Y source, -Y retained weapon geometry). */
function applySample(rig, runtime, sampled) {
  const {frame,attachments} = sampled;
  const scale = SOURCE_HERO_RIG_SCALE;
  for (const {node,p,r,s} of rig.bind) {
    node.position.copy(p);node.rotation.copy(r);node.scale.copy(s);
  }
  for (let i=0;i<16;i++) runtime.world[i].fromArray(frame,3+i*4).normalize();
  for (let i=0;i<15;i++) {
    const parent = boneParents[i];
    if (parent < 0) runtime.bones[i].quaternion.copy(runtime.world[i]);
    else runtime.bones[i].quaternion.copy(inverse.copy(runtime.world[parent]).invert()).multiply(runtime.world[i]);
  }
  rig.body.position.fromArray(frame,0).multiplyScalar(scale);
  const moving = [rig.arms[0].shoulder,rig.arms[1].shoulder,rig.head,rig.legs[0].hip,rig.legs[1].hip];
  for (let i=0;i<moving.length;i++) moving[i].position.fromArray(frame,67+i*3).multiplyScalar(scale);
  const right = rig.arms[1].weapon, left = rig.arms[0].weapon;
  right.position.fromArray(attachments,0).multiplyScalar(scale);
  right.quaternion.copy(inverse.copy(runtime.world[8]).invert()).multiply(runtime.world[15]).multiply(modelAxis);
  if (left) {
    runtime.leftWeaponWorld.fromArray(attachments,6).normalize();
    left.position.fromArray(attachments,3).multiplyScalar(scale);
    left.quaternion.copy(inverse.copy(runtime.world[5]).invert()).multiply(runtime.leftWeaponWorld).multiply(modelAxis);
  }
  // The source has no ponytail/cape tracks. Their small follow-through uses
  // the same clip clock and torso/head twist rather than changing body poses.
  const headTurn = rig.head.rotation.y, torsoTurn = rig.chest.rotation.y;
  rig.pony.rotation.x = -.08 + Math.sin(runtime.secondaryClock*6)*.04;
  rig.pony.rotation.z = THREE.MathUtils.clamp(-headTurn*.08,-.12,.12);
  for (let i=0;i<rig.cloths.length;i++) {
    rig.cloths[i].rotation.x += Math.sin(runtime.secondaryClock*5+i)*.035;
    rig.cloths[i].rotation.z += THREE.MathUtils.clamp(-torsoTurn*.08,-.14,.14);
  }
  rig.group.updateMatrixWorld(true);
  const minimum = sourceShoeMinimum(rig);
  // Preserve every source lift/jump and vertical curve. Only an actual shoe
  // penetration can add a floor correction; floating poses are never lowered.
  const correction = Math.max(0,-minimum);
  if (correction > 0) {
    rig.body.position.y += correction;
    rig.group.updateMatrixWorld(true);
  }
  const offhandGap = rig.offhandGrip ? rig.offhandGrip.getWorldPosition(point)
    .distanceTo(rig.arms[0].wrist.getWorldPosition(wrist))/rig.group.scale.x : null;
  runtime.frame.fill(0);runtime.frame.set(frame);
  runtime.attachments.set(attachments);
  return {groundCorrection: correction,footMinY: minimum+correction,offhandGap};
}

/** Authoritative hero idle/walk/run/ordinary attack path. Returning false
 * leaves reactions, rolls, skills and all enemy animation with their caller. */
export function applySourceHeroPose(rig, pose = {}) {
  if (rig.type !== 'hero') return false;
  const state = pose.state ?? 'idle';
  const locomotion = ['idle','walk','run'].includes(state);
  if (!locomotion && state !== 'attack') return false;
  const profile = state === 'attack' ? pose.sourceAttack?.profile
    ?? getSourceAttackProfile(rig.weaponId,pose.combo ?? 0)
    : getSourceActionProfile(rig.weaponId,pose.sourceLocomotion ?? state);
  if (!profile) return false;
  let runtime = rig.sourceMotionState;
  if (!runtime || runtime.weaponId !== rig.weaponId) runtime = rig.sourceMotionState = createState(rig);
  if (pose.dt === 0 && !pose.immediate && runtime.lastSample && runtime.active) return true;
  const time = Number.isFinite(pose.time) ? pose.time : runtime.lastTime ?? 0;
  const delta = Number.isFinite(pose.dt) ? Math.max(0,pose.dt)
    : runtime.lastTime === null ? 0 : Math.max(0,time-runtime.lastTime);
  runtime.lastTime = time;
  const requestedLocomotion = pose.sourceLocomotion;
  const action = ['idle','walk','run'].includes(requestedLocomotion) ? requestedLocomotion
    : locomotion ? state : runtime.lastLocomotion;
  runtime.lastLocomotion = action;
  const samples = sampleSourceLocomotion(rig,{state:action,dt:delta,
    speedFactor:pose.speedFactor,hold:pose.dt===0&&!pose.immediate});
  let sampled,phase,segment;
  if (state === 'attack') {
    phase = THREE.MathUtils.clamp(pose.sourceAttack?.phase ?? pose.phase ?? 0,0,1);
    segment = pose.sourceAttack?.segment ?? (phase >= (profile.clipBoundaries?.[0]?.phase ?? 1) ? 'recovery' : 'attack');
    sampled = sampleReferenceCurveMotion(profile,phase);
  } else {
    sampled = sampleReferenceCurveBlend(samples,runtime.blend)
      ?? sampleReferenceCurveMotion(profile,0);
    phase = samples.find(sample => sample.state===action)?.phase ?? 0;
    segment = 'loop';
  }
  if (!sampled) return false;
  sampled=sampleSourceStyledWeapon(rig.weaponId,pose.combo??0,profile,phase,sampled);
  clearProceduralConstraints(rig);
  runtime.secondaryClock += delta;
  const diagnostics = applySample(rig,runtime,sampled);
  runtime.active = true;
  runtime.lastSample = sampled;
  rig.sourcePose = {active:true,state,profile,phase,segment,
    frame:runtime.frame,attachments:runtime.attachments,world:runtime.world,
    scale:SOURCE_HERO_RIG_SCALE,...diagnostics};
  rig.sourceMotionDebug = {active:true,state,family:profile.weaponFamily,
    clip:profile.name,phase,segment,scale:SOURCE_HERO_RIG_SCALE,authored:!!sampled.authored,
    rawTime:pose.sourceAttack?.rawTime ?? samples.find(sample=>sample.state===action)?.rawTime ?? 0,
    locomotion:samples.map(({state,phase,rawTime,weight})=>({state,phase,rawTime,weight})),
    provenance:getSourceMotionProvenance(rig.weaponId),...diagnostics};
  return true;
}
