import * as THREE from 'three';
import { animateWeaponParts } from './weaponModels.js';
import { sampleTangReady, TANG_GRIP } from './choreography/tangDao.js';
import { constrainPairedGrip } from './choreography/trajectory.js';
import { SKILL_CONTACTS } from './weapons.js';
import { sampleReviewedAttack } from './choreography/index.js';
export { getReviewedAttack, sampleReviewedAttack } from './choreography/index.js';

// Each row describes a deliberately authored contact: shoulder pitch/yaw/roll,
// elbow flexion, wrist pitch/roll and torso yaw. Cuts, points, hooks and weighted
// heads have different paths even when they share a grip.
export const WEAPON_COMBOS = {
 'dual-dao': [[-.8,.5,.8,-.5,.1,.3,.6],[-1,-.7,-.7,-.6,.2,-.3,-.65],[-1.05,.1,.3,-.4,-.2,.1,.2],[-.9,1,.9,-.3,.3,.5,1]],
 'tang-dao': [[-.9,.7,.7,-.3,-.1,.2,.55],[-1.1,-.5,-.6,-.45,.2,-.2,-.5],[-1.5,0,.1,-.12,.05,0,.08],[-1.05,.1,.12,-.25,.3,.1,.2]],
 'yanling-dao': [[-.7,.6,.85,-.6,.35,.4,.6],[-.9,-.6,-.65,-.4,-.3,-.3,-.55],[-1.8,.6,.55,-.6,.4,.2,.5],[-1.2,-.9,-.8,-.2,.1,-.4,-.8]],
 'miao-dao': [[-1,.8,.9,-.3,.1,.3,.7],[-1.2,-.9,-.8,-.25,.1,-.3,-.8],[-1.05,.05,.15,-.4,.2,0,.1],[-1.45,0,.05,-.08,.1,0,.15]],
 'ring-dao': [[-.55,.8,1,-.55,.3,.4,.8],[-1.05,.3,.3,-.3,.25,.2,.35],[-.8,-.9,-1,-.4,.3,-.4,-.85],[-1.05,-.1,.05,-.15,.35,0,-.1]],
 'pu-dao': [[-.9,.9,1,-.4,.2,.2,.85],[-1.9,-.45,-.6,-.4,.3,-.2,-.6],[-.6,-.9,-1.1,-.3,.1,-.3,-.95],[-1.05,.15,.1,-.2,.3,0,.3]],
 'longquan-jian': [[-1.45,.05,.12,-.08,.1,0,.1],[-.9,.45,.55,-.5,-.2,.2,.35],[-1.3,-.5,-.4,-.3,.1,-.1,-.45],[-1.65,-.05,.05,-.04,.05,0,-.08]],
 'dual-jian': [[-1.45,.1,.15,-.15,.1,0,.15],[-.9,-.6,-.7,-.5,-.1,-.2,-.6],[-1.4,.65,.7,-.25,.1,.2,.6],[-1.6,0,.25,-.08,0,.1,.1]],
 'guandao': [[-.6,.95,1.1,-.45,.4,.3,.9],[-1.05,.2,.25,-.35,.25,.1,.25],[-1,-1,-1,-.25,.2,-.3,-.9],[-1.05,-.1,.05,-.2,.35,0,-.15]],
 'qiang': [[-1.35,.1,.08,-.1,.1,0,.2],[-1.45,-.25,-.08,-.12,.05,0,-.25],[-1.1,.8,.8,-.4,.2,.2,.7],[-1.65,0,.05,-.03,0,0,.05]],
 'shemao': [[-1.4,.25,.2,-.15,.15,.15,.3],[-1.3,-.4,-.15,-.1,-.15,-.15,-.35],[-1.7,.15,.15,-.25,.4,.2,.2],[-1.55,-.15,.05,-.05,-.2,-.1,-.1]],
 'fangtian-ji': [[-1.4,.1,.1,-.1,.1,0,.1],[-.8,.85,.95,-.45,.3,.25,.8],[-1.05,-.8,-.85,-.3,-.2,-.2,-.8],[-1.05,.15,.1,-.25,.25,0,.15]],
 'dual-ji': [[-.8,.8,.9,-.6,.3,.3,.6],[-1.4,-.15,-.15,-.1,.05,0,-.15],[-1.1,-.75,-.8,-.4,.3,-.3,-.65],[-1.05,.3,.5,-.3,.15,.1,.25]],
 'staff': [[-1,.9,.9,-.35,.1,.2,.75],[-1,-.9,-.9,-.35,.1,-.2,-.75],[-1.05,.05,.1,-.3,.2,0,.1],[-1.5,0,0,-.05,.1,0,.1]],
 'three-section-staff': [[-.65,.8,1,-.55,.6,.5,.8],[-1.2,-.65,-.8,-.4,-.4,-.5,-.65],[-2.1,.7,.6,-.7,.5,.3,.55],[-.9,-1,-1.1,-.2,.35,-.4,-1]],
 'nine-section-whip': [[-.6,.85,1.1,-.3,.55,.6,.7],[-1.6,-.65,-.8,-.25,-.5,-.55,-.6],[-2,.4,.7,-.4,.5,.4,.45],[-.75,1.1,1.25,-.15,.6,.7,1]],
 'iron-whip': [[-1,.5,.6,-.4,.15,.2,.45],[-1.05,.15,.2,-.3,.3,.1,.2],[-.8,-.65,-.7,-.35,.2,-.2,-.6],[-1.45,0,.1,-.08,.15,0,.1]],
 'dual-jian-maces': [[-1.05,.15,.35,-.45,.35,.1,.2],[-.8,-.7,-.8,-.4,.3,-.3,-.65],[-1.05,.75,.85,-.35,.25,.3,.65],[-1.05,0,.25,-.2,.4,0,.05]],
 'wolf-club': [[-1.05,.2,.2,-.55,.3,.1,.25],[-.65,.9,1.05,-.45,.4,.3,.9],[-.9,-.8,-.9,-.4,.3,-.3,-.8],[-1.05,0,.08,-.15,.4,0,.05]],
 'dual-axes': [[-1.8,.5,.6,-.4,.4,.2,.4],[-1.9,-.45,-.65,-.35,.35,-.2,-.4],[-.7,.8,1,-.5,.45,.4,.75],[-1.05,0,.35,-.2,.45,.15,.1]],
 'war-hammer': [[-1.05,.05,.15,-.5,.35,0,.1],[-.6,.9,1,-.4,.4,.3,.85],[-1.35,-.4,-.55,-.35,.3,-.2,-.5],[-1.05,0,.05,-.12,.45,0,.05]],
 'hook-swords': [[-.8,.75,.95,-.6,.5,.5,.65],[-1.1,-.7,-.85,-.8,-.35,-.45,-.6],[-1.55,.3,.5,-.45,.6,.35,.3],[-.9,-.95,-1,-.2,.35,-.55,-.9]],
 'emei-piercers': [[-1.2,.15,.05,-.2,0,.3,.2],[-1.3,-.2,-.1,-.25,0,-.3,-.25],[-.95,.5,.45,-.7,-.1,.5,.4],[-1.45,0,.15,-.08,0,.2,.05]],
 'mandarin-yue': [[-.8,.5,.65,-.65,.45,.6,.45],[-1.1,-.45,-.55,-.7,-.4,-.6,-.4],[-1.7,.15,.3,-.45,.5,.45,.25],[-.7,-.8,-.9,-.25,.4,-.55,-.75]],
 'meteor-hammer': [[-.5,.95,1.2,-.35,.7,.7,.85],[-2,.3,.6,-.5,.6,.5,.4],[-.9,-1,-1.15,-.25,-.5,-.6,-.9],[-1.45,0,.15,-.05,.3,0,.1]],
 'judge-brush': [[-1.25,.1,.05,-.15,.1,.15,.1],[-1.35,-.2,-.1,-.1,.05,-.15,-.2],[-.95,.4,.4,-.6,.2,.35,.35],[-1.5,.05,.05,-.05,.1,0,.05]],
 'battle-yue': [[-1.9,.55,.65,-.45,.4,.2,.45],[-.7,-.8,-.9,-.4,.4,-.3,-.8],[-1.1,.9,1,-.35,.35,.3,.85],[-1.05,0,.1,-.15,.5,0,.1]],
};
const clamp = THREE.MathUtils.clamp;
const ease = t => { t=clamp(t,0,1); return t*t*(3-2*t); };
const longWeapons = new Set(['miao-dao','pu-dao','guandao','qiang','shemao','fangtian-ji','staff','wolf-club','war-hammer','battle-yue']);
const points = new Set(['longquan-jian','qiang','shemao','judge-brush','emei-piercers']);
const flexible = new Set(['three-section-staff','nine-section-whip','meteor-hammer']);
function guardFor(id) {
 const row=WEAPON_COMBOS[id][0];
 if(longWeapons.has(id)) return [-1.05,row[1]*.12,.12,-1.15,-.75,.05,-.08];
 if(flexible.has(id)) return [-.55,row[1]*.2,.38,-.95,-.35,.15,-.1];
 return [-.35,row[1]*.2,.2,-1.05,points.has(id)?-.45:-.25,row[5]*.25,-.07];
}
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
 const {state,phase=0,combo=0,skill=0,time=0}=pose,id=rig.weaponId;
 // Reviewed attacks author blade planes, connected grips and ankle targets.
 if(['tang-dao','yanling-dao','miao-dao','ring-dao'].includes(id)&&(state==='attack'||state==='skill')){
  applyReviewedMotion(rig,pose,plantFoot);
  animateWeaponParts(rig,pose);return;
 }
 if(id==='tang-dao'&&['idle','guard','run','walk'].includes(state)){
  applyReviewedMotion(rig,pose,plantFoot,sampleTangReady(pose.idleClock??time));
  animateWeaponParts(rig,pose);return;
 }
 if(id==='dual-dao'){
  animateWeaponParts(rig,pose);return;
 }
 if(!['idle','run','walk','guard','attack','skill'].includes(state)){animateWeaponParts(rig,pose);return;}
 const guard=guardFor(id),row=WEAPON_COMBOS[id][((combo%4)+4)%4];
 let values=guard.slice(),weight=0;
 if(state==='attack'||state==='skill'){
  const p=clamp(phase,0,1),contact=state==='skill'
   ? SKILL_CONTACTS[clamp(Math.trunc(skill),0,4)]
   : rig.weaponDefinition?.moves?.[((combo%4)+4)%4]?.contact ?? .45;
  const peak=typeof contact==='number'?clamp(contact,.2,.8):.45;
  const wind=peak*.52;
  const desired=state==='skill'?WEAPON_COMBOS[id][skill>=4?3:((skill%4)+4)%4].map((v,i)=>skill>=4&&i===6?v*1.25:v):row;
  const preparation=desired.map((v,i)=>i===0?-2.1:i===1||i===6?-v*.65:i===3?-1.35:i===4?-.25:v*.35);
  if(p<wind){const t=ease(p/wind);values=guard.map((v,i)=>THREE.MathUtils.lerp(v,preparation[i],t));}
  else if(p<peak){const t=ease((p-wind)/(peak-wind));values=preparation.map((v,i)=>THREE.MathUtils.lerp(v,desired[i],t));}
  else {const t=ease((p-peak)/(1-peak));values=desired.map((v,i)=>THREE.MathUtils.lerp(v,guard[i],t));}
  weight=Math.sin(Math.PI*p);
 }
 const [rx,ry,rz,elbow,wx,wz,twist]=values;
 const right=rig.arms[1],left=rig.arms[0];
 right.shoulder.rotation.set(rx,ry,rz);right.elbow.rotation.set(elbow,0,0);right.wrist.rotation.set(wx,points.has(id)?.08:ry*.2,wz);
 if(!rig.offhandGrip){
  const dual=rig.weaponDefinition?.grip==='dual' || ['dual-jian','dual-ji','dual-jian-maces','dual-axes','hook-swords','emei-piercers','mandarin-yue'].includes(id);
  left.shoulder.rotation.set(dual?rx*.9:-.35,dual?-ry:0,dual?-rz:-.35);
  left.elbow.rotation.set(dual?elbow:-1.2,0,0);left.wrist.rotation.set(dual?wx:-.15,0,dual?-wz:0);
 }
 // Keep the existing planted leg solver and root height; only upper-body
 // torque is replaced so contact remains grounded through the new trajectory.
 if(state==='attack'||state==='skill'){
  rig.body.rotation.set(0,twist*(flexible.has(id)?.65:points.has(id)?.18:.38),0);
  rig.body.position.set(twist*.035*weight,.875-(longWeapons.has(id)?.035:.025)*weight,points.has(id)?.09*weight:.025*weight);
  rig.chest.rotation.x=-.08;
  for(const leg of rig.legs){
   leg.hip.rotation.set(-.15,0,0);leg.knee.rotation.set(.28,0,0);leg.foot.rotation.set(-.13,0,0);
   plantFoot?.(rig,leg,1,leg.side===-1?.13:-.14,.075,leg.side*.17);
  }
 }
 const locomotion=state==='run'||state==='walk';
 const quiet=state==='idle'||state==='guard';
 const gait=pose.gaitPhase??time*7,movement=clamp(pose.moveBlend??(locomotion?1:0),0,1);
 const clock=pose.idleClock??time;
 const breath=Math.sin(clock*1.65),delayedBreath=Math.sin(clock*1.65-.28);
 rig.weaponCarryOffset={y:quiet?breath*.006:locomotion?Math.cos(gait*2-.5)*.006*movement:0,
  z:locomotion?Math.sin(gait-.35)*.012*movement:quiet?delayedBreath*.003:0};
 rig.chest.rotation.y=twist+(quiet||locomotion?rig.chest.rotation.y*.7:0);
 rig.chest.rotation.x+=weight*(longWeapons.has(id)?-.06:-.025);
 if(quiet){
  for(const arm of rig.arms){
   arm.shoulder.rotation.x+=breath*.024;
   arm.shoulder.rotation.z+=arm.side*delayedBreath*.008;
   arm.elbow.rotation.x+=delayedBreath*.034;
   arm.wrist.rotation.x+=Math.sin(clock*1.65-.45)*.012;
  }
 } else if(locomotion){
  const shaft=longWeapons.has(id)||!!rig.offhandGrip;
  right.shoulder.rotation.x-=Math.sin(gait-.18)*(shaft?.045:.11)*movement;
  right.elbow.rotation.x-=Math.sin(gait-.53)*(shaft?.035:.065)*movement;
  right.wrist.rotation.x-=(shaft?.12:.08)*movement;
  right.wrist.rotation.z+=Math.sin(gait-(flexible.has(id)?.75:.42))*(flexible.has(id)?.075:.025)*movement;
  if(!rig.offhandGrip){
   const leftPhase=gait+Math.PI;
   const freehand=rig.weaponDefinition?.grip!=='dual';
   left.shoulder.rotation.x+=(freehand?.25:0)*movement-Math.sin(leftPhase-.18)*(freehand?.33:.11)*movement;
   left.elbow.rotation.x+=(freehand?.35:0)*movement-Math.sin(leftPhase-.53)*(freehand?.11:.065)*movement;
   left.wrist.rotation.x+=Math.sin(leftPhase-.65)*.035*movement;
   left.shoulder.rotation.z+=Math.cos(leftPhase-.38)*.035*movement;
  }
 }
 animateWeaponParts(rig,pose);
 supportHand(rig);
 // Raising the wrist keeps long blades and weighted flexible ends clear of
 // the floor without moving either planted foot or stretching an arm.
 if(longWeapons.has(id)||flexible.has(id)||rig.offhandGrip){
  for(let i=0;i<18;i++){
   rig.group.updateMatrixWorld(true);
   const lowest=Math.min(...(rig.weaponTipNodes??[]).map(node=>node.getWorldPosition(new THREE.Vector3()).y));
   if(lowest>=.025)break;
   const original=right.wrist.getWorldQuaternion(new THREE.Quaternion());
   let best=lowest,bestQ=original;
   for(const direction of [-1,1]){
    rig.group.updateMatrixWorld(true);
    const candidate=original.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),direction*.12));
    right.wrist.quaternion.copy(right.elbow.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(candidate));
    supportHand(rig);rig.group.updateMatrixWorld(true);
    const height=Math.min(...(rig.weaponTipNodes??[]).map(node=>node.getWorldPosition(new THREE.Vector3()).y));
    if(height>best){best=height;bestQ=candidate;}
   }
   right.wrist.quaternion.copy(right.elbow.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bestQ));
   supportHand(rig);
   if(best<=lowest)break;
  }
 }

}

