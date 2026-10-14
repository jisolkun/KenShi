import * as THREE from 'three';
import {HAMMER_ID,HAMMER_SHAFT,HAMMER_MOVES,getHammerAttackProfile,hammerIndex} from './definition.js';

const clamp=THREE.MathUtils.clamp;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const sole=.124;
// Grip, yaw/elevation/head roll, pelvis height/yaw/pitch, chest yaw/pitch.
// Carries are shared at the attack/recovery boundary, including both feet.
const guard=[.03,1.07,.39, .62,.72,0, .88,.02,.025, -.02,.015];
const leftCarry=[-.10,1.01,.44, -1.10,-.18,-.05, .84,-.34,.045, .17,.025];
const highCarry=[.03,1.17,.40, .62,1.06,-.72, .90,.18,.015, .12,-.035];
const tracks=[
  [[0,guard],[.22,[.08,1.09,.38,.95,.35,.02,.85,.20,.035,.08,.01]],
   [.48,[.15,1.12,.41,1.24,.14,.06,.81,.34,.045,.08,.025]],
   [.56,[.14,1.11,.46,1.08,.13,.045,.82,.20,.06,.18,.035]],
   [.67,[.08,1.08,.55,.08,.045,0,.86,-.12,.07,.16,.05]],
   [.83,[-.12,1.00,.48,-1.08,-.16,-.05,.83,-.36,.055,.16,.035]],
   [1,leftCarry]],
  [[0,leftCarry],[.28,[-.08,.97,.40,-1.22,-.34,-.04,.80,-.35,.035,.16,.01]],
   [.46,[-.05,.99,.44,-1.08,-.28,-.04,.81,-.16,.04,-.03,.015]],
   [.60,[0,1.10,.53,-.38,.035,-.12,.85,.07,.025,.045,-.025]],
   [.68,[.06,1.12,.54,.10,.30,-.26,.90,.28,.01,.10,-.045]],
   [.85,[.04,1.17,.41,.62,.99,-.66,.91,.26,.015,.12,-.04]],
   [1,highCarry]],
  [[0,highCarry],[.20,[.02,1.30,.39,.40,1.25,-1.05,.84,.12,-.015,.07,-.06]],
   [.40,[.01,1.40,.36,.20,1.42,-1.50,.84,.08,-.025,.015,-.075]],
   [.52,[0,1.36,.42,.04,1.23,-1.52,.86,.025,.08,0,.10]],
   [.62,[0,1.24,.55,0,.50,-1.53,.85,-.015,.14,0,.17]],
   [.72,[0,1.03,.59,0,-.45,-1.54,.78,-.025,.18,0,.20]],
   [.77,[0,.98,.55,0,-.79,-1.54,.75,-.025,.20,0,.20]],
   [.84,[.02,1.00,.50,.08,-.42,-1.40,.80,-.01,.10,.01,.12]],
   [.92,[.03,1.05,.40,.36,.40,-.58,.86,.01,.04,-.01,.03]],
   [1,guard]],
];

