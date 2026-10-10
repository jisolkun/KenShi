import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks, authoredChestTransform } from './trajectory.js';

// A body-led four-cut chain. These are original game timings, not a frame
// transcription of Undead Slayer: a slow loaded step releases a short burst.
export const GREAT_GRIP = { supportDistance: .22, shoulderForward: .12, armReach: .525, handClearance: true };
const hand = (grip, axis) => ({ grip, axis: new THREE.Vector3(...axis).normalize().toArray() });
const ready = hand([.18,.17,.40], [.84,-.26,.48]);
const carries = [ready,
  hand([-.19,.20,.36], [-.96,-.16,.23]),
  hand([.25,.27,.37], [.91,.28,.29]),
  hand([-.24,.35,.30], [-.94,.18,-.29]),
  ready,
];
// pelvis yaw, chest yaw, chest pitch, root x/z/height, pelvis pitch/roll,
// chest roll. The first three endpoints retain their weight and footwork.
const bodies = [
  [0,0,-.06,0,0,.875,0,0,0],
  [-.60,-.22,.10,.04,.13,.82,.05,.12,-.04],
  [.58,.18,.08,-.04,.14,.80,.05,-.13,.05],
  [-.72,-.25,.09,.045,.15,.79,.07,.14,-.045],
  [0,0,-.06,0,0,.875,0,0,0],
];
const feet = [
  [[-.21,.075,.12],[.21,.075,-.12]],
  [[-.24,.075,.38],[.21,.075,-.12]],
  [[-.24,.075,.38],[.25,.075,.19]],
  [[-.25,.075,.08],[.25,.075,.19]],
  [[-.21,.075,.12],[.21,.075,-.12]],
];
const techniques = [
  // Each chamber is deliberately outside the shoulder line. The wrists only
  // travel a few centimetres in a cut, while the hips turn the long blade
  // through the whole arc. This keeps the edge path broad without detaching
  // the hands from a reachable, two-handed hilt.
  { name:'踏步横扫', kind:'cut', duration:.56, contact:.64, window:[.48,.84], wind:.43, brake:.93,
    chamber:hand([.20,.36,.38],[.93,.24,-.15]), cross:hand([.015,.27,.48],[0,.08,.997]),
    exit:hand([-.22,.16,.39],[-.93,-.23,.26]), turn:[1.12,-1.16], step:0, reach:2.15 },
  { name:'反向斜劈', kind:'cut', duration:.52, contact:.64, window:[.48,.85], wind:.43, brake:.93,
    chamber:hand([-.20,.58,.38],[-.84,.51,.18]), cross:hand([.015,.30,.48],[.04,.055,.998]),
    exit:hand([.22,.13,.39],[.94,-.29,.17]), turn:[-1.14,1.18], step:1, reach:2.18 },
  { name:'回身大扫', kind:'cut', duration:.50, contact:.66, window:[.47,.91], wind:.42, brake:.96,
    // Load behind the lead hip, then let the planted foot and waist unwind
    // together. The blade is visibly drawn around the back before it crosses
    // the front lane, giving this third beat a martial full-body pivot.
    chamber:hand([.12,.26,.42],[.94,.08,-.33]), cross:hand([.015,.23,.48],[0,.025,1]),
    exit:carries[3], turn:[1.24,-1.34], step:0, reach:2.22 },
  { name:'踏地重劈', kind:'chop', duration:.68, contact:.67, window:[.55,.80], wind:.49, brake:.87,
    // A high, diagonal chamber reads as a loaded overhead cut. It falls past
    // the centre line into a low opposite-side brake instead of stopping at
    // the hero's toes, so the final silhouette has a clean, decisive finish.
    chamber:hand([.13,.61,.40],[.10,.94,.33]), cross:hand([.03,.34,.48],[0,.10,.995]),
    exit:hand([.15,.13,.42],[.08,-.60,.80]), turn:[.72,-.56], step:1, reach:2.18 },
];
const stance = values => ({ yaw:0, load:0, pelvisYaw:values[0], chestYaw:values[1], pitch:values[2],
  shiftX:values[3], advance:values[4], bodyHeight:values[5], bodyPitch:values[6], bodyRoll:values[7], chestRoll:values[8] });
