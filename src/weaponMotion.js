import * as THREE from 'three';
import { animateWeaponParts } from './weaponModels.js';
import { sampleTangReady, TANG_GRIP } from './choreography/tangDao.js';
import { sampleGreatReady, GREAT_GRIP } from './choreography/greatDao.js';
import { constrainPairedGrip } from './choreography/trajectory.js';
import { sampleReviewedAttack } from './choreography/index.js';
export { getReviewedAttack, sampleReviewedAttack } from './choreography/index.js';

// Each row describes a deliberately authored contact: shoulder pitch/yaw/roll,
// elbow flexion, wrist pitch/roll and torso yaw. Cuts, points, hooks and weighted
// heads have different paths even when they share a grip.
export const WEAPON_COMBOS = {
 'dual-dao': [[-.8,.5,.8,-.5,.1,.3,.6],[-1,-.7,-.7,-.6,.2,-.3,-.65],[-1.05,.1,.3,-.4,-.2,.1,.2],[-.9,1,.9,-.3,.3,.5,1]],
 'tang-dao': [[-.9,.7,.7,-.3,-.1,.2,.55],[-1.1,-.5,-.6,-.45,.2,-.2,-.5],[-1.5,0,.1,-.12,.05,0,.08],[-1.05,.1,.12,-.25,.3,.1,.2]],
 'great-dao': [[-.9,.7,.7,-.3,-.1,.2,.55],[-1.1,-.5,-.6,-.45,.2,-.2,-.5],[-1.5,0,.1,-.12,.05,0,.08],[-1.05,.1,.12,-.25,.3,.1,.2]],
};
const clamp = THREE.MathUtils.clamp;
const ease = t => { t=clamp(t,0,1); return t*t*(3-2*t); };
const down=new THREE.Vector3(0,-1,0);
// Solve a two-bone arm in chest coordinates. The elbow pole keeps the upper
// arm clear of the torso; wrist orientation follows the shaft's primary hand.
function solveArm(rig,arm,point,desired,stable=false) {
 const target=point.clone().sub(arm.shoulder.position);
 const length=target.length(),a=.29,b=.27,d=clamp(length,.035,a+b-.0001),axis=target.clone().normalize();
 // Bend in front of the armour, with enough lateral separation to avoid
 // the pole becoming parallel to a forward reach and flipping the elbow.
 const pole=stable==='tang'?new THREE.Vector3(arm.side*.65,-.20,.8):stable?new THREE.Vector3(arm.side,0,0):new THREE.Vector3(arm.side,-.25,.1);
 pole.addScaledVector(axis,-pole.dot(axis)).normalize();
 const along=(a*a+d*d-b*b)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
 const elbow=axis.clone().multiplyScalar(along).addScaledVector(pole,height);
 if(stable){
  const y=elbow.clone().normalize().negate(),z=new THREE.Vector3().crossVectors(pole,axis).normalize(),x=new THREE.Vector3().crossVectors(y,z).normalize();
  z.crossVectors(x,y).normalize();
  arm.shoulder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
 }else arm.shoulder.quaternion.setFromUnitVectors(down,elbow.clone().normalize());
 const forearm=axis.clone().multiplyScalar(d).sub(elbow).normalize().applyQuaternion(arm.shoulder.quaternion.clone().invert());
 // Keep the elbow's bend plane even near a fully folded arm. The generic
 // shortest-vector quaternion loses its axis at an antiparallel forearm.
 const bendNormal=new THREE.Vector3().crossVectors(pole,axis).normalize().applyQuaternion(arm.shoulder.quaternion.clone().invert());
 if(stable)arm.elbow.quaternion.setFromAxisAngle(bendNormal,Math.acos(clamp(down.dot(forearm),-1,1)));
 else arm.elbow.quaternion.setFromUnitVectors(down,forearm);
 rig.group.updateMatrixWorld(true);
 arm.wrist.quaternion.copy(arm.elbow.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
}
function supportHand(rig) {
 const marker=rig.offhandGrip;
 if(!marker?.isObject3D)return;
 rig.group.updateMatrixWorld(true);
 const right=rig.arms[1],desired=right.wrist.getWorldQuaternion(new THREE.Quaternion());
 const hand=rig.chest.worldToLocal(right.wrist.getWorldPosition(new THREE.Vector3()));
 const support=rig.chest.worldToLocal(marker.getWorldPosition(new THREE.Vector3()));
 // Center the two grips between the shoulders. Both hands therefore stay in
 // their reachable arm spheres even when the long shaft swings behind them.
 const target=new THREE.Vector3(.015,.245+(rig.weaponCarryOffset?.y??0),.22+(rig.weaponCarryOffset?.z??0)).addScaledVector(support.sub(hand),-.5);
 solveArm(rig,right,target,desired.clone());
 rig.group.updateMatrixWorld(true);
 solveArm(rig,rig.arms[0],rig.chest.worldToLocal(marker.getWorldPosition(new THREE.Vector3())),desired);
}
export function applyWeaponPose(rig, pose, plantFoot) {
 if(rig.type!=='hero'||!WEAPON_COMBOS[rig.weaponId])return;
 const {state,time=0}=pose;
 if(['tang-dao','great-dao'].includes(rig.weaponId)&&state==='attack'){
  applyReviewedMotion(rig,pose,plantFoot);
 } else if(['tang-dao','great-dao'].includes(rig.weaponId)&&['idle','guard','run','walk'].includes(state)){
  const ready=rig.weaponId==='great-dao'?sampleGreatReady:sampleTangReady;
  applyReviewedMotion(rig,pose,plantFoot,ready(pose.idleClock??time));
 }
 animateWeaponParts(rig,pose);
}

function applyReviewedMotion(rig,pose,plantFoot,readySample=null) {
 const sample=readySample??sampleReviewedAttack(rig.weaponId,pose.combo,pose.phase,pose.state);
 const {yaw,load,advance}=sample.stance;
 const grip=rig.weaponId==='great-dao'?GREAT_GRIP:TANG_GRIP;
 const armMode='tang';
 for(const arm of rig.arms){
  arm.weapon.rotation.set(0,0,0);
  // Protract the shoulder girdle for the authored grip, so the bent
  // forearms pass in front of the breastplates instead of through them.
  arm.shoulder.position.z=grip.shoulderForward;
 }
 if(readySample){
  // The character already supplies breathing, weight shifts and a distance-
  // driven running gait. Preserve that full-body motion and connect the two
  // hands to the low carry; replacing its legs here would freeze locomotion.
  rig.group.updateMatrixWorld(true);
  const chestQ=rig.chest.getWorldQuaternion(new THREE.Quaternion());
  for(let i=0;i<2;i++){
   const hand=sample.hands[i];
   solveArm(rig,rig.arms[i],new THREE.Vector3(...hand.grip),chestQ.clone().multiply(new THREE.Quaternion().fromArray(hand.quaternion)),armMode);
  }
  rig.reviewedAttackSample=sample;
  return;
 }
 // Pelvis starts the turn; the chest follows. Feet remain in the character
 // frame while the hip crosses between the two support legs.
 const pelvisYaw=sample.stance.pelvisYaw??yaw*.65;
 const carry=clamp(pose.attackCarry??0,0,1);
 const resolvedFeet=rig.legs.map((leg,index)=>{
  const speed=pose.speed>0?clamp(pose.speed,0,1):carry;
  const cycleDistance=THREE.MathUtils.lerp(.85,2.9,speed);
  const stance=Math.max(1e-6,2*.19*carry/cycleDistance);
  const u=(((pose.gaitPhase??0)/(Math.PI*2)+(leg.side===-1?.5:0))%1+1)%1;
  const swing=clamp((u-stance)/(1-stance),0,1);
  const stride=u<stance?.19*(1-2*u/stance):THREE.MathUtils.lerp(-.19,.19,ease(swing));
  const authored=sample.stance.feet?.[index];
  return {x:authored?.x??leg.side*.16,
   y:THREE.MathUtils.lerp(authored?.y??.075,.075+Math.sin(Math.PI*swing)*.10,carry),
   z:THREE.MathUtils.lerp(authored?.z??(index?-.07:.10),.026+stride,carry)};
 });
 if(rig.weaponId==='great-dao'&&carry>0){
  // Travelling gait and authored action phase are independent. Lower the
  // loaded pelvis enough for the *blended* foot targets, including its tilt.
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.stance.bodyPitch??0,pelvisYaw,sample.stance.bodyRoll??0));
  resolvedFeet.forEach((foot,index)=>{
   const hip=rig.legs[index].hip.position.clone().applyQuaternion(q);
   const dx=hip.x+(sample.stance.shiftX??-yaw*.07)-foot.x;
   const dz=hip.z+advance-foot.z;
   const ceiling=foot.y-hip.y+Math.sqrt(Math.max(.10,.795*.795-dx*dx-dz*dz));
   sample.stance.bodyHeight=Math.min(sample.stance.bodyHeight??.875,ceiling);
  });
 }
 rig.body.rotation.set(sample.stance.bodyPitch??0,pelvisYaw,sample.stance.bodyRoll??0);
 rig.body.position.set(sample.stance.shiftX??-yaw*.07,(sample.stance.bodyHeight??.875)-load*.055,advance);
 rig.chest.rotation.set(sample.stance.pitch??(-.055-load*.035),sample.stance.chestYaw??yaw*.35,sample.stance.chestRoll??0);
 rig.head.rotation.set(.02,-yaw*.25,0);
 rig.group.updateMatrixWorld(true);
 const chestQ=rig.chest.getWorldQuaternion(new THREE.Quaternion());
 for(let i=0;i<2;i++){
  const h=sample.hands[i];
  solveArm(rig,rig.arms[i],new THREE.Vector3(...h.grip),chestQ.clone().multiply(new THREE.Quaternion().fromArray(h.quaternion)),armMode);
 }
 for(const [index,leg] of rig.legs.entries()){
  leg.hip.rotation.set(0,0,0);leg.knee.rotation.set(0,0,0);leg.foot.rotation.set(0,0,0);
  const {x,y,z}=resolvedFeet[index];
  plantFoot?.(rig,leg,1,z,y,x);
 }
 sample.stance.feet=resolvedFeet;
 rig.pony.rotation.set(.2+load*.08,0,-yaw*.15);
 for(const cloth of rig.cloths){cloth.rotation.x=-.15-load*.16;cloth.rotation.z=-yaw*.12;}
 rig.reviewedAttackSample=sample;
}

