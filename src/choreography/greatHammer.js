import * as THREE from 'three';
import {bladeOrientation, sampleAuthoredPoseTracks, authoredChestTransform} from './trajectory.js';

// Original hammer chain: the supplied reference has weighted action clocks,
// but no hammer family. Each exit's momentum feeds the next distinct plane.
export const HAMMER_GRIP={supportDistance:.22,shoulderForward:.16,armReach:.535,handClearance:true,rearLength:.31};
export const HAMMER_HEAD={length:1.25,halfExtents:[.27,.19,.19],floor:.072};
const hand=(grip,azimuth,tilt)=>({grip,angles:[azimuth,tilt],axis:[Math.sin(azimuth)*Math.cos(tilt),Math.sin(tilt),Math.cos(azimuth)*Math.cos(tilt)]});
const ready=hand([.17,.08,.44],1.08,-.52);
const carries=[ready,hand([-.07,.00,.46],-.48,-.60),hand([-.08,.34,.42],-.88,.72),hand([.10,.41,.42],.65,.98),ready];
const bodies=[
 [.05,-.02,-.06,.025,0,.86,0,.06,-.025],
 [-.18,-.11,.12,-.025,.12,.76,.045,-.055,.035],
 [-.24,-.12,-.07,-.045,.09,.83,-.03,-.10,.045],
 [.34,.15,-.10,.035,.08,.81,-.015,.08,-.04],
 [.05,-.02,-.06,.025,0,.86,0,.06,-.025]];
const feet=[
 [[-.27,.075,.12],[.27,.075,-.15]],
 [[-.28,.075,.30],[.27,.075,-.15]],
 [[-.28,.075,.30],[.28,.075,.16]],
 [[-.32,.075,.28],[.28,.075,.12]],
 [[-.27,.075,.12],[.27,.075,-.15]]];