function orientationHands(pose, body) {
  const inverse = authoredChestTransform(stance(body)).q.invert();
  const axis = new THREE.Vector3(...pose.axis).applyQuaternion(inverse);
  const quaternion = bladeOrientation(axis.toArray(), new THREE.Vector3(1,0,0).applyQuaternion(inverse).toArray()).toArray();
  return [{...pose,quaternion}, {...pose,quaternion}];
}
export function getGreatAttack(id, combo=0, state='attack') {
  if (id !== 'great-dao' || state !== 'attack') return null;
  const index=((combo%4)+4)%4, technique=techniques[index];
  const [release,finish]=technique.window, start=release+.035, end=finish-.05;
  return { ...technique, weaponId:id, index, active:[start,end], swing:[release,finish],
    contacts:[{hand:1,kind:technique.kind,phase:technique.contact,start,end,window:[start,end],edgeWindow:true}],
    width:.22, halfAngle:index===2?2.18:1.76, ...GREAT_GRIP,
    midLength:.82, tipLength:1.509, tipOffset:[0,-1.509,0], rootFrame:true,
    minTilt:index===3?-.70:-.54,
    // The grip root follows the loaded waist instead of tracing a stationary
    // circle while the character merely turns underneath it.
    bodyGripFollow:[.55,.4,.65], bodyGripRotation:.85,
    initialHands:orientationHands(carries[index],bodies[index]),
    finalHands:orientationHands(carries[index+1],bodies[index+1]),
    cacheKey:`great-dao-v4:${index}` };
}
const ease = u => {u=THREE.MathUtils.clamp(u,0,1);return u*u*(3-2*u);};
function feetFor(spec,p) {
  const initial=feet[spec.index], final=feet[spec.index+1], lead=spec.step;
  const landing=spec.swing[0]-.065, travel=ease((p-.06)/(landing-.06));
  const recovery=ease((p-spec.swing[1])/(1-spec.swing[1]));
  return initial.map((f,index)=>{
    const landingFoot=index===lead?(spec.index===3?[.25,.075,.43]:final[index]):f;
    const step=index===lead?travel:0;
    const point=f.map((value,k)=>THREE.MathUtils.lerp(value,landingFoot[k],step));
    if(index===lead&&p>.06&&p<landing)point[1]+=.105*Math.sin(Math.PI*(p-.06)/(landing-.06));
    point.forEach((value,k)=>point[k]=THREE.MathUtils.lerp(value,final[index][k],recovery));
    // Only the last lead foot returns. The other planted foot supports the
    // recovery, including the return from the low final blow.
    if(spec.index===3&&index===lead&&p>spec.swing[1])point[1]+=.085*Math.sin(Math.PI*(p-spec.swing[1])/(1-spec.swing[1]));
    return {x:point[0],y:point[1],z:point[2]};
  });
}
function tracksFor(spec) {
  const {contact:c,wind,brake,chamber,cross,exit,turn:[a,b],index}=spec;
  const start=carries[index], end=carries[index+1], release=spec.swing[0], finish=spec.swing[1];
  const keys=[{p:0,...start,stop:true},{p:wind,...chamber,stop:true},{p:release,...chamber,stop:true},
    {p:c,...cross},{p:finish,...exit,stop:true},{p:brake,...exit,stop:true},{p:1,...end,stop:true}];
  for(const key of keys)key.angles=[Math.atan2(key.axis[0],key.axis[2]),Math.asin(key.axis[1])];
  const side=index===1?-1:1, heavy=index===3;
  const body=[{p:0,values:bodies[index],stop:true},
    {p:wind-.075,values:[a*.72,a*.20,-.10,a*.035,.065,.815,-.035,-side*.095,side*.045]},
    {p:release,values:[a*.40,a*.29,-.09,a*.025,.095,.795,-.02,-side*.13,side*.07]},
    // The planted foot and pelvis initiate the burst, then the chest catches
    // the moving blade. Forward pressure and counter-lean persist on braking.
    {p:c-.035,values:heavy
      ? [b*.25,a*.26,.14,-b*.035,.17,.775,.085,side*.055,-side*.04]
      : [b*.25,a*.26,.10,-b*.035,.17,index===2?.75:.775,.065,side*.02,-side*.025]},
    {p:c+.075,values:heavy
      ? [b*.80,b*.32,.24,-b*.05,.205,.755,.12,side*.17,-side*.075]
      : [b*.80,b*.32,.13,-b*.05,.205,index===2?.74:.765,.07,side*.145,-side*.065]},
    {p:brake,values:bodies[index+1],stop:true},{p:1,values:bodies[index+1],stop:true}];
  return {tracks:[[{p:0,...start},{p:1,...end}],keys],body,
    torso:[{p:0,values:[0,0],stop:true},{p:wind,values:[a,.40]},
      {p:c,values:[b*.65,.30]},{p:brake,values:[0,0],stop:true},{p:1,values:[0,0],stop:true}],
    feet:p=>feetFor(spec,p)};
}
export function sampleGreatAttack(id,combo=0,phase=0,state='attack') {
  const spec=getGreatAttack(id,combo,state);
  return spec?sampleAuthoredTracks(spec,tracksFor(spec),phase):null;
}
export function sampleGreatReady(clock=0) {
  const follow=Math.sin(clock*1.8-.35), pose=hand([ready.grip[0],ready.grip[1]+follow*.008,ready.grip[2]],
    [ready.axis[0],ready.axis[1]+follow*.008,ready.axis[2]]);
  const quaternion=bladeOrientation(pose.axis).toArray(), axis=new THREE.Vector3(...pose.axis);
  return {hands:[{grip:new THREE.Vector3(...pose.grip).addScaledVector(axis,-GREAT_GRIP.supportDistance).toArray(),quaternion},
    {grip:pose.grip,quaternion}],stance:{yaw:0,load:0,advance:0},contacts:[],name:'weighted two-hand carry'};
}