// Keep blended palms clear of armour. For two-handed grips also re-project
// the blended shaft into both arm chains during a state change.
export function reconcileWeaponGrip(rig) {
 if(rig.type!=='hero'||!rig.offhandGrip)return;
 if(!['tang-dao','great-dao'].includes(rig.weaponId)||!rig.reviewedAttackSample){supportHand(rig);return;}
 const grip=rig.weaponId==='great-dao'?GREAT_GRIP:TANG_GRIP;
 // During a state blend preserve the actual primary wrist and shaft plane.
 // Only move that shaft if its support marker falls outside the left reach.
 rig.group.updateMatrixWorld(true);
 const desired=rig.reviewedShaftBlend?.quaternion.clone()??rig.arms[1].wrist.getWorldQuaternion(new THREE.Quaternion());
 if(rig.reviewedShaftBlend){
  const primary=rig.chest.worldToLocal(rig.reviewedShaftBlend.point.clone());
  if(grip.handClearance){
   // A blended shaft can put the support fist back through the chest even
   // when both endpoint poses are clear. Apply the same volume/reach guard.
   const localQ=rig.chest.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired);
   const axis=down.clone().applyQuaternion(localQ);
   constrainPairedGrip(primary,axis,grip);
   if(rig.weaponId==='great-dao'){
    // A shortest quaternion blend from the broad returning sweep into carry
    // can dip the long tip below ground even when both endpoint poses clear.
    // Project the entire connected hilt upward, retaining reach and palm
    // clearance, instead of shortening or hiding the rendered blade.
    const up=new THREE.Vector3(0,1,0).applyQuaternion(rig.chest.getWorldQuaternion(new THREE.Quaternion()).invert());
    for(let pass=0;pass<12;pass++){
     const tip=rig.chest.localToWorld(primary.clone()).addScaledVector(down.clone().applyQuaternion(desired),1.509);
     if(tip.y>=.055)break;
     primary.addScaledVector(up,.055-tip.y);
     constrainPairedGrip(primary,axis,grip);
    }
   }
  }
  solveArm(rig,rig.arms[1],primary,desired.clone(),'tang');
  rig.group.updateMatrixWorld(true);
 }
 const target=rig.chest.worldToLocal(rig.offhandGrip.getWorldPosition(new THREE.Vector3()));
 const shoulder=rig.arms[0].shoulder.position,delta=target.clone().sub(shoulder);
 if(delta.length()>.549){
  const correction=shoulder.clone().add(delta.setLength(.549)).sub(target);
  const primary=rig.chest.worldToLocal(rig.arms[1].wrist.getWorldPosition(new THREE.Vector3())).add(correction);
  solveArm(rig,rig.arms[1],primary,desired.clone(),'tang');
  rig.group.updateMatrixWorld(true);
 }
 solveArm(rig,rig.arms[0],rig.chest.worldToLocal(rig.offhandGrip.getWorldPosition(new THREE.Vector3())),desired,'tang');
}
