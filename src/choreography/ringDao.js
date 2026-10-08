import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';
const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis).toArray()});
const guard=hand([.075,.18,.31],[.24,.11,.965]);
const support=h=>hand(new THREE.Vector3(...h.grip).addScaledVector(new THREE.Vector3(...h.axis),-.221).toArray(),h.axis);
// Broad, heavy blade: shoulder chamber, hip-driven acceleration and a held
// braking pose precede recovery. The shaft never travels behind the torso.
const techniques=[
 {name:'right shoulder loaded broad slash',kind:'cut',hip:[.34,-.36],chamber:hand([.17,.31,.28],[.65,.25,.72]),contact:hand([.025,.21,.40],[-.03,.035,.999]),exit:hand([-.095,.14,.31],[-.66,-.08,.75])},
 {name:'raised heavy descending chop',kind:'chop',hip:[-.10,.14],chamber:hand([.045,.54,.29],[.10,.60,.794]),contact:hand([.015,.245,.40],[0,.04,.999]),exit:hand([.005,.085,.30],[-.08,-.46,.884])},
 {name:'low short diagonal pressure cut',kind:'cut',hip:[.23,-.26],chamber:hand([.12,.20,.30],[.42,.12,.90]),contact:hand([.015,.135,.37],[-.015,-.14,.99]),exit:hand([-.06,.085,.29],[-.42,-.30,.857])},
 {name:'sinking diagonal cut with long brake',kind:'chop',hip:[.30,-.34],chamber:hand([.15,.47,.28],[.48,.47,.74]),contact:hand([.015,.215,.40],[-.03,.02,.999]),exit:hand([-.09,.08,.30],[-.40,-.43,.81])},
 {name:'loaded reverse shoulder return',kind:'cut',hip:[-.31,.34],chamber:hand([-.105,.30,.29],[-.63,.24,.738]),contact:hand([.025,.21,.40],[.035,.035,.999]),exit:hand([.13,.14,.31],[.63,-.075,.773])},
];
const normals=[
 {name:techniques[0].name,kind:'cut',sequence:[0],times:[.49],duration:1.06,advance:.025},
 {name:techniques[1].name,kind:'chop',sequence:[1],times:[.49],duration:1.14,advance:.035},
 {name:techniques[2].name,kind:'cut',sequence:[2],times:[.48],duration:1.02,advance:.015},
 {name:techniques[3].name,kind:'chop',sequence:[3],times:[.48],duration:1.25,advance:.035},
];
const skills=[
 {name:'shoulder sweep and heavy fall',kind:'cut',sequence:[0,1],times:[.32,.68],duration:1.95,advance:.03},
 {name:'raised fall and reverse shoulder return',kind:'chop',sequence:[1,4],times:[.32,.68],duration:2.05,advance:.025},
 {name:'low edge pressure and sinking diagonal',kind:'cut',sequence:[2,3],times:[.32,.68],duration:2.0,advance:.025},
 {name:'sinking fall and waist brake',kind:'chop',sequence:[3,0],times:[.32,.68],duration:2.15,advance:.03},
 {name:'three heavy braking gates',kind:'cut',sequence:[0,2,3],times:[.25,.50,.76],duration:2.75,advance:.03},
];
export function getRingAttack(id,combo=0,state='attack'){
 if(id!=='ring-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,spec=list[index];
 const contacts=spec.times.map((phase,i)=>({hand:1,kind:techniques[spec.sequence[i]].kind,phase,time:phase,start:phase-.035,end:phase+.035,window:[phase-.035,phase+.035]}));
 return {...spec,weaponId:id,contacts,contact:spec.times[0],active:[contacts[0].start,contacts.at(-1).end],shape:'arc',reach:1.78,width:.25,bodyHeight:.85,initialHands:[support(guard),guard],midLength:.729,tipLength:1.309,supportDistance:.221,cacheKey:'ring:'+state+':'+index};
}
function tracksFor(spec){
 const right=[{p:0,grip:guard.grip,axis:guard.axis}],torso=[{p:0,values:[0,.30]}];
 spec.sequence.forEach((index,i)=>{
  const t=techniques[index],c=spec.times[i],single=spec.sequence.length===1;
  const triple=spec.sequence.length===3;
  const chamber=c-(single?.26:triple?.12:.16),drive=c-(single?.105:triple?.075:.09),brake=c+(single?.14:triple?.075:.10),hold=c+(single?.24:triple?.10:.14);
  const loaded=hand(t.chamber.grip.map((x,k)=>x+(k===2?.018:0)),t.chamber.axis);
  for(const [p,h] of [[chamber,t.chamber],[drive,loaded],[c,t.contact],[brake,t.exit],[hold,t.exit]])right.push({p,grip:h.grip,axis:h.axis});
  torso.push({p:chamber,values:[t.hip[0],.60]},{p:drive,values:[t.hip[0]*.8,.75]},{p:c,values:[t.hip[1]*.40,index===3?1:.9]},{p:brake,values:[t.hip[1],.85]},{p:hold,values:[t.hip[1],.85]});
 });
 right.push({p:1,grip:guard.grip,axis:guard.axis});right.sort((a,b)=>a.p-b.p);
 // Close multi-cut transitions share a braking/chamber pose, rather than
 // forcing the massive blade to reverse across a tiny interval.
 for(let i=1;i<right.length-1;i++){
  const a=right[i],b=right[i+1],isContact=k=>spec.times.some(t=>Math.abs(t-k.p)<1e-5);
  if(b.p-a.p<.065&&!isContact(a)&&!isContact(b)&&b.p<.99)right.splice(i,2,{p:(a.p+b.p)/2,grip:a.grip.map((x,k)=>(x+b.grip[k])/2),axis:new THREE.Vector3(...a.axis).add(new THREE.Vector3(...b.axis)).normalize().toArray()});
 }
 torso.push({p:1,values:[0,.30]});torso.sort((a,b)=>a.p-b.p);
 const left=support(guard);return {tracks:[[{p:0,grip:left.grip,axis:left.axis},{p:1,grip:left.grip,axis:left.axis}],right],torso};
}
function feetFor(spec,p){
 const lead={x:-.205,y:.075,z:.105},rear={x:.205,y:.075,z:-.085};
 const step=spec.sequence.findIndex(i=>i===1||i===3);if(step<0)return [lead,rear];
 const landing=spec.times[step]-.12,lift=Math.max(.035,landing-.13),returning=Math.min(.86,spec.times.at(-1)+.13);
 const keys=[[0,.105,.075],[lift,.105,.075],[(lift+landing)/2,.15,.145],[landing,.19,.075],[returning,.19,.075],[Math.min(.94,returning+.065),.15,.145],[Math.min(.985,returning+.13),.105,.075],[1,.105,.075]];
 let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){b=keys[i];if(p<=b[0])break;a=b;}
 const t=THREE.MathUtils.clamp((p-a[0])/Math.max(.001,b[0]-a[0]),0,1),u=t*t*(3-2*t);
 lead.z=THREE.MathUtils.lerp(a[1],b[1],u);lead.y=THREE.MathUtils.lerp(a[2],b[2],u);return [lead,rear];
}
export function sampleRingAttack(id,combo=0,phase=0,state='attack'){
 const spec=getRingAttack(id,combo,state);if(!spec)return null;
 const sample=sampleAuthoredTracks(spec,tracksFor(spec),phase);sample.stance.feet=feetFor(spec,THREE.MathUtils.clamp(phase,0,1));return sample;
}