function applyReviewedMotion(rig,pose,plantFoot,readySample=null) {
 const sample=readySample??sampleReviewedAttack(rig.weaponId,pose.state==='skill'?pose.skill:pose.combo,pose.phase,pose.state);
 const {yaw,load,advance}=sample.stance;
 if(rig.weaponId==='tang-dao')for(const arm of rig.arms){
  arm.weapon.rotation.set(0,0,0);
  // Protract the shoulder girdle for the two-handed reach, so the bent
  // forearms pass in front of the breastplates instead of through them.
  arm.shoulder.position.z=TANG_GRIP.shoulderForward;
 }
 if(readySample){
  // The character already supplies breathing, weight shifts and a distance-
  // driven running gait. Preserve that full-body motion and connect the two
  // hands to the low carry; replacing its legs here would freeze locomotion.
  rig.group.updateMatrixWorld(true);
  const chestQ=rig.chest.getWorldQuaternion(new THREE.Quaternion());
  for(let i=0;i<2;i++){
   const hand=sample.hands[i];
   solveArm(rig,rig.arms[i],new THREE.Vector3(...hand.grip),chestQ.clone().multiply(new THREE.Quaternion().fromArray(hand.quaternion)),'tang');
  }
  rig.reviewedAttackSample=sample;
  return;
 }
 // Pelvis starts the turn; the chest follows. Feet remain in the character
 // frame while the hip crosses between the two support legs.
 rig.body.rotation.set(0,sample.stance.pelvisYaw??yaw*.65,0);
 // The moving Yanling stance needs knee flexion while its authored torso
 // retreats. Keep ankle cadence fixed and lower the pelvis instead of
 // shortening the planted step, which would make that foot slide.
 const movingCrouch=rig.weaponId==='yanling-dao'?.015*clamp(pose.attackCarry??0,0,1):0;
 rig.body.position.set(sample.stance.shiftX??-yaw*.07,(sample.stance.bodyHeight??.875)-load*.055-movingCrouch,advance);
 rig.chest.rotation.set(sample.stance.pitch??(-.055-load*.035),sample.stance.chestYaw??yaw*.35,0);
 rig.head.rotation.set(.02,-yaw*.25,0);
 rig.group.updateMatrixWorld(true);
 const chestQ=rig.chest.getWorldQuaternion(new THREE.Quaternion());
 for(let i=0;i<2;i++){
  const h=sample.hands[i];
  solveArm(rig,rig.arms[i],new THREE.Vector3(...h.grip),chestQ.clone().multiply(new THREE.Quaternion().fromArray(h.quaternion)),rig.weaponId==='tang-dao'?'tang':true);
 }
 const resolvedFeet=[];
 for(const leg of rig.legs){
  leg.hip.rotation.set(0,0,0);leg.knee.rotation.set(0,0,0);leg.foot.rotation.set(0,0,0);
  const carry=clamp(pose.attackCarry??0,0,1);
  // Gait phase follows root distance, not elapsed time. Match the blended
  // short step to that distance so a support ankle stays still in world space.
  const speed=pose.speed>0?clamp(pose.speed,0,1):carry;
  const cycleDistance=THREE.MathUtils.lerp(.85,2.9,speed);
  const stance=Math.max(1e-6,2*.19*carry/cycleDistance);
  const u=(((pose.gaitPhase??0)/(Math.PI*2)+(leg.side===-1?.5:0))%1+1)%1;
  const swing=clamp((u-stance)/(1-stance),0,1);
  const stride=u<stance?.19*(1-2*u/stance):THREE.MathUtils.lerp(-.19,.19,ease(swing));
  const compact=rig.weaponId==='tang-dao',authored=sample.stance.feet?.[leg.side===-1?0:1];
  const z=THREE.MathUtils.lerp(authored?.z??(leg.side===-1?(compact?.10:.16):(compact?-.07:-.12)),.026+stride,carry);
  const y=THREE.MathUtils.lerp(authored?.y??.075,.075+Math.sin(Math.PI*swing)*.10,carry);
  const x=authored?.x??leg.side*(compact?.16:.19);
  plantFoot?.(rig,leg,1,z,y,x);
  resolvedFeet.push({x,y,z});
 }
 sample.stance.feet=resolvedFeet;
 rig.pony.rotation.set(.2+load*.08,0,-yaw*.15);
 for(const cloth of rig.cloths){cloth.rotation.x=-.15-load*.16;cloth.rotation.z=-yaw*.12;}
 rig.reviewedAttackSample=sample;
}