const techniques=[
 {name:'沉肩斜砸',duration:.80,release:.34,contact:.49,finish:.62,brake:.78,step:0,
  footwork:{lead:[.04,.30],rear:[.67,.84],width:.26,leadZ:.29,rearZ:-.16,lift:.10},
  hands:[{p:.29,...hand([.15,.39,.42],.87,.92),stop:true},{p:.34,...hand([.15,.38,.43],.87,.90)},
   {p:.49,...hand([-.02,.13,.47],-.06,-.12)},{p:.62,...carries[1],stop:true}],
  body:[{p:.20,values:[.46,.24,-.16,.05,.03,.80,-.03,-.065,.04]},
   {p:.34,values:[-.12,.30,-.04,.02,.12,.79,.03,-.02,.025]},
   {p:.49,values:[-.50,-.22,.22,-.035,.17,.74,.13,.06,-.04]},
   {p:.62,values:[-.48,-.22,.17,-.04,.15,.74,.10,.065,-.04]}]},
 {name:'拔地挑锤',duration:.68,release:.20,contact:.39,finish:.57,brake:.76,step:1,
  footwork:{lead:[.02,.18],rear:[.61,.81],width:.27,leadZ:.19,rearZ:-.06,lift:.055},
  hands:[{p:.16,...hand([-.09,-.01,.47],-.46,-.64),stop:true},{p:.20,...hand([-.09,.00,.47],-.43,-.62)},
   {p:.39,...hand([-.02,.22,.49],-.12,.12)},{p:.57,...carries[2],stop:true}],
  body:[{p:.14,values:[-.31,-.13,.19,-.04,.10,.69,.065,-.075,.045]},
   {p:.26,values:[-.10,-.16,.01,-.015,.13,.75,.005,-.02,.015]},
   {p:.39,values:[.18,.09,-.15,.025,.15,.84,-.045,.08,-.045]},
   {p:.57,values:[.12,.12,-.12,.01,.12,.85,-.04,.09,-.05]}]},
 {name:'盘身摆锤',duration:.96,release:.30,contact:.51,finish:.69,brake:.84,step:0,
  footwork:{lead:[.04,.29],rear:[.73,.91],width:.30,leadZ:.30,rearZ:-.08,lift:.09},
  hands:[{p:.22,...hand([-.08,.23,.46],-1.60,.13),stop:true},{p:.30,...hand([-.07,.21,.46],-1.58,.12)},
   {p:.51,...hand([.02,.18,.50],-.08,-.05)},{p:.69,...hand([.12,.16,.45],1.50,-.11),stop:true}],
  body:[{p:.20,values:[-.80,-.38,.03,-.05,.035,.76,.005,-.11,.06]},
   {p:.30,values:[-.53,-.39,.02,-.03,.08,.75,.01,-.10,.06]},
   {p:.48,values:[.18,-.10,.10,.005,.14,.74,.05,.045,-.025]},
   {p:.69,values:[.90,.30,.13,.05,.15,.75,.055,.13,-.07]}]},
 {name:'顿足镇岳',duration:1.20,release:.48,contact:.65,finish:.73,brake:.88,step:1,
  footwork:{lead:[.25,.44],rear:[.02,.22],width:.32,leadZ:.27,rearZ:-.13,lift:.075},
  hands:[{p:.34,...hand([.10,.55,.40],.12,1.37),stop:true},{p:.48,...hand([.08,.53,.42],.05,1.34)},
   {p:.65,...hand([.02,.18,.50],.015,-.38)},{p:.73,...hand([.02,.30,.49],.02,-.70),stop:true},
   {p:.79,...hand([.025,.26,.49],.035,-.44),stop:true},{p:.88,...hand([.045,.27,.48],.10,-.59),stop:true}],
  body:[{p:.32,values:[.06,.02,-.18,.005,.035,.68,-.055,0,0],stop:true},
   {p:.48,values:[.02,.01,-.16,0,.05,.67,-.045,0,0]},
   {p:.59,values:[0,0,.08,0,.10,.77,.07,0,0]},
   {p:.69,values:[0,0,.26,0,.19,.68,.14,0,0],stop:true},
   {p:.79,values:[0,0,.20,0,.16,.70,.10,0,0]},
   {p:.88,values:[.025,0,.16,.005,.12,.72,.065,0,0],stop:true}]}];
