import * as THREE from 'three';
import {bladeOrientation, sampleAuthoredTracks, authoredChestTransform} from './trajectory.js';

// The reference package has two-handed halberd clips, but no hammer family.
// This original chain keeps their longer weighted attack/recovery cadence.
export const HAMMER_GRIP = {supportDistance:.22, shoulderForward:.16, armReach:.535, handClearance:true,rearLength:.31};
export const HAMMER_HEAD = {length:1.25, halfExtents:[.27,.19,.19], floor:.062};
const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray()});
const ready=hand([.18,.11,.44],[.78,-.55,.31]);
const carries=[ready,
  hand([-.16,.10,.43],[-.87,-.35,.35]),
  hand([.18,.23,.43],[.82,.31,.48]),
  hand([-.13,.20,.44],[-.88,.14,.46]),
  ready];
const bodies=[
  [0,0,-.07,0,0,.875,0,0,0],
  [-.58,-.23,.12,.035,.12,.805,.06,.12,-.055],
  [.56,.22,-.035,-.035,.13,.79,-.045,-.12,.055],
  [-.67,-.25,.13,.04,.15,.78,.075,.14,-.065],
  [0,0,-.07,0,0,.875,0,0,0]];
const feet=[
  [[-.23,.075,.10],[.23,.075,-.12]],
  [[-.25,.075,.31],[.23,.075,-.12]],
  [[-.25,.075,.31],[.25,.075,.18]],
  [[-.25,.075,.07],[.25,.075,.18]],
  [[-.23,.075,.10],[.23,.075,-.12]]];
const techniques=[
  {name:'摆腰横抡',duration:.98,release:.43,contact:.55,finish:.67,brake:.83,turn:[.92,-1.00],step:0,
    chamber:hand([.16,.27,.44],[.97,-.05,.24]),cross:hand([.03,.15,.48],[0,-.14,.99]),
    exit:hand([-.15,.12,.44],[-.94,-.24,.23])},
  {name:'反向上挑',duration:1.06,release:.44,contact:.56,finish:.68,brake:.84,turn:[-1.00,.98],step:1,
    chamber:hand([-.16,.08,.46],[-.88,-.44,.19]),cross:hand([.05,.23,.48],[.02,.13,.99]),
    exit:hand([.14,.42,.43],[.84,.46,.28])},
  {name:'回身重扫',duration:1.14,release:.43,contact:.56,finish:.69,brake:.85,turn:[1.14,-1.17],step:0,
    chamber:hand([.17,.31,.45],[.93,.21,-.28]),cross:hand([-.01,.20,.49],[0,-.08,1]),
    exit:carries[3]},
  {name:'过顶砸地',duration:1.24,release:.47,contact:.59,finish:.71,brake:.86,turn:[.48,-.37],step:1,
    chamber:hand([.12,.60,.43],[.12,.95,.26]),cross:hand([.05,.24,.48],[.03,.08,.996]),
    exit:hand([.12,.08,.45],[.04,-.66,.75])}];
const stance=values=>({yaw:0,load:0,pelvisYaw:values[0],chestYaw:values[1],pitch:values[2],
  shiftX:values[3],advance:values[4],bodyHeight:values[5],bodyPitch:values[6],bodyRoll:values[7],chestRoll:values[8]});