// Quaternion blending may separate the two wrist targets for the first few
// frames of a state change; re-project the blended shaft into both arm chains.
export function reconcileWeaponGrip(rig) {
 if(rig.type!=='hero'||!rig.offhandGrip)return;
 if(!['tang-dao','miao-dao','ring-dao'].includes(rig.weaponId)||!rig.reviewedAttackSample){supportHand(rig);return;}
 // During a state blend preserve the actual primary wrist and shaft plane.
 // Only move that shaft if its support marker falls outside the left reach.
 rig.group.updateMatrixWorld(true);
 const desired=rig.reviewedShaftBlend?.quaternion.clone()??rig.arms[1].wrist.getWorldQuaternion(new THREE.Quaternion());
 if(rig.reviewedShaftBlend){
  const primary=rig.chest.worldToLocal(rig.reviewedShaftBlend.point.clone());
  if(rig.weaponId==='tang-dao'){
   // A blended shaft can put the support fist back through the chest even
   // when both endpoint poses are clear. Apply the same volume/reach guard.
   const localQ=rig.chest.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired);
   constrainPairedGrip(primary,down.clone().applyQuaternion(localQ),TANG_GRIP);
  }
  solveArm(rig,rig.arms[1],primary,desired.clone(),rig.weaponId==='tang-dao'?'tang':true);
  rig.group.updateMatrixWorld(true);
 }
 if(rig.weaponId==='ring-dao'){
  const floor=Math.min(...rig.weaponBlades().flatMap(b=>[b.heel.y,b.tip.y]));
  if(floor<.06){
   // The broad blade's interpolated carry plane can dip during entry. Raise
   // the entire connected shaft, retaining its blended orientation.
   const point=rig.arms[1].wrist.getWorldPosition(new THREE.Vector3());point.y+=.06-floor;
   const primary=rig.chest.worldToLocal(point);
   solveArm(rig,rig.arms[1],primary,desired.clone(),rig.weaponId==='tang-dao'?'tang':true);
   rig.group.updateMatrixWorld(true);
  }
 }
 const target=rig.chest.worldToLocal(rig.offhandGrip.getWorldPosition(new THREE.Vector3()));
 const shoulder=rig.arms[0].shoulder.position,delta=target.clone().sub(shoulder);
 if(delta.length()>.549){
  const correction=shoulder.clone().add(delta.setLength(.549)).sub(target);
  const primary=rig.chest.worldToLocal(rig.arms[1].wrist.getWorldPosition(new THREE.Vector3())).add(correction);
  solveArm(rig,rig.arms[1],primary,desired.clone(),rig.weaponId==='tang-dao'?'tang':true);
  rig.group.updateMatrixWorld(true);
 }
 solveArm(rig,rig.arms[0],rig.chest.worldToLocal(rig.offhandGrip.getWorldPosition(new THREE.Vector3())),desired,rig.weaponId==='tang-dao'?'tang':true);
}
