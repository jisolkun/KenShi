import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';

const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis).toArray()});
const guard=hand([.26,.12,.23],[.10,.20,.975]);
const free=hand([-.24,.18,.15],[-.12,-.94,.32]);
// Tang uses a compact right-hand fencing guard. Each technique has an authored
// wrist lane and blade plane; the left hand remains a separate rib guard.
const techniques=[
 {name:'short forward diagonal',kind:'cut',hip:[-.16,.18],chamber:hand([.40,.39,.27],[.40,.32,.858]),contact:hand([.17,.21,.43],[-.15,.12,.981]),exit:hand([.07,.085,.32],[-.58,-.28,.765])},
 {name:'reverse waist intercept',kind:'cut',hip:[.18,-.19],chamber:hand([.04,.12,.30],[-.56,.06,.826]),contact:hand([.25,.13,.43],[.07,.04,.997]),exit:hand([.43,.15,.28],[.61,.03,.792])},
 {name:'forward point extension',kind:'thrust',hip:[0,0],chamber:hand([.24,.25,.19],[0,0,1]),contact:hand([.24,.25,.39],[0,0,1]),exit:hand([.24,.25,.48],[0,0,1])},
 {name:'centerline descending chop',kind:'chop',hip:[-.08,.10],chamber:hand([.23,.59,.25],[0,.65,.76]),contact:hand([.23,.25,.43],[0,.08,.997]),exit:hand([.23,.055,.34],[0,-.50,.866])},
 {name:'compact rising return',kind:'cut',hip:[.14,-.12],chamber:hand([.12,.045,.31],[-.32,-.35,.88]),contact:hand([.25,.25,.42],[.1,.28,.96]),exit:hand([.35,.41,.29],[.32,.50,.804])},
];
const normals=[
 {name:techniques[0].name,kind:'cut',sequence:[0],times:[.47],duration:.45,advance:.035},
 {name:techniques[1].name,kind:'cut',sequence:[1],times:[.47],duration:.48,advance:.02},
 {name:techniques[2].name,kind:'thrust',sequence:[2],times:[.48],duration:.48,advance:0},
 {name:techniques[3].name,kind:'chop',sequence:[3],times:[.48],duration:.62,advance:.025},
];
const skills=[
 {name:'diagonal opening and point',kind:'cut',sequence:[0,2],times:[.34,.70],duration:.95,advance:0},
 {name:'waist interception and return',kind:'cut',sequence:[1,0],times:[.34,.69],duration:.95,advance:.025},
 {name:'center chop and rising recovery',kind:'chop',sequence:[3,4],times:[.35,.70],duration:1.05,advance:.02},
 {name:'point feint and waist cut',kind:'thrust',sequence:[2,1],times:[.34,.69],duration:1.0,advance:0},
 {name:'three compact gates',kind:'cut',sequence:[0,1,3],times:[.27,.50,.76],duration:1.30,advance:.025},
];
export function getTangAttack(id,combo=0,state='attack') {
 if(id!=='tang-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,spec=list[index];
 const contacts=spec.times.map((phase,i)=>({hand:1,kind:techniques[spec.sequence[i]].kind,phase,time:phase,start:phase-.035,end:phase+.035,window:[phase-.035,phase+.035]}));
 return {...spec,weaponId:id,contact:spec.times[0],active:[contacts[0].start,contacts.at(-1).end],contacts,shape:spec.kind==='thrust'?'thrust':'arc',reach:1.64,width:spec.kind==='thrust'?.09:.13,initialHands:[free,guard],midLength:.679,tipLength:1.209,pointLanes:contacts.filter(c=>c.kind==='thrust').map(c=>({hand:1,phase:c.phase,inner:.06,outer:.13,x:.24,y:.25,axis:[0,0,1]})),cacheKey:'tang:'+state+':'+index};
}
function tracksFor(spec) {
 const right=[{p:0,grip:guard.grip,axis:guard.axis}],torso=[{p:0,values:[0,0]}];
 spec.sequence.forEach((index,i)=>{
  const technique=techniques[index],c=spec.times[i],radius=spec.sequence.length===1?.19:Math.min(.135,i?(c-spec.times[i-1])*.44:.135,i<spec.times.length-1?(spec.times[i+1]-c)*.44:.135);
  for(const [p,h] of [[c-radius,technique.chamber],[c,technique.contact],[c+radius,technique.exit]])right.push({p,grip:h.grip,axis:h.axis});
  if(technique.kind==='thrust'){
   for(const p of [c-radius,c-.06,c+.06,c+radius])torso.push({p,values:[0,.65]});
   // Keep the point on a straight +Z lane through the entire outgoing window.
   right.push({p:c-.07,grip:[.24,.25,.28],axis:[0,0,1]},{p:c+.07,grip:[.24,.25,.455],axis:[0,0,1]});
  }else torso.push({p:c-radius,values:[technique.hip[0],.45]},{p:c,values:[technique.hip[1]*.4,.70]},{p:c+radius,values:[technique.hip[1],.4]});
 });
 right.push({p:1,grip:guard.grip,axis:guard.axis});right.sort((a,b)=>a.p-b.p);
 // Connected techniques share one transition pose instead of squeezing two
 // distant exit/chamber poses into the few frames between their contacts.
 for(let i=1;i<right.length-1;i++){
  const a=right[i],b=right[i+1];
  const contactKey=key=>spec.times.some(t=>Math.abs(t-key.p)<.00001);
  if(b.p-a.p<.075&&!contactKey(a)&&!contactKey(b)&&b.p<.99){
   right.splice(i,2,{p:(a.p+b.p)/2,grip:a.grip.map((v,k)=>(v+b.grip[k])/2),axis:new THREE.Vector3(...a.axis).add(new THREE.Vector3(...b.axis)).normalize().toArray()});
  }
 }
 torso.push({p:1,values:[0,0]});torso.sort((a,b)=>a.p-b.p);
 return {tracks:[[{p:0,grip:free.grip,axis:free.axis},{p:1,grip:free.grip,axis:free.axis}],right],torso};
}
export function sampleTangAttack(id,combo=0,phase=0,state='attack') {
 const spec=getTangAttack(id,combo,state);if(!spec)return null;
 return sampleAuthoredTracks(spec,tracksFor(spec),phase);
}