// Monotone Hermite slopes preserve the authored extrema, but keep nonzero
// tangents through the release. The first/last tangent is zero for carry joins.
function component(track,index,time) {
  const values=track.map(key=>key[1][index]);
  const slopes=track.slice(1).map((key,i)=>(values[i+1]-values[i])/(key[0]-track[i][0]));
  const tangent=i=>{
    if(i===0||i===track.length-1)return 0;
    const a=slopes[i-1],b=slopes[i];
    if(a*b<=0)return 0;
    const h0=track[i][0]-track[i-1][0],h1=track[i+1][0]-track[i][0];
    const w0=2*h1+h0,w1=h1+2*h0;
    return (w0+w1)/(w0/a+w1/b);
  };
  let i=0;while(i<track.length-2&&time>track[i+1][0])i++;
  const h=track[i+1][0]-track[i][0],u=clamp((time-track[i][0])/h,0,1),u2=u*u,u3=u2*u;
  return (2*u3-3*u2+1)*values[i]+(u3-2*u2+u)*h*tangent(i)
    +(-2*u3+3*u2)*values[i+1]+(u3-u2)*h*tangent(i+1);
}
function orientation(yaw,elevation,roll) {
  const axis=v(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation));
  const x=v(Math.cos(yaw),0,-Math.sin(yaw)).applyAxisAngle(axis,roll);
  const y=axis.clone().negate(),z=v().crossVectors(x,y).normalize();
  return {axis,quaternion:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z))};
}
export function sampleHammerMotion(combo=0,phase=0) {
  const index=hammerIndex(combo), move=HAMMER_MOVES[index], p=clamp(phase,0,1);
  const t=clamp(p/move.recoverAt,0,1);
  let values=guard.map((_,i)=>component(tracks[index],i,t));
  if(p>move.recoverAt) {
    const amount=smooth((p-move.recoverAt)/(1-move.recoverAt));
    values=values.map((value,i)=>THREE.MathUtils.lerp(value,guard[i],amount));
  }
  return {index,phase:p,attackPhase:t,values,grip:v(...values.slice(0,3)),
    ...orientation(...values.slice(3,6)),height:values[6],pelvisYaw:values[7],pelvisPitch:values[8],
    chestYaw:values[9],chestPitch:values[10]};
}
function baseFeet() {return [v(-.205,sole,.11),v(.205,sole,-.10)];}
function attackFeet(rig,sample,step) {
  const feet=baseFeet(),t=sample.attackPhase,lead=sample.index===1?1:0;
  if(step?.feet) {
    const forward=v(Math.sin(step.angle),0,Math.cos(step.angle));
    const travel=HAMMER_MOVES[sample.index].lunge;
    return step.feet.map((anchor,i)=>{
      const target=anchor.clone();
      if(i===lead) {
        const progress=smooth((t-.08)/.45);
        target.addScaledVector(forward,travel*1.18*progress);
        target.y+=Math.sin(Math.PI*clamp((t-.08)/.45,0,1))*.13;
      } else {
        const follow=clamp((t-.78)/.22,0,1);
        target.addScaledVector(forward,travel*.82*smooth(follow));
        target.y+=Math.sin(Math.PI*follow)*.08;
      }
      return rig.group.worldToLocal(target);
    });
  }
  const stepAmount=sample.index===2?.16:.13;
  const settle=clamp((t-.80)/.20,0,1);
  feet[lead].z+=stepAmount*smooth((t-.08)/.45)*(1-smooth(settle));
  feet[lead].y+=Math.sin(Math.PI*clamp((t-.08)/.45,0,1))*(sample.index===2?.15:.11);
  feet[lead].y+=Math.sin(Math.PI*settle)*.07;
  if(sample.phase>HAMMER_MOVES[sample.index].recoverAt) {
    const mix=smooth((sample.phase-HAMMER_MOVES[sample.index].recoverAt)/(1-HAMMER_MOVES[sample.index].recoverAt));
    const home=baseFeet();feet.forEach((foot,i)=>foot.lerp(home[i],mix));
  }
  return feet;
}
function localQuaternion(rig,node) {return rig.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(node.getWorldQuaternion(new THREE.Quaternion()));}
function localPosition(rig,node) {return rig.group.worldToLocal(node.getWorldPosition(v()));}

