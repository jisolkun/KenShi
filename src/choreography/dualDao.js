import * as THREE from 'three';
import { sampleAuthoredTracks } from './trajectory.js';

// Coordinates are in the chest frame. Every blade has its own chamber,
// contact, and exit. The inactive blade stays outside the moving blade's lane.
const v = a => new THREE.Vector3(...a);
const smooth = t => t*t*(3-2*t);
function orientation(axis, edge) {
  const y=v(axis).normalize().negate();
  const x=v(edge).addScaledVector(y,-v(edge).dot(y)).normalize();
  const z=new THREE.Vector3().crossVectors(x,y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}
const hand=(grip,axis,edge)=>({grip,quaternion:orientation(axis,edge).toArray()});
const lowR=hand([.32,-.09,.12],[.05,-.91,.4],[1,.1,.1]);
const lowL=hand([-.32,-.09,.1],[-.05,-.91,.4],[-1,.1,.1]);
const guardR=hand([.28,.17,.22],[.12,.74,.66],[1,-.2,.05]);
const guardL=hand([-.28,.13,.21],[-.12,.74,.66],[-1,-.2,.05]);
// Explicitly authored paths; a different leading hand and cut plane each time.
const strokes=[
 {name:'right descending diagonal',side:1,hip:[-.30,.30],chamber:hand([.44,.44,.28],[.32,.32,.89],[-.7,-.3,.57]),contact:hand([.09,.19,.43],[-.28,.16,.95],[-.69,-.71,-.08]),exit:hand([-.035,.055,.23],[-.70,-.42,.57],[-.61,-.02,-.79])},
 {name:'left descending return',side:0,hip:[.28,-.30],chamber:hand([-.44,.44,.28],[-.35,.30,.89],[.7,-.4,.52]),contact:hand([-.07,.16,.43],[.32,.10,.94],[.68,-.72,-.15]),exit:hand([.035,.055,.23],[.69,-.45,.57],[.65,.04,-.76])},
 {name:'right waist sweep',side:1,hip:[-.38,.38],chamber:hand([.46,.11,.20],[.75,.10,.65],[-.65,0,.75]),contact:hand([.11,.07,.44],[.05,.04,.998],[-1,0,.05]),exit:hand([-.06,.14,.29],[-.88,.07,.47],[-.47,0,-.88])},
 {name:'left rising diagonal',side:0,hip:[.32,-.28],chamber:hand([-.40,-.055,.09],[-.62,-.45,.64],[.72,.1,.7]),contact:hand([-.05,.20,.43],[.18,.27,.946],[.72,.61,-.31]),exit:hand([.13,.47,.28],[.62,.60,.51],[.6,.04,-.8])},
 {name:'right overhead chop',side:1,hip:[-.15,.22],chamber:hand([.29,.69,.22],[.04,.84,.54],[0,-.54,.84]),contact:hand([.22,.25,.43],[.02,.10,.995],[0,-.995,.1]),exit:hand([.24,-.045,.34],[.05,-.70,.71],[0,-.71,-.70])},
];
const leftChop={...strokes[4],name:'left overhead chop',side:0,hip:[.15,-.22]};
for(const stage of ['chamber','contact','exit']){const source=strokes[4][stage];const axis=axisOfHand(source);leftChop[stage]=hand([-source.grip[0],source.grip[1],source.grip[2]],[-axis[0],axis[1],axis[2]],[1,0,0]);}
leftChop.chamber=hand([-.40,.64,.22],[-.32,.79,.52],[1,0,0]);
strokes.push(leftChop);
function axisOfHand(h){return v([0,-1,0]).applyQuaternion(new THREE.Quaternion().fromArray(h.quaternion)).toArray();}
const skillSpecs=[
 {name:'advancing paired diagonal',strokes:[0,1],contacts:[.38,.68],advance:.15},
 {name:'planted alternating wheel',strokes:[2,3,0],contacts:[.30,.51,.73],advance:.03},
 {name:'high chop and low return',strokes:[4,3],contacts:[.43,.70],advance:.09},
 {name:'crossing waist scissors',strokes:[2,1],contacts:[.39,.67],advance:.10},
 {name:'four gate alternating finish',strokes:[0,1,2,5],contacts:[.27,.44,.61,.79],advance:.12},
];
export function getReviewedAttack(id,combo=0,state='attack') {
 if(id!=='dual-dao'||!['attack','skill'].includes(state))return null;
 const attackSpecs=[{name:strokes[0].name,strokes:[0],contacts:[.46]},{name:strokes[1].name,strokes:[1],contacts:[.46]},{name:strokes[3].name,strokes:[3],contacts:[.46]},{name:'staggered paired diagonals',strokes:[0,1],contacts:[.37,.66]}];
 const spec=state==='skill'?skillSpecs[((combo%5)+5)%5]:{...attackSpecs[((combo%4)+4)%4],advance:.075};
 return {...spec,weaponId:id,duration:state==='skill'?[.8,.95,1,.9,1.3][((combo%5)+5)%5]:[.43,.44,.46,.66][((combo%4)+4)%4],contact:spec.contacts[0],active:[spec.contacts[0]-.035,spec.contacts.at(-1)+.035],shape:'blade',reach:1.32,width:.15,contacts:spec.contacts.map((phase,i)=>({phase,time:phase,start:phase-.035,end:phase+.035,window:[phase-.035,phase+.035],hand:strokes[spec.strokes[i]].side}))};
}
const axisOf=axisOfHand;
function tracksFor(spec) {
 const tracks=[lowL,lowR].map(h=>[{p:0,grip:h.grip,axis:axisOf(h)}]);
 const torso=[{p:0,values:[0,0]}];
 spec.strokes.forEach((index,i)=>{
  const s=strokes[index],c=spec.contacts[i].phase;
  const radius=spec.strokes.length===1?.17:Math.min(.15,i? (c-spec.contacts[i-1].phase)*.46:.15,i<spec.strokes.length-1?(spec.contacts[i+1].phase-c)*.46:.15);
  for(const [p,h] of [[c-radius,s.chamber],[c,s.contact],[c+radius,s.exit]])tracks[s.side].push({p,grip:h.grip,axis:axisOf(h)});
  torso.push({p:c-radius,values:[s.hip[0],.65]},{p:c,values:[s.hip[1]*.45,1]},{p:c+radius,values:[s.hip[1],.65]});
 });
 tracks.forEach((track,i)=>{const h=i?lowR:lowL;track.push({p:1,grip:h.grip,axis:axisOf(h)});track.sort((a,b)=>a.p-b.p);});
 torso.push({p:1,values:[0,0]});torso.sort((a,b)=>a.p-b.p);
 return {tracks,torso};
}
export function sampleReviewedAttack(id,combo=0,phase=0,state='attack') {
 const spec=getReviewedAttack(id,combo,state);if(!spec)return null;
 return sampleAuthoredTracks({...spec,initialHands:[lowL,lowR],cacheKey:'dual:'+state+':'+combo},tracksFor(spec),phase);
}