const stance=values=>({yaw:0,load:0,pelvisYaw:values[0],chestYaw:values[1],pitch:values[2],shiftX:values[3],advance:values[4],bodyHeight:values[5],bodyPitch:values[6],bodyRoll:values[7],chestRoll:values[8]});
function endpointHands(pose,body){
 const inverse=authoredChestTransform(stance(body)).q.invert();
 const azimuth=pose.angles[0],edge=[Math.cos(azimuth),0,-Math.sin(azimuth)];
 const q=inverse.multiply(bladeOrientation(pose.axis,edge)).toArray();
 return [{...pose,quaternion:q},{...pose,quaternion:q}];
}
export function getHammerAttack(id,combo=0,state='attack'){
 if(id!=='great-hammer'||state!=='attack')return null;
 const index=((combo%4)+4)%4,t=techniques[index],start=index===1?.27:t.release+.025,end=t.finish-.025;
 return {...t,index,weaponId:id,kind:'smash',strikeVolume:'hammer-head',reach:[1.95,1.90,2.04,1.92][index],halfAngle:[1.1,.80,2.0,.65][index],
  active:[start,end],swing:[t.release,t.finish],contacts:[{hand:1,kind:'smash',phase:t.contact,start,end,window:[start,end]}],
  ...HAMMER_GRIP,headLength:HAMMER_HEAD.length,headRadius:.27,headHalfExtents:HAMMER_HEAD.halfExtents,
  width:.38,midLength:HAMMER_HEAD.length,tipLength:1.44,tipOffset:[0,-1.44,0],rootFrame:true,minTilt:-.86,
  bodyGripFollow:[.60,.65,.65],bodyGripRotation:.58,
  initialHands:endpointHands(carries[index],bodies[index]),finalHands:endpointHands(carries[index+1],bodies[index+1]),cacheKey:`great-hammer-v5:${index}`};
}
const ease=value=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
function authoredFeet(spec,p){
 const start=feet[spec.index],end=feet[spec.index+1],settle=ease((p-spec.brake)/(1-spec.brake));
 return start.map((point,index)=>{
  const lead=index===spec.step,window=lead?spec.footwork.lead:spec.footwork.rear,progress=ease((p-window[0])/(window[1]-window[0]));
  const target=spec.index===3?[index?.32:-.32,.075,index?.27:-.13]:end[index];
  const out=point.map((v,k)=>THREE.MathUtils.lerp(v,target[k],progress));
  if(p>window[0]&&p<window[1])out[1]+=spec.footwork.lift*Math.sin(Math.PI*(p-window[0])/(window[1]-window[0]));
  out.forEach((v,k)=>out[k]=THREE.MathUtils.lerp(v,end[index][k],settle));
  return {x:out[0],y:out[1],z:out[2]};
 });
}
function tracks(spec){
 const {index,brake}=spec,start=carries[index],end=carries[index+1];
 const keys=[{p:0,...start,stop:true},...spec.hands];
 if(keys.at(-1).p<brake)keys.push({p:brake,...end,stop:true});
 keys.push({p:1,...end,stop:true});
 const body=[{p:0,values:bodies[index],stop:true},...spec.body];
 if(body.at(-1).p<brake)body.push({p:brake,values:bodies[index+1],stop:true});
 body.push({p:1,values:bodies[index+1],stop:true});
 return {tracks:[[{p:0,...start},{p:1,...end}],keys],body,
  torso:[{p:0,values:[0,0],stop:true},{p:spec.release,values:[0,.65],stop:true},{p:spec.contact,values:[0,.25]},{p:brake,values:[0,0],stop:true},{p:1,values:[0,0],stop:true}],feet:p=>authoredFeet(spec,p)};
}
export function sampleHammerAttack(id,combo=0,phase=0,state='attack'){
 const spec=getHammerAttack(id,combo,state);
 if(!spec)return null;
 const p=THREE.MathUtils.clamp(phase,0,1),sample=sampleAuthoredPoseTracks(spec,tracks(spec),p);
 // Hammer faces use a stable shaft frame. Pitch-plane strikes roll into
 // their contact face and unwind on recovery, avoiding blade-edge wrist flips.
 const transform=authoredChestTransform(sample.stance);
 const axis=sample.hands[1].axis.clone().applyQuaternion(transform.q);
 const azimuth=Math.atan2(axis.x,axis.z),face=[Math.cos(azimuth),0,-Math.sin(azimuth)];
 const roll=spec.index===2?0:Math.PI/2*ease(p/spec.release)*(1-ease((p-spec.finish)/(1-spec.finish)));
 const q=transform.q.clone().invert().multiply(bladeOrientation(axis.toArray(),face).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-roll)));
 for(const h of sample.hands){h.quaternion=q.toArray();h.tip=new THREE.Vector3(...h.grip).add(new THREE.Vector3(0,-1.44,0).applyQuaternion(q)).toArray();}
 return sample;
}
export function sampleHammerReady(clock=0){
 const breath=Math.sin(clock*1.45-.4),axis=new THREE.Vector3(...ready.axis),primary=new THREE.Vector3(...ready.grip).add(new THREE.Vector3(0,breath*.006,0));
 const quaternion=bladeOrientation(axis.toArray(),[Math.cos(ready.angles[0]),0,-Math.sin(ready.angles[0])]).toArray();
 return {hands:[{grip:primary.clone().addScaledVector(axis,-HAMMER_GRIP.supportDistance).toArray(),quaternion},{grip:primary.toArray(),quaternion}],stance:{yaw:0,load:0,advance:0},contacts:[],name:'hammer low pendulum carry'};
}
