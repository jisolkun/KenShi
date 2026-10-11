import * as THREE from 'three';
import {bladeOrientation, sampleAuthoredPoseTracks, authoredChestTransform} from './trajectory.js';

// Original hammer chain: the supplied reference has weighted action clocks,
// but no hammer family. Each exit's momentum feeds the next distinct plane.
export const HAMMER_GRIP={supportDistance:.22,shoulderForward:.16,armReach:.535,handClearance:true,rearLength:.31};
export const HAMMER_HEAD={length:1.25,halfExtents:[.27,.19,.19],floor:.072};
const hand=(grip,azimuth,tilt)=>({grip,angles:[azimuth,tilt],axis:[Math.sin(azimuth)*Math.cos(tilt),Math.sin(tilt),Math.cos(azimuth)*Math.cos(tilt)]});
const ready=hand([.17,.08,.44],1.08,-.52);
const carries=[ready,
 hand([-.13,.18,.47],-1.62,-.12),
 hand([.04,.30,.49],.22,-.69),
 hand([.10,.41,.42],.65,.98),ready];
const bodies=[
 [.05,-.02,-.06,.025,0,.86,0,.06,-.025],
 [-.72,-.26,.12,-.04,.15,.78,.03,-.10,.05],
 [.25,.08,.22,.015,.16,.72,.12,.04,-.03],
 [.70,.23,-.13,.04,.08,.81,-.025,.10,-.05],
 [.05,-.02,-.06,.025,0,.86,0,.06,-.025]];
const feet=[
 [[-.27,.075,.12],[.27,.075,-.15]],
 [[-.34,.075,.30],[.30,.075,-.14]],
 [[-.34,.075,.30],[.32,.075,.17]],
 [[-.34,.075,.29],[.32,.075,.17]],
 [[-.27,.075,.12],[.27,.075,-.15]]];
const techniques=[
 {name:'横抡开阵',duration:.48,release:.16,contact:.43,finish:.76,brake:.90,step:0,
  footwork:{lead:[.01,.25],rear:[.79,.94],width:.32,leadZ:.31,rearZ:-.14,lift:.10},
  hands:[{p:.16,...hand([.16,.20,.45],1.75,.10)},
   {p:.43,...hand([.02,.19,.51],.02,-.08)},
   {p:.76,...carries[1],stop:true}],
  body:[{p:.16,values:[.94,.30,-.06,.05,.025,.81,-.02,.11,-.055]},
   {p:.43,values:[-.10,-.04,.12,-.015,.17,.76,.045,-.01,.01]},
   {p:.76,values:[-.92,-.32,.15,-.055,.16,.76,.045,-.13,.065],stop:true}]},
 {name:'斜砸碎石',duration:.46,release:.22,contact:.54,finish:.69,brake:.86,step:1,
  footwork:{lead:[.01,.27],rear:[.78,.96],width:.33,leadZ:.25,rearZ:-.13,lift:.075},
  hands:[{p:.22,...hand([-.10,.46,.42],-.70,1.10)},
   {p:.54,...hand([.01,.20,.51],.10,-.34)},
   {p:.69,...carries[2],stop:true},
   {p:.78,...hand([.04,.30,.49],.25,-.58),stop:true}],
  body:[{p:.22,values:[-.65,-.22,-.13,-.04,.06,.82,-.04,-.09,.045]},
   {p:.54,values:[.17,.09,.22,.015,.17,.72,.12,.06,-.035]},
   {p:.69,values:[.31,.10,.27,.025,.17,.70,.14,.05,-.025],stop:true},
   {p:.78,values:[.29,.09,.20,.02,.16,.73,.105,.04,-.025]}]},
 {name:'回身狂扫',duration:.56,release:.20,contact:.49,finish:.77,brake:.90,step:0,
  footwork:{lead:[.01,.26],rear:[.80,.97],width:.34,leadZ:.33,rearZ:-.11,lift:.11},
  hands:[{p:.20,...hand([-.12,.22,.47],-1.83,.09)},
   {p:.49,...hand([.015,.18,.53],-.08,-.08)},
   {p:.77,...hand([.17,.24,.44],1.83,.10),stop:true}],
  body:[{p:.20,values:[-1.16,-.36,-.02,-.065,.035,.78,-.02,-.14,.07]},
   {p:.49,values:[.08,-.02,.10,0,.16,.76,.045,.02,-.01]},
   {p:.77,values:[1.13,.33,.05,.06,.14,.78,.015,.15,-.07],stop:true}]},
 {name:'震地破阵',duration:.68,release:.27,contact:.56,finish:.70,brake:.87,step:1,
  footwork:{lead:[.14,.32],rear:[.01,.12],width:.32,leadZ:.27,rearZ:-.08,lift:.09},
  hands:[{p:.27,...hand([.09,.57,.40],.08,1.38)},
   {p:.56,...hand([.02,.18,.50],.015,-.38)},
   {p:.70,...hand([.02,.32,.49],.02,-.63),stop:true},
   {p:.78,...hand([.025,.26,.49],.035,-.43),stop:true},
   {p:.87,...hand([.045,.27,.48],.10,-.59),stop:true}],
  body:[{p:.27,values:[.03,.01,-.19,0,.05,.82,-.05,0,0]},
   {p:.46,values:[0,0,.07,0,.11,.78,.06,0,0]},
   {p:.64,values:[0,0,.24,0,.15,.72,.10,0,0],stop:true},
   {p:.78,values:[0,0,.20,0,.16,.72,.10,0,0]},
   {p:.87,values:[.025,0,.16,.005,.12,.74,.065,0,0],stop:true}]}];
