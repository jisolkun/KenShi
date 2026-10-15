import * as THREE from 'three';
import {HAMMER_ID,HAMMER_SHAFT,HAMMER_MOVES,getHammerAttackProfile,hammerIndex} from './definition.js';
import {sampleSourceLocomotion} from '../sourceMotion/clock.js';
import {sampleReferenceCurveBlend,createReferenceCurveBlendWorkspace} from '../sourceMotion/sampler.js';

const clamp=THREE.MathUtils.clamp;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const sole=.124;
const turn=Math.PI*2;
const yAxis=v(0,1,0);
// New choreography in the chest's moving space: grip XYZ, shaft yaw / pitch /
// roll, pelvis height / yaw / pitch, chest yaw / pitch, pelvis / chest bank,
// and pelvis XZ. Body rotation carries the entire skeleton through the strike.
// The attack boundaries share complete carries, so a held combo never resets.
// The resting shaft falls past the right hip toward the rear. Both palms
// stay on the same haft: the left hand leads across the waist, while the
// right hand supports the weight below it. The head has a clear floor gap.
const guard=[.26,.21,.15, 2.50,-.73,-.08, .91,0,.065, -.06,.065, 0,-.025,0,0];
const leftCarry=[.11,.20,.46, -.66,.13,-.24, .84,-2.60,.10, -.15,.035,-.10,-.055,-.035,.015];
const highCarry=[.11,.40,.43, .55,1.08,.78, .92,2.68,-.04, .20,-.13,.09,.055,.035,0];
const rightCarry=[.23,.24,.36,1.40,-.26,.80,.83,turn+.04,.13,-.015,.06,-.02,-.015,-.01,.02];
const tracks=[
  [[0,guard],
   [.18,[.23,.28,.33,1.72,-.18,-.025,.86,.58,-.035,.21,-.035,.06,.04,.04,-.035]],
   [.34,[.16,.29,.46,.82,.32,.20,.83,1.20,-.055,.32,-.025,.10,.05,.05,-.04]],
   [.46,[.16,.29,.48,.70,.22,.13,.85,.91,.01,.20,.035,.05,.025,.03,0]],
   [.61,[.16,.27,.51,.23,-.025,.01,.87,-.18,.095,-.08,.075,-.045,-.035,-.015,.045]],
   [.76,[.12,.22,.49,-.42,-.10,-.16,.82,-1.54,.14,-.27,.09,-.115,-.07,-.045,.04]],
   [1,leftCarry]],
  [[0,leftCarry],
   [.18,[.10,.18,.45,-.76,-.16,-.30,.79,-2.96,.12,-.24,.055,-.11,-.055,-.05,.015]],
   [.34,[.12,.21,.46,-.68,-.20,-.22,.80,-2.43,.10,-.23,.025,-.06,-.02,-.03,.02]],
   [.49,[.16,.26,.50,-.34,-.14,-.03,.86,-1.13,.045,-.17,-.02,.035,.035,.015,.04]],
   [.60,[.17,.32,.51,.18,.15,.18,.92,-.30,-.03,.12,-.08,.08,.06,.045,.055]],
   [.76,[.15,.40,.46,.48,.78,.58,1.00,1.12,-.10,.30,-.15,.13,.075,.065,.015]],
   [1,highCarry]],
  [[0,highCarry],
   [.17,[.12,.42,.42,.58,1.18,1.02,.86,3.19,-.075,.22,-.13,.11,.07,.035,-.025]],
   [.34,[.10,.43,.40,.45,1.39,1.40,1.19,4.20,-.095,.27,-.11,.14,.05,.035,-.015]],
   [.48,[.08,.43,.44,.27,1.28,1.54,1.28,5.12,-.03,.18,-.04,.09,.015,.015,.015]],
   [.61,[.09,.41,.55,.10,.55,1.56,1.10,5.98,.12,.07,.11,.015,-.025,0,.045]],
   [.725,[.12,.32,.59,-.10,-.51,1.57,.74,turn,.23,0,.13,-.025,-.015,-.02,.055]],
   [.80,[.13,.30,.58,-.08,-.60,1.53,.72,turn+.10,.25,.035,.14,-.04,-.015,-.025,.045]],
   [.88,[.17,.27,.47,.48,-.39,1.18,.80,turn+.08,.13,-.015,.06,-.02,-.015,-.01,.025]],
   [1,rightCarry]],
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
function resolveFrame(sample) {
  const bodyQ=sample.bodyQuaternion??new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.pelvisPitch,sample.pelvisYaw,sample.pelvisRoll??0,'XYZ'));
  const chestQ=bodyQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.chestPitch,sample.chestYaw,sample.chestRoll??0,'XYZ')));
  sample.grip=sample.gripLocal.clone().applyQuaternion(chestQ).add(sample.bodyPosition??v(sample.bodyX??0,sample.height,sample.bodyZ??0));
  const shaft=orientation(sample.shaftYaw,sample.shaftElevation,sample.shaftRoll);
  sample.quaternion=sample.shaftWorldQuaternion?.clone()??chestQ.multiply(shaft.quaternion);
  sample.axis=v(0,-1,0).applyQuaternion(sample.quaternion);
  return sample;
}
export function sampleHammerMotion(combo=0,phase=0) {
  const index=hammerIndex(combo), move=HAMMER_MOVES[index], p=clamp(phase,0,1);
  const t=clamp(p/move.recoverAt,0,1);
  let values=guard.map((_,i)=>component(tracks[index],i,t));
  if(p>move.recoverAt) {
    const amount=smooth((p-move.recoverAt)/(1-move.recoverAt));
    values=values.map((value,i)=>{
      const home=i===7?guard[i]+Math.round((value-guard[i])/turn)*turn:guard[i];
      return THREE.MathUtils.lerp(value,home,amount);
    });
    // An interrupted chain first clears the chest with a lifted, forward
    // haft, then lets the head settle to the right. A straight lerp from a
    // reverse carry to the low trailing carry would cut through the ribs.
    const lift=Math.sin(Math.PI*amount)*(index===2?0:1);
    values[1]+=lift*.20;values[2]+=lift*.16;values[4]+=lift*1.05;
  }
  return resolveFrame({index,phase:p,attackPhase:t,values,gripLocal:v(...values.slice(0,3)),
    shaftYaw:values[3],shaftElevation:values[4],shaftRoll:values[5],height:values[6],pelvisYaw:values[7],pelvisPitch:values[8],
    chestYaw:values[9],chestPitch:values[10],pelvisRoll:values[11],chestRoll:values[12],bodyX:values[13],bodyZ:values[14]});
}
// Root travel is applied by gameplay in the attack's initial heading. Never
// retract the completed step when the attack moves into its recovery segment.
export function sampleHammerTravel(combo=0,phase=0) {
  const index=hammerIndex(combo),t=clamp(phase/HAMMER_MOVES[index].recoverAt,0,1);
  const forward=HAMMER_MOVES[index].lunge*smooth((t-.08)/.66);
  const lateral=[.22,-.28,.12][index]*smooth((t-.08)/.52);
  return {forward,lateral};
}
function baseFeet() {return [v(-.205,sole,.11),v(.205,sole,-.10)];}
function attackFeet(rig,sample) {
  const feet=baseFeet(),t=sample.attackPhase,index=sample.index;
  const yaw=(sample.pelvisYaw-.12*Math.sin(sample.pelvisYaw)),lead=index===1?1:0;
  const first=clamp((t-.06)/.41,0,1),second=clamp((t-.47)/.43,0,1);
  for(let i=0;i<2;i++) {
    const swing=i===lead?first:second;
    feet[i].z+=(i===lead?.18:-.12)*Math.sin(Math.PI*swing);
    feet[i].x+=(i===lead?-.065:.065)*Math.sin(Math.PI*swing);
    feet[i].y+=Math.sin(Math.PI*swing)*(index===1?.25:.22);
    feet[i].applyAxisAngle(yAxis,yaw);
  }
  if(index===2) {
    // A true airborne turn: both shoes rise and tuck during the overhand load.
    const airborne=Math.sin(Math.PI*clamp((t-.17)/.49,0,1));
    feet.forEach((foot,i)=>{foot.y+=airborne*.42;foot.z+=(i===0?.11:-.16)*airborne;});
  }
  if(sample.phase>HAMMER_MOVES[index].recoverAt) {
    const blend=smooth((sample.phase-HAMMER_MOVES[index].recoverAt)/(1-HAMMER_MOVES[index].recoverAt));
    const home=baseFeet();feet.forEach((foot,i)=>foot.lerp(home[i],blend));
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
function constrainGrip(rig,grip,axis,q,clearLegs=false) {
  const primary=grip.clone(),right=rig.arms[1],left=rig.arms[0];
  const shoulders=[localPosition(rig,right.shoulder),localPosition(rig,left.shoulder).addScaledVector(axis,HAMMER_SHAFT.support)];
  const lengths=[right.elbow.position.length()+right.wrist.position.length()-.012,left.elbow.position.length()+left.wrist.position.length()-.012];
  const chestQ=localQuaternion(rig,rig.chest),headQ=localQuaternion(rig,rig.head);
  const chestPosition=localPosition(rig,rig.chest),headPosition=localPosition(rig,rig.head);
  const shapes=[
    {q:chestQ,origin:chestPosition,center:v(0,.015,0),radius:v(.34,.255,.275)},
    {q:chestQ,origin:chestPosition,center:v(0,.35,.015),radius:v(.405,.39,.335)},
    {q:headQ,origin:headPosition,center:v(0,.11,.025),radius:v(.30,.325,.30)},
    ...(clearLegs?rig.legs.map(leg=>({q:localQuaternion(rig,leg.hip),origin:localPosition(rig,leg.hip),
      center:v(0,-.205,.035),radius:v(.18,.30,.215)})):[]),
  ].map(shape=>({...shape,inverse:shape.q.clone().invert()}));
  const yExtent=HAMMER_SHAFT.halfExtents.reduce((sum,half,i)=>sum+half*Math.abs(v(i===0?1:0,i===1?1:0,i===2?1:0).applyQuaternion(q).y),0);
  const minimumGripY=HAMMER_SHAFT.floor+yExtent-axis.y*HAMMER_SHAFT.length;
  // Geometric capsules permit side/back carries and full turns. The earlier
  // universal front-plane clamp flattened every swing into a tiny frontal arc.
  for(let iteration=0;iteration<24;iteration++) {
    for(let hand=0;hand<2;hand++) {
      const reach=primary.clone().sub(shoulders[hand]),distance=reach.length();
      if(distance>lengths[hand])primary.copy(shoulders[hand]).addScaledVector(reach,lengths[hand]/distance);
    }
    for(const shape of shapes) {
      for(let along=-HAMMER_SHAFT.tail;along<.57;along+=.075) {
        const point=primary.clone().addScaledVector(axis,along).sub(shape.origin).applyQuaternion(shape.inverse).sub(shape.center);
        const normalized=point.clone().divide(shape.radius),distance=normalized.length();
        if(distance>=1)continue;
        if(distance<1e-6)normalized.set(0,0,1);else normalized.multiplyScalar(1/distance);
        const surface=normalized.multiply(shape.radius),push=surface.sub(point).applyQuaternion(shape.q);
        primary.add(push.multiplyScalar(.85));
      }
    }
    primary.y=Math.max(primary.y,minimumGripY);
  }
  // Finish inside the intersection of both reach spheres and the head-floor
  // half-space. Collision relaxation can leave millimetres of overshoot when
  // the overhead tail passes the head; neither wrist is allowed to detach.
  for(let iteration=0;iteration<36;iteration++) {
    for(let hand=0;hand<2;hand++) {
      const reach=primary.clone().sub(shoulders[hand]),distance=reach.length();
      if(distance>lengths[hand])primary.copy(shoulders[hand]).addScaledVector(reach,lengths[hand]/distance);
    }
    primary.y=Math.max(primary.y,minimumGripY);
  }
  return primary;
}
function applyBody(rig,sample,feet,state,time,phase,lowerFrame) {
  rig.body.position.copy(sample.bodyPosition??v(sample.bodyX??0,sample.height,sample.bodyZ??0));
  if(sample.bodyQuaternion)rig.body.quaternion.copy(sample.bodyQuaternion);
  else rig.body.rotation.set(sample.pelvisPitch,sample.pelvisYaw,sample.pelvisRoll??0);
  rig.chest.rotation.set(sample.chestPitch,sample.chestYaw,sample.chestRoll??0);
  // Small clavicle travel follows the authored body, rather than making an
  // invisible long arm. Both hands are still solved against actual bone lengths.
  for(const arm of rig.arms)arm.shoulder.position.z+=.035;
  const torsoYaw=sample.pelvisYaw+sample.chestYaw;
  // Continuous anticipation through a complete turn, with anatomical neck
  // limits and no discontinuity when an unwrapped pelvis crosses +/- PI.
  const ahead=-Math.sin(torsoYaw)*.82;
  rig.head.rotation.set(-sample.chestPitch*.42,ahead,-(sample.chestRoll??0)*.4);
  rig.group.updateMatrixWorld(true);
  if(lowerFrame) {
    for(let i=0;i<2;i++) {
      const leg=rig.legs[i],bone=9+i*3;
      leg.hip.position.fromArray(lowerFrame,76+i*3).multiplyScalar(.9);
      const bodyQ=new THREE.Quaternion().fromArray(lowerFrame,3);
      const hipQ=new THREE.Quaternion().fromArray(lowerFrame,3+bone*4);
      const kneeQ=new THREE.Quaternion().fromArray(lowerFrame,3+(bone+1)*4);
      const footQ=new THREE.Quaternion().fromArray(lowerFrame,3+(bone+2)*4);
      leg.hip.quaternion.copy(bodyQ.invert()).multiply(hipQ);
      leg.knee.quaternion.copy(hipQ.clone().invert()).multiply(kneeQ);
      leg.foot.quaternion.copy(kneeQ.invert()).multiply(footQ);
    }
  } else {
    const footYaw=(sample.pelvisYaw-.12*Math.sin(sample.pelvisYaw));
    const pole=v(0,-.06,1).applyAxisAngle(yAxis,sample.pelvisYaw);
    for(let i=0;i<2;i++) {
      const footQ=sample.footQuaternions?.[i]??new THREE.Quaternion().setFromAxisAngle(yAxis,footYaw);
      solveLimb(rig,rig.legs[i].hip,rig.legs[i].knee,rig.legs[i].foot,feet[i],pole,footQ);
    }
  }
  // Blend every lower-body joint through recovery, rather than switching
  // from IK to a source FK frame once a timer crosses a threshold.
  if(sample.recoveryLower) {
    const {frame,blend}=sample.recoveryLower;
    const bodyQ=new THREE.Quaternion().fromArray(frame,3);
    for(let i=0;i<2;i++) {
      const leg=rig.legs[i],bone=9+i*3;
      const hipQ=new THREE.Quaternion().fromArray(frame,3+bone*4);
      const kneeQ=new THREE.Quaternion().fromArray(frame,3+(bone+1)*4);
      const footQ=new THREE.Quaternion().fromArray(frame,3+(bone+2)*4);
      leg.hip.position.lerp(v().fromArray(frame,76+i*3).multiplyScalar(.9),blend);
      leg.hip.quaternion.slerp(bodyQ.clone().invert().multiply(hipQ),blend);
      leg.knee.quaternion.slerp(hipQ.clone().invert().multiply(kneeQ),blend);
      leg.foot.quaternion.slerp(kneeQ.clone().invert().multiply(footQ),blend);
    }
  }
  rig.pony.rotation.x=-.14-Math.sin(time*7)*.045-(sample.pelvisPitch??0)*.3;
  rig.pony.rotation.z=clamp(-sample.chestYaw*.23,-.25,.25);
  for(let i=0;i<rig.cloths.length;i++) {
    rig.cloths[i].rotation.x+=Math.sin(time*7+i)*.065-sample.pelvisPitch*.42;
    rig.cloths[i].rotation.z-=sample.chestYaw*.20+(sample.pelvisRoll??0)*.4;
  }
}
function sourceLowerBody(rig,runtime,pose,state,dt) {
  const action=['idle','walk','run'].includes(pose.sourceLocomotion)?pose.sourceLocomotion
    :['idle','walk','run'].includes(state)?state:runtime.lastLocomotion??'idle';
  runtime.lastLocomotion=action;
  const samples=sampleSourceLocomotion(rig,{weaponId:'tang-dao',state:action,dt,
    speedFactor:pose.speedFactor,hold:pose.dt===0&&!pose.immediate});
  const sampled=sampleReferenceCurveBlend(samples,runtime.sourceBlend);
  return {samples,frame:sampled?.frame};
}
function floorMinimum(rig) {
  rig.group.updateMatrixWorld(true);
  return Math.min(...rig.legs.map(leg=>new THREE.Box3().setFromObject(leg.foot,true).min.y-rig.group.position.y));
}
export function resetCustomHammerPose(rig) {rig.customHammerState=undefined;rig.customHammerDebug=undefined;}
export function applyCustomHammerPose(rig,pose={}) {
  if(rig.type!=='hero'||rig.weaponId!==HAMMER_ID)return false;
  const state=pose.state??'idle',phase=clamp(pose.sourceAttack?.phase??pose.phase??0,0,1);
  let runtime=rig.customHammerState;
  if(!runtime)runtime=rig.customHammerState={weaponId:HAMMER_ID,key:null,time:0,blendAge:0,last:null,from:null,
    sourceBlend:createReferenceCurveBlendWorkspace(),lastLocomotion:'idle'};
  if(pose.dt===0&&!pose.immediate&&runtime.last)return true;
  const dt=Number.isFinite(pose.dt)?Math.max(0,pose.dt):1/60;
  runtime.time+=dt;
  const time=Number.isFinite(pose.time)?pose.time:runtime.time;
  let sample=state==='attack'?sampleHammerMotion(pose.combo,phase):sampleHammerMotion(0,0);
  let feet=state==='attack'?attackFeet(rig,sample):baseFeet();
  const lower=sourceLowerBody(rig,runtime,pose,state,dt);
  let lowerFrame=['idle','walk','run'].includes(state)?lower.frame:null;
  if(lowerFrame) {
    // Original source pelvis/leg curves retain their nimble knee lift, stride,
    // leaning and layer-0 run/walk clock. Only the hammer carry is authored here.
    sample.bodyPosition=v().fromArray(lowerFrame,0).multiplyScalar(.9);
    sample.bodyQuaternion=new THREE.Quaternion().fromArray(lowerFrame,3).normalize();
    sample.height=sample.bodyPosition.y;
    const bodyEuler=new THREE.Euler().setFromQuaternion(sample.bodyQuaternion,'YXZ');
    sample.pelvisYaw=bodyEuler.y;sample.pelvisPitch=bodyEuler.x;sample.pelvisRoll=bodyEuler.z;
    const movement=state==='run'?1:state==='walk'?.5:0;
    // Keep the source pelvis and every leg joint intact. The loaded shoulder
    // counters its twist, so the head trails on the right instead of swinging
    // across the knees. Small heave and delayed shaft sway share the actual
    // source stride clock rather than an unrelated wall-time oscillation.
    let stride=0,heave=0;
    for(const source of lower.samples) {
      if(source.state==='idle')continue;
      const cycle=source.phase*turn;
      stride+=Math.sin(cycle-.42)*source.weight;
      heave+=Math.sin(cycle*2-.65)*source.weight;
    }
    sample.chestYaw=-.06-bodyEuler.y*.72;sample.chestPitch=.045+movement*.075;
    sample.chestRoll=-.025-bodyEuler.z*.30-movement*.014;
    sample.gripLocal.x+=movement*.035+stride*.008*movement;
    sample.gripLocal.y+=movement*.040+heave*.010*movement;
    sample.gripLocal.z-=movement*.025;
    // The heavy head resists the source runner's lively pelvis twist. Keep
    // its main line in character space and let the shoulders move around it;
    // only a small stride-delayed pendulum reaches the shaft itself.
    sample.shaftWorldQuaternion=orientation(2.50+stride*.032*movement,
      -.83-heave*.018*movement,-.08+stride*.024*movement).quaternion;
  } else if(state==='attack'&&phase>HAMMER_MOVES[sample.index].recoverAt&&(pose.speed??0)>.025&&lower.frame) {
    const recoveryTime=(phase-HAMMER_MOVES[sample.index].recoverAt)*HAMMER_MOVES[sample.index].duration;
    // Use the whole recovery for the turn back into locomotion. A short
    // fixed blend forced a complete body turn into only a few render frames.
    const blend=smooth(recoveryTime/HAMMER_MOVES[sample.index].recoverySeconds),frame=lower.frame;
    const fromBody=new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.pelvisPitch,sample.pelvisYaw,sample.pelvisRoll));
    const sourceBody=new THREE.Quaternion().fromArray(frame,3).normalize();
    sample.bodyQuaternion=fromBody.slerp(sourceBody,blend);
    sample.bodyPosition=v(sample.bodyX,sample.height,sample.bodyZ).lerp(v().fromArray(frame,0).multiplyScalar(.9),blend);
    sample.height=sample.bodyPosition.y;
    const sourceYaw=new THREE.Euler().setFromQuaternion(sourceBody,'YXZ').y;
    sample.pelvisYaw+=Math.atan2(Math.sin(sourceYaw-sample.pelvisYaw),Math.cos(sourceYaw-sample.pelvisYaw))*blend;
    sample.footQuaternions=[];
    for(let i=0;i<2;i++) {
      const bone=9+i*3,hipQ=new THREE.Quaternion().fromArray(frame,3+bone*4),kneeQ=new THREE.Quaternion().fromArray(frame,3+(bone+1)*4);
      const target=v().fromArray(frame,76+i*3).multiplyScalar(.9).applyQuaternion(sourceBody).add(v().fromArray(frame,0).multiplyScalar(.9));
      target.add(v(0,-.46*.9,0).applyQuaternion(hipQ)).add(v(0,-.43*.9,0).applyQuaternion(kneeQ));
      feet[i].lerp(target,blend);
      sample.footQuaternions[i]=new THREE.Quaternion().setFromAxisAngle(yAxis,(sample.pelvisYaw-.12*Math.sin(sample.pelvisYaw)))
        .slerp(new THREE.Quaternion().fromArray(frame,3+(bone+2)*4),blend);
    }
    sample.recoveryLower={frame,blend};
  } else if(state!=='attack') {
    const breathe=Math.sin(time*2.3)*.008;sample.height+=breathe;sample.gripLocal.y+=breathe;
    if(state==='hurt') {
      const stress=Math.sin(Math.PI*phase);sample.height-=.08*stress;
      sample.pelvisPitch=-.23*stress;sample.chestPitch=-.15*stress;sample.gripLocal.z+=.045*stress;
    } else if(state==='roll') {
      // A low, side-leading spring step keeps both hands on the hammer and
      // responds immediately to the locomotion controller's evasive travel.
      const tuck=Math.sin(Math.PI*phase);sample.height-=.29*tuck;
      sample.pelvisYaw=-.75*tuck;sample.pelvisPitch=.48*tuck;sample.pelvisRoll=-.48*tuck;
      sample.chestPitch=.22*tuck;sample.gripLocal.y-=.07*tuck;sample.gripLocal.z+=.03*tuck;
      sample.shaftYaw+=.55*tuck;sample.shaftElevation+=.20*tuck;
      feet.forEach((foot,i)=>{foot.y+=(i===0?.28:.13)*tuck;foot.z+=(i===0?.27:-.28)*tuck;});
    } else if(state==='guard') {
      sample.height-=.06;sample.pelvisYaw=-.28;sample.chestYaw=.15;sample.gripLocal.y+=.14;
      sample.shaftYaw=-.48;sample.shaftElevation=.32;feet[0].z+=.13;feet[1].z-=.10;
    } else if(state==='dead') {
      const collapse=smooth(phase);sample.height-=.26*collapse;sample.pelvisPitch=.52*collapse;
      sample.chestPitch=.46*collapse;sample.gripLocal.y-=.10*collapse;sample.gripLocal.z+=.12*collapse;
    }
  }
  const key=state==='attack'?`attack:${sample.index}`:state;
  if(runtime.key!==key){runtime.from=runtime.last;runtime.blendAge=0;runtime.key=key;}
  runtime.blendAge+=dt;
  resolveFrame(sample);
  // Short source-like crossfade on a true state change. Consecutive authored
  // carries already meet exactly and are displayed without a heavy wind-up.
  const transitionSeconds=state==='attack'&&runtime.from?.state!=='attack'?.075
    :lowerFrame&&runtime.from?.state==='attack'?.095:.055;
  if(runtime.from&&!pose.immediate&&runtime.blendAge<transitionSeconds) {
    const amount=smooth(runtime.blendAge/transitionSeconds),from=runtime.from;
    sample.grip.lerp(from.grip,1-amount);sample.quaternion.slerp(from.quaternion,1-amount);
    sample.axis.copy(v(0,-1,0).applyQuaternion(sample.quaternion));
    for(const name of ['height','pelvisPitch','chestYaw','chestPitch','pelvisRoll','chestRoll','bodyX','bodyZ'])
      sample[name]=THREE.MathUtils.lerp(from[name]??0,sample[name]??0,amount);
    const delta=Math.atan2(Math.sin(sample.pelvisYaw-from.pelvisYaw),Math.cos(sample.pelvisYaw-from.pelvisYaw));
    sample.pelvisYaw=from.pelvisYaw+delta*amount;
    if(!lowerFrame)feet.forEach((foot,i)=>foot.lerp(from.feet[i],1-amount));
  }
  for(const {node,p,r,s} of rig.bind){node.position.copy(p);node.rotation.copy(r);node.scale.copy(s);}
  rig.arms[1].weapon.position.set(0,0,0);rig.arms[1].weapon.quaternion.identity();
  applyBody(rig,sample,feet,state,time,phase,lowerFrame);
  // Preserve authored airborne moments; only actual shoe penetration lifts the
  // rig. The two arms are solved after that correction from the same rigid shaft.
  let minimum=floorMinimum(rig);
  if(minimum<.055) {
    const correction=.055-minimum;rig.body.position.y+=correction;sample.grip.y+=correction;
    rig.group.updateMatrixWorld(true);minimum=floorMinimum(rig);
  }
  const grip=constrainGrip(rig,sample.grip,sample.axis,sample.quaternion,!!lowerFrame);
  const support=grip.clone().addScaledVector(sample.axis,-HAMMER_SHAFT.support);
  const chestQ=localQuaternion(rig,rig.chest);
  solveLimb(rig,rig.arms[1].shoulder,rig.arms[1].elbow,rig.arms[1].wrist,grip,v(.85,-.15,-.25).applyQuaternion(chestQ),sample.quaternion);
  solveLimb(rig,rig.arms[0].shoulder,rig.arms[0].elbow,rig.arms[0].wrist,support,v(-.85,-.15,-.25).applyQuaternion(chestQ),sample.quaternion);
  rig.group.updateMatrixWorld(true);
  const footMinY=floorMinimum(rig);
  const gap=rig.offhandGrip.getWorldPosition(v()).distanceTo(rig.arms[0].wrist.getWorldPosition(v()));
  runtime.last={...sample,state,grip:grip.clone(),quaternion:sample.quaternion.clone(),feet:feet.map(foot=>foot.clone())};
  const profile=getHammerAttackProfile(pose.combo);
  rig.sourcePose={active:true,state,profile,phase,segment:pose.sourceAttack?.segment??'custom',footMinY,offhandGap:gap,scale:.9};
  rig.sourceMotionDebug={active:true,state,family:'custom-hammer',clip:state==='attack'?profile.name:`custom_hammer_${state}`,
    phase,authored:true,rawTime:pose.sourceAttack?.rawTime??0,
    locomotion:lower.samples.map(({state,phase,rawTime,weight})=>({state,phase,rawTime,weight})),offhandGap:gap,footMinY};
  rig.customHammerDebug={state,combo:sample.index,phase,attackPhase:sample.attackPhase,offhandGap:gap,footMinY,
    grip:grip.toArray(),axis:sample.axis.toArray(),headMinY:rig.weaponBlades()[0].headMinY,
    pelvisYaw:sample.pelvisYaw,chestYaw:sample.chestYaw,airborne:footMinY>.16,
    authoring:'Original-scale body turns and source locomotion; independently authored three-hit shaft paths'};
  rig.reviewedAttackSample=null;rig.attackFootTargets=lowerFrame?null:feet;
  return true;
}
