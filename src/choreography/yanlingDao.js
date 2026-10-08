import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';
const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis).toArray()});
const guard=hand([.31,.12,.24],[.25,.17,.954]);
const free=hand([-.24,.17,.14],[-.16,-.94,.30]);
// A light curved blade draws broad wrist-led arcs without the point fencing
// lane of Tang. The retreating counter uses hip torque and an actual rear step.
const techniques=[
 {name:'waist height drawing sweep',kind:'cut',hip:[.23,-.27],chamber:hand([.43,.135,.24],[.62,.025,.784]),contact:hand([.19,.135,.43],[0,.025,1]),exit:hand([.045,.12,.31],[-.65,.02,.760])},
 {name:'low lifting crescent',kind:'cut',hip:[.14,-.17],chamber:hand([.35,.04,.27],[.20,-.55,.81]),contact:hand([.20,.22,.43],[-.10,.12,.988]),exit:hand([.11,.44,.32],[-.38,.50,.778])},
 {name:'lateral high diagonal fall',kind:'chop',hip:[.22,-.24],chamber:hand([.44,.46,.27],[.50,.45,.740]),contact:hand([.20,.24,.43],[0,.10,.995]),exit:hand([.075,.06,.30],[-.38,-.48,.79])},
 {name:'retreating reverse counter',kind:'cut',hip:[-.38,.43],chamber:hand([.075,.16,.31],[-.58,.025,.814]),contact:hand([.25,.18,.43],[.10,.03,.995]),exit:hand([.43,.23,.28],[.65,.15,.745])},
];
const normals=[
 {name:techniques[0].name,kind:'cut',sequence:[0],times:[.47],duration:.52,advance:.035},
 {name:techniques[1].name,kind:'cut',sequence:[1],times:[.48],duration:.56,advance:.045},
 {name:techniques[2].name,kind:'chop',sequence:[2],times:[.48],duration:.59,advance:.03},
 {name:techniques[3].name,kind:'cut',sequence:[3],times:[.49],duration:.70,advance:-.075,retreat:true},
];
const skills=[
 {name:'drawing sweep and rising crescent',kind:'cut',sequence:[0,1],times:[.34,.70],duration:1.0,advance:.05},
 {name:'high fall and waist return',kind:'chop',sequence:[2,0],times:[.35,.70],duration:1.05,advance:.025},
 {name:'rising cut and side descent',kind:'cut',sequence:[1,2],times:[.34,.70],duration:1.10,advance:.035},
 {name:'retreating counter and lifting reply',kind:'cut',sequence:[3,1],times:[.35,.70],duration:1.15,advance:-.065,retreat:true},
 {name:'three curved cutting gates',kind:'cut',sequence:[0,2,3],times:[.27,.50,.77],duration:1.35,advance:-.04,retreat:true},
];
export function getYanlingAttack(id,combo=0,state='attack') {
 if(id!=='yanling-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,spec=list[index];
 const contacts=spec.times.map((phase,i)=>({hand:1,kind:techniques[spec.sequence[i]].kind,phase,time:phase,start:phase-.035,end:phase+.035,window:[phase-.035,phase+.035]}));
 return {...spec,weaponId:id,contacts,contact:spec.times[0],active:[contacts[0].start,contacts.at(-1).end],shape:'arc',reach:1.58,width:.16,initialHands:[free,guard],midLength:.639,tipLength:1.129,cacheKey:'yanling:'+state+':'+index};
}
function tracksFor(spec) {
 const right=[{p:0,grip:guard.grip,axis:guard.axis}],left=[{p:0,grip:free.grip,axis:free.axis}],torso=[{p:0,values:[0,0]}];
 spec.sequence.forEach((index,i)=>{
  const technique=techniques[index],c=spec.times[i],radius=spec.sequence.length===1?.19:Math.min(.15,i?(c-spec.times[i-1])*.46:.15,i<spec.times.length-1?(spec.times[i+1]-c)*.46:.15);
  for(const [p,h] of [[c-radius,technique.chamber],[c,technique.contact],[c+radius,technique.exit]])right.push({p,grip:h.grip,axis:h.axis});
  torso.push({p:c-radius,values:[technique.hip[0],.45]},{p:c,values:[technique.hip[1]*.45,.85]},{p:c+radius,values:[technique.hip[1],.4]});
  // The empty hand shifts outside the rib cage for balance on a reverse cut.
  left.push({p:c,grip:index===3?[-.36,.20,.15]:[-.25,.18,.15],axis:free.axis});
 });
 right.push({p:1,grip:guard.grip,axis:guard.axis});right.sort((a,b)=>a.p-b.p);
 for(let i=1;i<right.length-1;i++){
  const a=right[i],b=right[i+1],isContact=key=>spec.times.some(t=>Math.abs(t-key.p)<.00001);
  if(b.p-a.p<.075&&!isContact(a)&&!isContact(b)&&b.p<.99)right.splice(i,2,{p:(a.p+b.p)/2,grip:a.grip.map((x,k)=>(x+b.grip[k])/2),axis:new THREE.Vector3(...a.axis).add(new THREE.Vector3(...b.axis)).normalize().toArray()});
 }
 left.push({p:1,grip:free.grip,axis:free.axis});
 torso.push({p:1,values:[0,0]});torso.sort((a,b)=>a.p-b.p);
 return {tracks:[left,right],torso};
}
function feetFor(spec,p) {
 const lead={x:-.175,y:.075,z:.12},rear={x:.175,y:.075,z:-.085};
 if(!spec.retreat)return [lead,rear];
 const c=spec.times[spec.sequence.indexOf(3)],lift=Math.max(.04,c-.30),landing=c-.10;
 const keys=[{p:0,values:[rear.z,rear.y]},{p:lift,values:[rear.z,rear.y]},{p:(lift+landing)/2,values:[-.155,.165]},{p:landing,values:[-.225,.075]},{p:c+.105,values:[-.225,.075]},{p:Math.min(.92,c+.23),values:[-.155,.165]},{p:Math.min(.985,c+.34),values:[rear.z,.075]},{p:1,values:[rear.z,.075]}];
 keys.sort((a,b)=>a.p-b.p);
 // A planted ankle holds its exact target. Only the lifted swing translates.
 let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){b=keys[i];if(p<=b.p)break;a=b;}
 const t=THREE.MathUtils.clamp((p-a.p)/Math.max(.001,b.p-a.p),0,1),u=t*t*(3-2*t);
 rear.z=THREE.MathUtils.lerp(a.values[0],b.values[0],u);rear.y=THREE.MathUtils.lerp(a.values[1],b.values[1],u);
 return [lead,rear];
}
export function sampleYanlingAttack(id,combo=0,phase=0,state='attack') {
 const spec=getYanlingAttack(id,combo,state);if(!spec)return null;
 const sample=sampleAuthoredTracks(spec,tracksFor(spec),phase);
 sample.stance.feet=feetFor(spec,THREE.MathUtils.clamp(phase,0,1));
 return sample;
}