// Solve the actual retargeted joint offsets, including the wrist's small Z
// offset. The two hands are targets on one shaft, never separately rotated rods.
function solveLimb(rig,root,mid,end,target,pole,endQuaternion) {
  const start=localPosition(rig,root),delta=target.clone().sub(start);
  const a=mid.position.length(),b=end.position.length(),distance=clamp(delta.length(),Math.abs(a-b)+.0001,a+b-.0001);
  const aim=delta.normalize(),bend=pole.clone().addScaledVector(aim,-pole.dot(aim));
  if(bend.lengthSq()<1e-8)bend.set(0,0,1).addScaledVector(aim,-aim.z);
  bend.normalize();
  const along=(a*a+distance*distance-b*b)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  const elbow=start.clone().addScaledVector(aim,along).addScaledVector(bend,height);
  const upperQ=new THREE.Quaternion().setFromUnitVectors(mid.position.clone().normalize(),elbow.clone().sub(start).normalize());
  const parentQ=localQuaternion(rig,root.parent);
  root.quaternion.copy(parentQ.invert()).multiply(upperQ);
  const actualTarget=start.clone().addScaledVector(aim,distance);
  const lowerQ=new THREE.Quaternion().setFromUnitVectors(end.position.clone().normalize(),actualTarget.sub(elbow).normalize());
  mid.quaternion.copy(upperQ.clone().invert()).multiply(lowerQ);
  end.quaternion.copy(lowerQ.invert()).multiply(endQuaternion);
  rig.group.updateMatrixWorld(true);
}
function softPositive(x,e=.018) {return x<=-e?0:x>=e?x:(x+e)*(x+e)/(4*e);}
function constrainGrip(rig,grip,axis,q) {
  const primary=grip.clone(),right=rig.arms[1],left=rig.arms[0];
  const shoulders=[localPosition(rig,right.shoulder),localPosition(rig,left.shoulder).addScaledVector(axis,HAMMER_SHAFT.support)];
  const lengths=[right.elbow.position.length()+right.wrist.position.length()-.018,left.elbow.position.length()+left.wrist.position.length()-.018];
  const chestQ=localQuaternion(rig,rig.chest),chestInverse=chestQ.clone().invert(),chestPosition=localPosition(rig,rig.chest);
  const forward=v(0,0,1).applyQuaternion(chestQ);
  const headQ=localQuaternion(rig,rig.head),headInverse=headQ.clone().invert(),headPosition=localPosition(rig,rig.head);
  const headForward=v(0,0,1).applyQuaternion(headQ);
  const yExtent=HAMMER_SHAFT.halfExtents.reduce((sum,half,i)=>sum+half*Math.abs(v(i===0?1:0,i===1?1:0,i===2?1:0).applyQuaternion(q).y),0);
  const minimumGripY=HAMMER_SHAFT.floor+yExtent-axis.y*HAMMER_SHAFT.length;
  for(let iteration=0;iteration<16;iteration++) {
    for(let hand=0;hand<2;hand++) {
      const reach=primary.clone().sub(shoulders[hand]),distance=reach.length();
      if(distance>lengths[hand])primary.copy(shoulders[hand]).addScaledVector(reach,lengths[hand]/distance);
    }
    primary.y=Math.max(primary.y,minimumGripY);
    let clearance=0;
    for(const offset of [0,HAMMER_SHAFT.support,HAMMER_SHAFT.tail]) {
      const point=primary.clone().addScaledVector(axis,-offset).sub(chestPosition).applyQuaternion(chestInverse);
      if(point.y>-.12&&point.y<.58&&Math.abs(point.x)<.37)
        clearance=Math.max(clearance,.29-point.z);
    }
    if(clearance>0)primary.addScaledVector(forward,clearance);
    let faceClearance=0;
    for(const offset of [0,.12,HAMMER_SHAFT.support,HAMMER_SHAFT.tail]) {
      const point=primary.clone().addScaledVector(axis,-offset).sub(headPosition).applyQuaternion(headInverse);
      if(Math.abs(point.x)<.22&&point.y>-.13&&point.y<.38)
        faceClearance=Math.max(faceClearance,.27-point.z);
    }
    if(faceClearance>0)primary.addScaledVector(headForward,faceClearance);
  }
  primary.y+=softPositive(minimumGripY-primary.y);
  return primary;
}
function applyBody(rig,sample,feet,state,time,phase) {
  rig.body.position.y=sample.height;
  rig.body.rotation.set(sample.pelvisPitch,sample.pelvisYaw,state==='roll'?Math.sin(Math.PI*phase)*-.34:0);
  rig.chest.rotation.set(sample.chestPitch,sample.chestYaw,0);
  rig.chest.position.z+=state==='attack'?.018:.005;
  // Girdle protraction keeps the grip ahead of armour without extending arms.
  for(const arm of rig.arms)arm.shoulder.position.z+=.065;
  rig.head.rotation.set(-sample.chestPitch*.45,-(sample.pelvisYaw+sample.chestYaw)*.68,0);
  rig.group.updateMatrixWorld(true);
  for(let i=0;i<2;i++)solveLimb(rig,rig.legs[i].hip,rig.legs[i].knee,rig.legs[i].foot,
    feet[i],v(rig.legs[i].side*.15,-.08,1),new THREE.Quaternion());
  rig.pony.rotation.x=-.10-Math.sin(time*5)*.025;
  rig.pony.rotation.z=-sample.chestYaw*.16;
  for(let i=0;i<rig.cloths.length;i++) {
    rig.cloths[i].rotation.x+=Math.sin(time*5+i)*.04-sample.pelvisPitch*.3;
    rig.cloths[i].rotation.z-=sample.chestYaw*.12;
  }
}