function endpointHands(pose,body){
  const inverse=authoredChestTransform(stance(body)).q.invert();
  const axis=new THREE.Vector3(...pose.axis).applyQuaternion(inverse);
  const q=bladeOrientation(axis.toArray(),new THREE.Vector3(1,0,0).applyQuaternion(inverse).toArray()).toArray();
  return [{...pose,quaternion:q},{...pose,quaternion:q}];
}
export function getHammerAttack(id,combo=0,state='attack'){
  if(id!=='great-hammer'||state!=='attack')return null;
  const index=((combo%4)+4)%4,t=techniques[index];
  const start=t.release+.025,end=t.finish-.025;
  return {...t,index,weaponId:id,kind:'smash',strikeVolume:'hammer-head',
    reach:[2.00,2.02,2.06,2.00][index],halfAngle:[1.7,1.7,2.2,1.0][index],
    active:[start,end],swing:[t.release,t.finish],
    contacts:[{hand:1,kind:'smash',phase:t.contact,start,end,window:[start,end]}],
    ...HAMMER_GRIP,headLength:HAMMER_HEAD.length,headRadius:.27,headHalfExtents:HAMMER_HEAD.halfExtents,
    width:.38,midLength:HAMMER_HEAD.length,tipLength:1.44,tipOffset:[0,-1.44,0],rootFrame:true,
    minTilt:-1.00,bodyGripFollow:[.60,.45,.65],bodyGripRotation:.82,
    initialHands:endpointHands(carries[index],bodies[index]),
    finalHands:endpointHands(carries[index+1],bodies[index+1]),cacheKey:`great-hammer-v4:${index}`};
}
const ease=value=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
function authoredFeet(spec,p){
  const start=feet[spec.index],end=feet[spec.index+1],landing=.30,progress=ease((p-.06)/(landing-.06));
  const settle=ease((p-spec.brake)/(1-spec.brake));
  return start.map((point,index)=>{
    const target=index===spec.step?(spec.index===3?[.25,.075,.35]:end[index]):point;
    const out=point.map((v,k)=>THREE.MathUtils.lerp(v,target[k],index===spec.step?progress:0));
    if(index===spec.step&&p>.06&&p<landing)out[1]+=.105*Math.sin(Math.PI*(p-.06)/(landing-.06));
    out.forEach((v,k)=>out[k]=THREE.MathUtils.lerp(v,end[index][k],settle));
    if(spec.index===3&&index===spec.step&&p>spec.brake)out[1]+=.085*Math.sin(Math.PI*(p-spec.brake)/(1-spec.brake));
    return {x:out[0],y:out[1],z:out[2]};
  });
}
function tracks(spec){
  const {index,release,contact,finish,brake,turn:[a,b]}=spec,wind=release-.08;
  const start=carries[index],end=carries[index+1],heavy=index===3,side=index===1?-1:1;
  const keys=[{p:0,...start,stop:true},{p:wind,...spec.chamber,stop:true},{p:release,...spec.chamber,stop:true},
    {p:contact,...spec.cross},{p:finish,...spec.exit,stop:true},{p:brake,...spec.exit,stop:true},{p:1,...end,stop:true}];
  keys.forEach(key=>key.angles=[Math.atan2(key.axis[0],key.axis[2]),Math.asin(key.axis[1])]);
  const body=[{p:0,values:bodies[index],stop:true},
    {p:wind,values:[a*.72,a*.23,-.11,a*.035,.025,.805,-.04,-side*.105,side*.045],stop:true},
    {p:release,values:[a*.48,a*.25,-.09,a*.025,.07,.785,-.015,-side*.13,side*.055],stop:true},
    {p:contact-.03,values:[b*.24,a*.19,heavy?.15:.08,-b*.035,.14,.755,heavy?.075:.035,side*.035,-side*.04]},
    {p:contact+.065,values:[b*.78,b*.31,heavy?.27:.14,-b*.04,.19,.735,heavy?.14:.075,side*.155,-side*.075]},
    {p:brake,values:bodies[index+1],stop:true},{p:1,values:bodies[index+1],stop:true}];
  return {tracks:[[{p:0,...start},{p:1,...end}],keys],body,
    torso:[{p:0,values:[0,0],stop:true},{p:wind,values:[a,.55],stop:true},
      {p:contact,values:[b*.65,.35]},{p:brake,values:[0,0],stop:true},{p:1,values:[0,0],stop:true}],
    feet:p=>authoredFeet(spec,p)};
}
export function sampleHammerAttack(id,combo=0,phase=0,state='attack'){
  const spec=getHammerAttack(id,combo,state);
  return spec?sampleAuthoredTracks(spec,tracks(spec),phase):null;
}
export function sampleHammerReady(clock=0){
  const breath=Math.sin(clock*1.45-.4),axis=new THREE.Vector3(...ready.axis);
  const primary=new THREE.Vector3(...ready.grip).add(new THREE.Vector3(0,breath*.006,0));
  const quaternion=bladeOrientation(axis.toArray()).toArray();
  return {hands:[{grip:primary.clone().addScaledVector(axis,-HAMMER_GRIP.supportDistance).toArray(),quaternion},
    {grip:primary.toArray(),quaternion}],stance:{yaw:0,load:0,advance:0},contacts:[],name:'heavy hammer low carry'};
}
