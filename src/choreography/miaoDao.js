import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';
const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis).toArray()});
const guard=hand([.065,.22,.31],[.12,.24,.963]);
const support=h=>hand(new THREE.Vector3(...h.grip).addScaledVector(new THREE.Vector3(...h.axis),-.221).toArray(),h.axis);
// A long, connected two-hand shaft: the primary hand leads and the rear hand
// steers the hilt. These larger chambers use the hips and a planted lead step.
const techniques=[
 {name:'two hand stepping descending cut',kind:'chop',hip:[-.12,.17],chamber:hand([.06,.56,.29],[.08,.58,.81]),contact:hand([.015,.25,.39],[-.04,.05,.998]),exit:hand([-.035,.105,.30],[-.12,-.42,.90])},
 {name:'hip driven broad crosscut',kind:'cut',hip:[.30,-.32],chamber:hand([.14,.22,.27],[.66,.035,.75]),contact:hand([.015,.21,.40],[0,.035,1]),exit:hand([-.10,.20,.29],[-.65,.04,.76])},
 {name:'driving rising edge cut',kind:'cut',hip:[.14,-.15],chamber:hand([.10,.09,.28],[.20,-.40,.89]),contact:hand([.025,.25,.40],[.035,.17,.985]),exit:hand([-.065,.48,.31],[-.23,.55,.803])},
 {name:'centerline long point',kind:'thrust',hip:[0,0],chamber:hand([.025,.25,.24],[0,0,1]),contact:hand([.025,.25,.38],[0,0,1]),exit:hand([.025,.25,.44],[0,0,1])},
 {name:'returning diagonal draw',kind:'cut',hip:[-.24,.27],chamber:hand([-.11,.44,.29],[-.48,.40,.78]),contact:hand([.015,.25,.40],[.04,.11,.99]),exit:hand([.12,.115,.30],[.46,-.25,.85])},
];
const normals=[
 {name:techniques[0].name,kind:'chop',sequence:[0],times:[.48],duration:.76,advance:.045},
 {name:techniques[1].name,kind:'cut',sequence:[1],times:[.48],duration:.80,advance:.03},
 {name:techniques[2].name,kind:'cut',sequence:[2],times:[.48],duration:.78,advance:.05},
 {name:techniques[3].name,kind:'thrust',sequence:[3],times:[.48],duration:.78,advance:0},
];
const skills=[
 {name:'planted descent into long point',kind:'chop',sequence:[0,3],times:[.33,.70],duration:1.35,advance:0},
 {name:'cross river and returning diagonal',kind:'cut',sequence:[1,4],times:[.33,.70],duration:1.40,advance:.03},
 {name:'rising moon and falling gate',kind:'cut',sequence:[2,0],times:[.33,.70],duration:1.45,advance:.04},
 {name:'point opening into broad crosscut',kind:'thrust',sequence:[3,1],times:[.33,.70],duration:1.40,advance:0},
 {name:'three long blade gates',kind:'chop',sequence:[0,1,3],times:[.26,.51,.77],duration:1.85,advance:0},
];
export function getMiaoAttack(id,combo=0,state='attack'){
 if(id!=='miao-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,spec=list[index];
 const contacts=spec.times.map((phase,i)=>({hand:1,kind:techniques[spec.sequence[i]].kind,phase,time:phase,start:phase-.035,end:phase+.035,window:[phase-.035,phase+.035]}));
 return {...spec,weaponId:id,contacts,contact:spec.times[0],active:[contacts[0].start,contacts.at(-1).end],shape:spec.kind==='thrust'?'thrust':'arc',reach:1.94,width:spec.kind==='thrust'?.10:.20,initialHands:[support(guard),guard],midLength:.839,tipLength:1.529,supportDistance:.221,pointLanes:contacts.filter(c=>c.kind==='thrust').map(c=>({hand:1,phase:c.phase,inner:.075,outer:.15,x:.025,y:.25,axis:[0,0,1]})),cacheKey:'miao:'+state+':'+index};
}
function tracksFor(spec){
 const right=[{p:0,grip:guard.grip,axis:guard.axis}],torso=[{p:0,values:[0,.15]}];
 spec.sequence.forEach((index,i)=>{
  const t=techniques[index],c=spec.times[i],radius=spec.sequence.length===1?.20:.14;
  for(const [p,h] of [[c-radius,t.chamber],[c,t.contact],[c+radius,t.exit]])right.push({p,grip:h.grip,axis:h.axis});
  if(t.kind==='thrust'){
   right.push({p:c-.075,grip:[.025,.25,.285],axis:[0,0,1]},{p:c+.075,grip:[.025,.25,.435],axis:[0,0,1]});
   for(const p of [c-radius,c-.075,c-.05,c+.05,c+.075,c+radius])torso.push({p,values:[0,.75]});
  }else torso.push({p:c-radius,values:[t.hip[0],.5]},{p:c,values:[t.hip[1]*.45,.85]},{p:c+radius,values:[t.hip[1],.5]});
 });
 right.push({p:1,grip:guard.grip,axis:guard.axis});right.sort((a,b)=>a.p-b.p);
 for(let i=1;i<right.length-1;i++){
  const a=right[i],b=right[i+1],isContact=k=>spec.times.some(t=>Math.abs(t-k.p)<1e-5);
  if(b.p-a.p<.075&&!isContact(a)&&!isContact(b)&&b.p<.99)right.splice(i,2,{p:(a.p+b.p)/2,grip:a.grip.map((x,k)=>(x+b.grip[k])/2),axis:new THREE.Vector3(...a.axis).add(new THREE.Vector3(...b.axis)).normalize().toArray()});
 }
 torso.push({p:1,values:[0,.15]});torso.sort((a,b)=>a.p-b.p);
 const left=support(guard);return {tracks:[[{p:0,grip:left.grip,axis:left.axis},{p:1,grip:left.grip,axis:left.axis}],right],torso};
}
function feetFor(spec,p){
 const lead={x:-.16,y:.075,z:.09},rear={x:.16,y:.075,z:-.07};
 const landing=spec.times[0]-.11,lift=Math.max(.04,landing-.17),returning=Math.min(.85,spec.times.at(-1)+.10);
 const keys=[[0,.09,.075],[lift,.09,.075],[(lift+landing)/2,.17,.17],[landing,.235,.075],[returning,.235,.075],[Math.min(.94,returning+.075),.17,.17],[Math.min(.985,returning+.15),.09,.075],[1,.09,.075]];
 let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){b=keys[i];if(p<=b[0])break;a=b;}
 const t=THREE.MathUtils.clamp((p-a[0])/Math.max(.001,b[0]-a[0]),0,1),u=t*t*(3-2*t);
 lead.z=THREE.MathUtils.lerp(a[1],b[1],u);lead.y=THREE.MathUtils.lerp(a[2],b[2],u);
 return [lead,rear];
}
export function sampleMiaoAttack(id,combo=0,phase=0,state='attack'){
 const spec=getMiaoAttack(id,combo,state);if(!spec)return null;
 const sample=sampleAuthoredTracks(spec,tracksFor(spec),phase);sample.stance.feet=feetFor(spec,THREE.MathUtils.clamp(phase,0,1));return sample;
}