export function resetCustomHammerPose(rig) {rig.customHammerState=undefined;rig.customHammerDebug=undefined;}
export function applyCustomHammerPose(rig,pose={}) {
  if(rig.type!=='hero'||rig.weaponId!==HAMMER_ID)return false;
  const state=pose.state??'idle',phase=clamp(pose.sourceAttack?.phase??pose.phase??0,0,1);
  let runtime=rig.customHammerState;
  if(!runtime)runtime=rig.customHammerState={weaponId:HAMMER_ID,key:null,time:0,blendAge:0,last:null,from:null};
  if(pose.dt===0&&!pose.immediate&&runtime.last)return true;
  const dt=Number.isFinite(pose.dt)?Math.max(0,pose.dt):1/60;
  runtime.time+=dt;
  const time=Number.isFinite(pose.time)?pose.time:runtime.time;
  let sample=state==='attack'?sampleHammerMotion(pose.combo,phase):sampleHammerMotion(0,0);
  let feet=state==='attack'?attackFeet(rig,sample,pose.attackStep):baseFeet();
  if(state==='attack'&&pose.attackStep&&phase>HAMMER_MOVES[sample.index].recoverAt&&(pose.speed??0)>.025) {
    const recoveryTime=(phase-HAMMER_MOVES[sample.index].recoverAt)*HAMMER_MOVES[sample.index].duration;
    const blend=smooth(recoveryTime/.075),gait=pose.gaitPhase??0,movement=clamp(pose.speed,0,1);
    const walking=baseFeet();
    walking.forEach((foot,i)=>{const angle=gait+i*Math.PI;foot.z+=Math.cos(angle)*.25*movement;foot.y+=Math.max(0,Math.sin(angle))*.16*movement;});
    feet.forEach((foot,i)=>foot.lerp(walking[i],blend));
    sample.height=THREE.MathUtils.lerp(sample.height,.87+Math.cos(gait*2)*.021*movement,blend);
    sample.pelvisPitch=THREE.MathUtils.lerp(sample.pelvisPitch,.075*movement,blend);
  }
  if(state!=='attack') {
    const movement=state==='run'?1:state==='walk'?.48:0;
    const gait=pose.gaitPhase??runtime.time*(state==='run'?8:4.5);
    if(movement) {
      feet.forEach((foot,i)=>{const angle=gait+i*Math.PI;foot.z+=Math.cos(angle)*.25*movement;foot.y+=Math.max(0,Math.sin(angle))*.16*movement;});
      sample.height=.87+Math.cos(gait*2)*.021*movement;
      sample.pelvisYaw=Math.sin(gait)*.075*movement;sample.chestYaw=-sample.pelvisYaw*.7;
      sample.pelvisPitch=.075*movement;
      sample.grip.y+=Math.cos(gait*2)*.023*movement;sample.grip.z+=.025*movement;
      sample.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),Math.sin(gait)*.035*movement));
      sample.axis.copy(v(0,-1,0).applyQuaternion(sample.quaternion));
    } else {
      const breathe=Math.sin(time*2.3)*.008;sample.height+=breathe;sample.grip.y+=breathe;
      sample.chestYaw+=Math.sin(time*1.7)*.012;
    }
    if(state==='hurt') {
      const stress=Math.sin(Math.PI*phase);sample.height-=.075*stress;
      sample.pelvisPitch=-.14*stress;sample.chestPitch=-.10*stress;sample.grip.z+=.065*stress;
    } else if(state==='roll') {
      const tuck=Math.sin(Math.PI*phase);sample.height-=.23*tuck;
      sample.pelvisPitch=.35*tuck;sample.chestPitch=.18*tuck;sample.grip.y-=.17*tuck;
      sample.grip.z+=.06*tuck;feet.forEach((foot,i)=>{foot.y+=.10*tuck;foot.z+=(i===0?.18:-.17)*tuck;});
    } else if(state==='dead') {
      const collapse=smooth(phase);sample.height-=.24*collapse;sample.pelvisPitch=.48*collapse;
      sample.chestPitch=.43*collapse;sample.grip.y-=.16*collapse;sample.grip.z+=.14*collapse;
    }
  }
  const key=state==='attack'?`attack:${sample.index}`:state;
  if(runtime.key!==key) {
    runtime.from=runtime.last;runtime.blendAge=0;runtime.key=key;
  }
  runtime.blendAge+=dt;
  if(runtime.from&&!pose.immediate&&runtime.blendAge<.09) {
    const a=smooth(runtime.blendAge/.09),from=runtime.from;
    sample.grip.lerp(from.grip,1-a);sample.quaternion.slerp(from.quaternion,1-a);
    sample.axis.copy(v(0,-1,0).applyQuaternion(sample.quaternion));
    for(const name of ['height','pelvisYaw','pelvisPitch','chestYaw','chestPitch'])sample[name]=THREE.MathUtils.lerp(from[name],sample[name],a);
    feet.forEach((foot,i)=>foot.lerp(from.feet[i],1-a));
  }
  for(const {node,p,r,s} of rig.bind){node.position.copy(p);node.rotation.copy(r);node.scale.copy(s);}
  rig.arms[1].weapon.position.set(0,0,0);rig.arms[1].weapon.quaternion.identity();
  applyBody(rig,sample,feet,state,time,phase);
  const grip=constrainGrip(rig,sample.grip,sample.axis,sample.quaternion);
  const support=grip.clone().addScaledVector(sample.axis,-HAMMER_SHAFT.support);
  solveLimb(rig,rig.arms[1].shoulder,rig.arms[1].elbow,rig.arms[1].wrist,grip,v(.8,-.12,.65),sample.quaternion);
  solveLimb(rig,rig.arms[0].shoulder,rig.arms[0].elbow,rig.arms[0].wrist,support,v(-.8,-.12,.65),sample.quaternion);
  rig.group.updateMatrixWorld(true);
  const footMinY=Math.min(...rig.legs.map(leg=>{const box=new THREE.Box3().setFromObject(leg.foot,true);return box.min.y-rig.group.position.y;}));
  const gap=rig.offhandGrip.getWorldPosition(v()).distanceTo(rig.arms[0].wrist.getWorldPosition(v()));
  runtime.last={...sample,grip:sample.grip.clone(),quaternion:sample.quaternion.clone(),feet:feet.map(foot=>foot.clone())};
  const profile=getHammerAttackProfile(pose.combo);
  rig.sourcePose={active:true,state,profile,phase,segment:pose.sourceAttack?.segment??'custom',footMinY,offhandGap:gap,scale:.9};
  rig.sourceMotionDebug={active:true,state,family:'custom-hammer',clip:state==='attack'?profile.name:`custom_hammer_${state}`,
    phase,authored:true,rawTime:pose.sourceAttack?.rawTime??0,locomotion:[],offhandGap:gap,footMinY};
  rig.customHammerDebug={state,combo:sample.index,phase,attackPhase:sample.attackPhase,offhandGap:gap,footMinY,
    grip:grip.toArray(),axis:sample.axis.toArray(),headMinY:rig.weaponBlades()[0].headMinY,
    authoring:'New three-hit Hermite paths; original source rhythm only'};
  rig.reviewedAttackSample=null;rig.attackFootTargets=feet;
  return true;
}
