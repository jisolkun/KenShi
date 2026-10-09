import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks } from './trajectory.js';

// The largely straight blade and curved final quarter permit both a drawing
// cut and a point-first entry. These are modern single-saber choreographies,
// informed by Dan Jie Dao's moving empty hand, not a historical reconstruction.
const hand=(grip,axis)=>({grip,axis:new THREE.Vector3(...axis).normalize().toArray(),quaternion:bladeOrientation(axis).toArray()});
const ready=hand([.36,.10,.38],[.29,-.50,.816]);
const free=hand([-.38,.17,.37],[-.15,-.94,.30]);
export const YANLING_GRIP={singleHandClearance:true,shoulderForward:.07,armReach:.525};
const stroke=(name,kind,chamber,cross,exit,turn)=>({name,kind,chamber:hand(...chamber),cross:hand(...cross),exit:hand(...exit),turn});
const techniques=[
 stroke('waist drawing sweep','cut',[[.46,.13,.37],[.65,.02,.76]],[[.22,.13,.49],[0,.02,1]],[[.01,.13,.40],[-.62,.02,.78]],[.24,-.29]),
 stroke('low rising cut','cut',[[.39,.015,.38],[.33,-.42,.84]],[[.25,.20,.49],[.03,.04,.999]],[[.08,.40,.40],[-.38,.38,.84]],[.18,-.23]),
 stroke('lateral upper diagonal','chop',[[.40,.47,.43],[.48,.39,.78]],[[.24,.26,.49],[.04,.06,.997]],[[.09,.095,.39],[-.42,-.34,.84]],[.27,-.30]),
 stroke('retreating reverse cut','cut',[[.015,.17,.40],[-.58,.02,.81]],[[.24,.18,.49],[.03,.03,.999]],[[.46,.20,.37],[.62,.08,.78]],[-.29,.32]),
 stroke('opening outside slice','cut',[[.11,.38,.40],[-.43,.28,.86]],[[.29,.27,.49],[.05,.05,.998]],[[.47,.15,.37],[.60,-.14,.79]],[-.21,.24]),
 stroke('inside returning draw','cut',[[.47,.15,.37],[.60,-.14,.79]],[[.23,.17,.49],[.02,-.04,.999]],[[.04,.22,.40],[-.56,.18,.81]],[.24,-.28]),
 stroke('low forward scoop','cut',[[.44,.04,.38],[.50,-.31,.81]],[[.31,.19,.48],[.19,.12,.975]],[[.18,.43,.41],[-.13,.43,.893]],[.12,-.17]),
 stroke('point-side dropping reply','chop',[[.18,.43,.41],[-.13,.43,.893]],[[.30,.26,.48],[.14,.09,.986]],[[.41,.075,.39],[.42,-.34,.84]],[-.17,.21]),
 stroke('upper oblique interception','cut',[[.43,.38,.38],[.56,.30,.77]],[[.24,.31,.49],[.02,.10,.995]],[[.075,.25,.41],[-.49,-.03,.87]],[.20,-.23]),
 stroke('low changing-side sweep','cut',[[.075,.25,.41],[-.49,-.03,.87]],[[.25,.105,.49],[.03,-.08,.996]],[[.46,.09,.38],[.58,-.15,.80]],[-.23,.25]),
 stroke('retreating hanging slice','cut',[[.43,.44,.38],[.48,.36,.80]],[[.25,.30,.48],[.02,.03,.999]],[[.10,.17,.40],[-.43,-.19,.88]],[.25,-.25]),
 stroke('returning waist counter','cut',[[.10,.17,.40],[-.43,-.19,.88]],[[.27,.16,.49],[.05,-.01,.999]],[[.46,.21,.38],[.58,.12,.805]],[-.25,.30]),
 stroke('entering point thrust','thrust',[[.08,.22,.37],[0,0,1]],[[.08,.22,.445],[0,0,1]],[[.08,.22,.505],[0,0,1]],[0,0]),
];
// The empty palm answers each blade route instead of repeating one guard.
// All carries remain outside the breastplate; the palm turns modestly as the
// shoulder opens, without a wrist snap or contact with the weapon hand.
const emptyHandRoutes=[
 [[-.39,.19,.39],[-.44,.12,.36],[-.40,.14,.38]], // draw: lower outside/rear
 [[-.39,.14,.38],[-.45,.105,.36],[-.42,.16,.38]], // lift: sink for balance
 [[-.38,.27,.40],[-.43,.32,.39],[-.40,.22,.38]], // fall: upper outside palm
 [[-.44,.21,.39],[-.46,.23,.40],[-.38,.16,.38]], // reverse: open, then gather
 [[-.42,.28,.39],[-.45,.24,.42],[-.41,.18,.38]],
 [[-.41,.18,.38],[-.44,.13,.36],[-.39,.16,.38]],
 [[-.40,.13,.38],[-.46,.10,.36],[-.43,.20,.39]],
 [[-.43,.24,.40],[-.40,.30,.39],[-.38,.21,.38]],
 [[-.39,.30,.40],[-.45,.28,.42],[-.43,.19,.39]],
 [[-.43,.19,.39],[-.46,.12,.37],[-.40,.15,.38]],
 [[-.42,.29,.40],[-.46,.22,.42],[-.43,.14,.38]],
 [[-.43,.14,.38],[-.45,.19,.40],[-.38,.17,.38]],
 [[-.39,.22,.39],[-.43,.16,.35],[-.39,.17,.38]],
];
const emptyHandAxes=[
 [[-.17,-.96,.22],[-.28,-.94,.19],[-.17,-.94,.29]],
 [[-.16,-.96,.23],[-.26,-.96,.12],[-.18,-.94,.29]],
 [[-.18,-.88,.44],[-.29,-.83,.48],[-.17,-.91,.38]],
 [[-.29,-.91,.29],[-.35,-.88,.32],[-.15,-.94,.30]],
 [[-.25,-.88,.40],[-.34,-.87,.36],[-.20,-.94,.28]],
 [[-.20,-.94,.28],[-.29,-.95,.13],[-.16,-.94,.30]],
 [[-.19,-.97,.17],[-.30,-.95,.11],[-.23,-.92,.32]],
 [[-.23,-.92,.32],[-.20,-.85,.48],[-.16,-.92,.36]],
 [[-.20,-.87,.45],[-.33,-.86,.40],[-.24,-.92,.30]],
 [[-.24,-.92,.30],[-.32,-.94,.12],[-.17,-.94,.29]],
 [[-.25,-.88,.40],[-.34,-.89,.30],[-.25,-.95,.19]],
 [[-.25,-.95,.19],[-.30,-.91,.29],[-.15,-.94,.30]],
 [free.axis,free.axis,free.axis],
];
techniques.forEach((t,index)=>{t.free=emptyHandRoutes[index].map((grip,i)=>hand(grip,emptyHandAxes[index][i]));});
const normals=[
 {name:'腰高横抹',kind:'cut',sequence:[0],times:[.47],duration:.52,step:[0,.055,0]},
 {name:'低位上撩',kind:'cut',sequence:[1],times:[.49],duration:.56,step:[0,.075,-.025]},
 {name:'侧上斜落',kind:'chop',sequence:[2],times:[.49],duration:.59,step:[0,.055,-.04]},
 {name:'撤步反切',kind:'cut',sequence:[3],times:[.49],duration:.60,step:[1,-.10,.015]},
];
const skills=[
 {name:'迎门点刺',kind:'thrust',sequence:[12],times:[.51],duration:.88,step:[0,.115,0]},
 {name:'外开内抹',kind:'cut',sequence:[4,5],times:[.30,.68],duration:1.12,step:[1,.065,.055]},
 {name:'低挑追落',kind:'cut',sequence:[6,7],times:[.29,.65],duration:1.16,step:[0,.10,-.025]},
 {name:'斜截换侧横切',kind:'cut',sequence:[8,9],times:[.34,.71],duration:1.25,step:[0,.025,-.095]},
 {name:'撤身挂锋反切',kind:'cut',sequence:[10,11],times:[.31,.69],duration:1.35,step:[1,-.13,.035]},
];
export function getYanlingAttack(id,combo=0,state='attack'){
 if(id!=='yanling-dao'||!['attack','skill'].includes(state))return null;
 const list=state==='skill'?skills:normals,index=((combo%list.length)+list.length)%list.length,base=list[index];
 const half=base.sequence.length===1?.095:.085;
 const contacts=base.times.map((phase,i)=>({hand:1,kind:techniques[base.sequence[i]].kind,phase,time:phase,start:phase-half,end:phase+half,window:[phase-half,phase+half],edgeWindow:true}));
 return {...base,...YANLING_GRIP,weaponId:id,contacts,contact:base.times[0],active:[contacts[0].start,contacts.at(-1).end],shape:base.kind==='thrust'?'thrust':'arc',reach:1.58,width:base.kind==='thrust'?.065:.15,advance:0,initialHands:[free,ready],midLength:.639,tipLength:1.129,tipOffset:[.12,-1.129,0],pointLanes:base.kind==='thrust'?[{hand:1,phase:.51,inner:.13,outer:.23,x:.08,y:.22,axis:[0,0,1]}]:[],cacheKey:'yanling-independent-v3:'+state+':'+index};
}
function tracksFor(spec){
 const right=[{p:0,...ready}],left=[{p:0,...free}],body=[{p:0,values:[0,0,-.055,0,0,.875]}];
 const single=spec.sequence.length===1;
 spec.sequence.forEach((index,i)=>{
  const t=techniques[index],c=spec.times[i],wind=single?.23:.15,sweep=single?.145:.11,brake=single?.23:.16;
  right.push({p:c-wind,...t.chamber},{p:c-sweep,...t.chamber},{p:c,...t.cross},{p:c+sweep,...t.exit},{p:c+brake,...t.exit});
  const [a,b]=t.turn,isPoint=t.kind==='thrust';
  // Hip turns before the blade; the chest follows after contact. The hand's
  // final short carry brakes the wrist while the planted leg absorbs load.
  body.push({p:c-wind-.055,values:[a*.65,a*.12,-.055,a*.025,spec.step[1]*.12,.855]},
   {p:c-sweep-.025,values:[a*.48,a*.31,-.065,0,spec.step[1]*.25,.84]},
   {p:c-.045,values:[isPoint?0:b*.48,isPoint?0:a*.27,-.075,-b*.025,spec.step[1]*.36,.835]},
   {p:c+sweep*.5,values:[b*.72,b*.28,-.06,-b*.04,spec.step[1]*.43,.84]},
   {p:c+brake,values:[b*.60,b*.35,-.055,-b*.03,spec.step[1]*.32,.85]});
  if(isPoint)for(const key of body){key.values[2]=-.055;key.values[5]=.855;}
  left.push({p:c-wind,...t.free[0]},{p:c,...t.free[1]},{p:c+brake,...t.free[2]});
 });
 right.push({p:1,...ready});left.push({p:1,...free});body.push({p:1,values:[0,0,-.055,0,0,.875]});
 for(const keys of [right,left,body])keys.sort((a,b)=>a.p-b.p);
 return {tracks:[left,right],body,torso:[{p:0,values:[0,0]},{p:1,values:[0,0]}],feet:p=>feetFor(spec,p)};
}
function feetFor(spec,p){
 const feet=[{x:-.185,y:.075,z:.13},{x:.185,y:.075,z:-.10}], [side,dz,dx]=spec.step;
 const start=.065,land=spec.times[0]-.13,recover=spec.times.at(-1)+.18;
 const smooth=x=>{const u=THREE.MathUtils.clamp(x,0,1);return u*u*(3-2*u);};
 const out=THREE.MathUtils.clamp((p-start)/(land-start),0,1),back=THREE.MathUtils.clamp((p-recover)/(1-recover),0,1),weight=smooth(out)*(1-smooth(back));
 feet[side].z+=dz*weight;feet[side].x+=dx*weight;
 if(p>start&&p<land)feet[side].y+=Math.sin(Math.PI*out)*.075;
 if(p>recover&&p<1)feet[side].y+=Math.sin(Math.PI*back)*.06;
 return feet;
}
export function sampleYanlingAttack(id,combo=0,phase=0,state='attack'){
 const spec=getYanlingAttack(id,combo,state);if(!spec)return null;
 return sampleAuthoredTracks(spec,tracksFor(spec),phase);
}
export function sampleYanlingReady(clock=0,pose={}){
 const breath=Math.sin(clock*1.8-.28);
 const blend=THREE.MathUtils.clamp(pose.moveBlend??(pose.state==='run'?1:0),0,1);
 const speed=THREE.MathUtils.clamp(pose.speed??blend,0,1);
 const movement=blend*speed,gait=pose.gaitPhase??0;
 // Distance-driven cadence opposes the left leg. Raise the swing's front
 // centre slightly so the returning empty palm stays outside the armour.
 const swing=Math.cos(gait)*movement;
 const right=hand([ready.grip[0],ready.grip[1]+breath*.007,ready.grip[2]+swing*.008],
  [ready.axis[0]+Math.sin(gait)*movement*.012,ready.axis[1]+breath*.01+swing*.012,ready.axis[2]]);
 const q=new THREE.Quaternion().fromArray(right.quaternion);
 q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.sin(gait-.35)*movement*.022));
 right.quaternion=q.toArray();
 const left=hand([free.grip[0]-.008*Math.sin(clock*.7),free.grip[1]+breath*.008,
  free.grip[2]+movement*.03+swing*.045],free.axis);
 return {hands:[left,right],stance:{yaw:0,load:0,pelvisYaw:0,chestYaw:0,pitch:-.055,advance:0,bodyHeight:.875},contacts:[],name:'侧前下警戒'};
}