const stance=values=>({yaw:0,load:0,pelvisYaw:values[0],chestYaw:values[1],pitch:values[2],shiftX:values[3],advance:values[4],bodyHeight:values[5],bodyPitch:values[6],bodyRoll:values[7],chestRoll:values[8]});
function endpointHands(pose,body){
 const inverse=authoredChestTransform(stance(body)).q.invert();
 const azimuth=pose.angles[0],edge=[Math.cos(azimuth),0,-Math.sin(azimuth)];
 const q=inverse.multiply(bladeOrientation(pose.axis,edge)).toArray();
 return [{...pose,quaternion:q},{...pose,quaternion:q}];
}
export function getHammerAttack(id,combo=0,state='attack'){
 if(id!=='great-hammer'||state!=='attack')return null;
 const index=((combo%4)+4)%4,t=techniques[index],start=[.285,.305,.295,.35][index],end=t.finish-.025;
 return {...t,index,weaponId:id,kind:'smash',strikeVolume:'hammer-head',reach:[1.95,1.90,2.04,1.92][index],halfAngle:[1.72,1.05,1.95,.85][index],
  active:[start,end],swing:[t.release,t.finish],contacts:[{hand:1,kind:'smash',phase:t.contact,start,end,window:[start,end]}],
  ...HAMMER_GRIP,headLength:HAMMER_HEAD.length,headRadius:.27,headHalfExtents:HAMMER_HEAD.halfExtents,
  width:.38,midLength:HAMMER_HEAD.length,tipLength:1.44,tipOffset:[0,-1.44,0],rootFrame:true,minTilt:-.86,
  bodyGripFollow:[.60,.65,.65],bodyGripRotation:.58,
  initialHands:endpointHands(carries[index],bodies[index]),finalHands:endpointHands(carries[index+1],bodies[index+1]),cacheKey:`great-hammer-v6:${index}`};
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
 const roll=spec.index%2===0?0:(spec.index===1?.65:.8)*ease(p/spec.release)*(1-ease((p-spec.finish)/(1-spec.finish)));
 const q=transform.q.clone().invert().multiply(bladeOrientation(axis.toArray(),face).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-roll)));
 for(const h of sample.hands){h.quaternion=q.toArray();h.tip=new THREE.Vector3(...h.grip).add(new THREE.Vector3(0,-1.44,0).applyQuaternion(q)).toArray();}
 return sample;
}
export function sampleHammerReady(clock=0){
 const breath=Math.sin(clock*1.45-.4),axis=new THREE.Vector3(...ready.axis),primary=new THREE.Vector3(...ready.grip).add(new THREE.Vector3(0,breath*.006,0));
 const quaternion=bladeOrientation(axis.toArray(),[Math.cos(ready.angles[0]),0,-Math.sin(ready.angles[0])]).toArray();
 return {hands:[{grip:primary.clone().addScaledVector(axis,-HAMMER_GRIP.supportDistance).toArray(),quaternion},{grip:primary.toArray(),quaternion}],stance:{yaw:0,load:0,advance:0},contacts:[],name:'hammer low pendulum carry'};
}
