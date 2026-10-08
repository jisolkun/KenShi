import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';

// A modern straight, single-edge long-handle design. Waist-led stepping and
// connected cuts draw on twentieth-century saber manuals, not Tang reconstruction.
const hand=(grip,axis,edge)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis,edge).toArray()});
const ready=hand([.14,.12,.40],[.88,-.32,.35],[0,-1,0]);
// Both fists fit on the long hilt without pushing the rear hand into the ribs.
export const TANG_GRIP={supportDistance:.18,shoulderForward:.11,armReach:.525,handClearance:true};
const supportDistance=TANG_GRIP.supportDistance;
const leftReady=hand(new THREE.Vector3(...ready.grip).addScaledVector(new THREE.Vector3(...ready.axis),-supportDistance).toArray(),ready.axis);
const techniques=[
 {name:'right shoulder sweeping diagonal',chamber:hand([.30,.48,.11],[.91,.37,.16]),cross:hand([.18,.30,.54],[.03,-.12,.992]),exit:hand([-.20,.10,.19],[-.91,-.32,.16]),turn:[.62,-.72],height:.855},
 {name:'reverse waist sweep',chamber:hand([-.20,.15,.20],[-.99,.02,.03]),cross:hand([.14,.20,.56],[0,.025,1]),exit:hand([.32,.19,.10],[.99,.025,.03]),turn:[-.74,.70],height:.84},
 {name:'rising diagonal',chamber:hand([.30,.025,.16],[.86,-.46,.20]),cross:hand([.16,.27,.55],[0,.25,.968]),exit:hand([-.14,.54,.17],[-.79,.58,.19]),turn:[.56,-.67],height:.865},
 {name:'advancing overhead cleave',chamber:hand([.24,.65,.25],[.48,.82,-.31]),cross:hand([.12,.33,.56],[-.13,.20,.971]),exit:hand([-.18,.08,.27],[-.78,-.49,.26]),turn:[.45,-.55],height:.82},
];
const normals=techniques.map((t,i)=>({name:t.name,kind:i===3?'chop':'cut',sequence:[i],times:[.49],duration:[.54,.51,.56,.60][i]}));
const skills=[
 {name:'diagonal and reverse sweep',sequence:[0,1],times:[.32,.70],duration:.90},
 {name:'reverse sweep and rising cut',sequence:[1,2],times:[.31,.70],duration:.87},
 {name:'overhead cleave and rising return',sequence:[3,2],times:[.33,.72],duration:.97},
 {name:'rising cut and descending diagonal',sequence:[2,0],times:[.31,.71],duration:.90},
 {name:'three connected sweeping gates',sequence:[0,1,3],times:[.22,.50,.79],duration:1.60},
];
export function getTangAttack(id,combo=0,state='attack') {
 if(id!=='tang-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,spec=list[index];
 const half=state==='skill'?.095:.145;
 const contacts=spec.times.map((phase,i)=>({hand:1,kind:spec.sequence[i]===3?'chop':'cut',phase,time:phase,start:phase-half,end:phase+half,window:[phase-half,phase+half],edgeWindow:true}));
 return {...spec,kind:spec.kind??'cut',weaponId:id,contact:spec.times[0],active:[contacts[0].start,contacts.at(-1).end],contacts,shape:'arc',reach:2.15,width:.16,initialHands:[leftReady,ready],midLength:.764,tipLength:1.379,...TANG_GRIP,rootFrame:true,cacheKey:'tang-fast-clear-v2:'+state+':'+index};
}
function tracksFor(spec){
 const right=[{p:0,...ready}],body=[{p:0,values:[0,0,-.06,0,0,.875]}];
 const torso=[{p:0,values:[0,0]}];
 const single=spec.sequence.length===1;
 spec.sequence.forEach((index,i)=>{
  const t=techniques[index],c=spec.times[i],wind=single?.21:.12,sweep=single?.145:.095,brake=single?.22:.13;
  // Explicit front midpoint makes the large flank-to-flank sweep take the
  // forward hemisphere; vector interpolation alone could choose the back.
  right.push({p:c-wind,...t.chamber},{p:c-sweep,...t.chamber},{p:c,...t.cross},{p:c+sweep,...t.exit},{p:c+brake,...t.exit});
  const [a,b]=t.turn;
  body.push({p:c-wind-.06,values:[a*.74,a*.26,-.07,a*.025,.045,.80]},
   {p:c-sweep-.025,values:[a*.56,a*.36,-.08,0,.12,.795]},
   {p:c-.035,values:[b*.50,a*.38,-.105,-b*.03,.17,.785]},
   {p:c+sweep*.45,values:[b*.70,b*.20,-.08,-b*.055,.18,.785]},
   {p:c+brake,values:[b*.68,b*.30,-.065,-b*.055,.15,.80]});
 });
 // Connected strokes meet in a carry pose, avoiding a guard reset and avoiding
 // conflicting exit/chamber keys that would fold into a few milliseconds.
 right.sort((a,b)=>a.p-b.p);
 for(let i=1;i<right.length-1;i++){
  if(right[i+1].p-right[i].p<.035){const a=right[i],b=right[i+1];right.splice(i,2,{p:(a.p+b.p)/2,grip:a.grip.map((x,k)=>(x+b.grip[k])/2),axis:new THREE.Vector3(...a.axis).add(new THREE.Vector3(...b.axis)).normalize().toArray()});}
 }
 right.push({p:1,...ready});body.push({p:1,values:[0,0,-.06,0,0,.875]});body.sort((a,b)=>a.p-b.p);
 for(const key of right){key.angles=[Math.atan2(key.axis[0],key.axis[2]),Math.asin(key.axis[1])];}
 return {feet:p=>feetFor(spec,p),tracks:[[{p:0,...leftReady,angles:[Math.atan2(leftReady.axis[0],leftReady.axis[2]),Math.asin(leftReady.axis[1])]},{p:1,...leftReady,angles:[Math.atan2(leftReady.axis[0],leftReady.axis[2]),Math.asin(leftReady.axis[1])]}],right],torso:[...torso,{p:1,values:[0,0]}],body};
}
function feetFor(spec,p){
 const feet=[{x:-.19,y:.075,z:.14},{x:.19,y:.075,z:-.14}];
 spec.sequence.forEach((index,i)=>{
  const c=spec.times[i],side=index===1?1:0,start=c-(spec.sequence.length===1?.29:.18),land=c-.075;
  const u=THREE.MathUtils.clamp((p-start)/(land-start),0,1),v=u*u*(3-2*u);
  feet[side].z=Math.min(.39,feet[side].z+.25*v);feet[side].x+=(side?1:-1)*.045*v;
  if(p>start&&p<land)feet[side].y+=Math.sin(Math.PI*u)*.105;
 });
 // Return only the feet that stepped, one at a time. The other foot bears
 // weight throughout recovery; a simultaneous two-foot lift looks like a hop.
 const last=spec.times.at(-1),recover=Math.max(last+.105,Math.min(.82,last+.16));
 const order=[...new Set(spec.sequence.map(index=>index===1?1:0))].reverse();
 if(p>recover)order.forEach((side,index)=>{
  const u=THREE.MathUtils.clamp((p-recover)/(1-recover)*order.length-index,0,1),v=u*u*(3-2*u);
  feet[side].z=THREE.MathUtils.lerp(feet[side].z,side?-.14:.14,v);
  feet[side].x=THREE.MathUtils.lerp(feet[side].x,side?.19:-.19,v);
  feet[side].y+=Math.sin(Math.PI*u)*.075;
 });
 return feet;
}
export function sampleTangAttack(id,combo=0,phase=0,state='attack'){
 const spec=getTangAttack(id,combo,state);if(!spec)return null;
 const p=THREE.MathUtils.clamp(phase,0,1),sample=sampleAuthoredTracks(spec,tracksFor(spec),p);sample.stance.feet=feetFor(spec,p);return sample;
}
export function sampleTangReady(clock=0){
 // Low connected carry, with breathing arriving at the hands after the ribs.
 const breath=Math.sin(clock*1.8),follow=Math.sin(clock*1.8-.32);
 const right=hand([ready.grip[0],ready.grip[1]+follow*.009,ready.grip[2]], [ready.axis[0],ready.axis[1]+follow*.012,ready.axis[2]], [0,-1,0]);
 const axis=new THREE.Vector3(...right.axis),q=right.quaternion;
 return {hands:[{grip:new THREE.Vector3(...right.grip).addScaledVector(axis,-supportDistance).toArray(),quaternion:q},{grip:right.grip,quaternion:q}],stance:{yaw:0,load:0,pelvisYaw:Math.sin(clock*.48)*.025,chestYaw:Math.sin(clock*.48-.25)*.018,pitch:-.06-breath*.008,shiftX:Math.sin(clock*.48)*.012,advance:0,bodyHeight:.875+breath*.004,feet:[{x:-.19,y:.075,z:.14},{x:.19,y:.075,z:-.14}]},contacts:[],name:'relaxed connected low carry'};
}
