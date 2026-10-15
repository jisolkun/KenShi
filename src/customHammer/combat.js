import {Quaternion,Vector3} from 'three';

const validVector=v=>v&&[v.x,v.y,v.z].every(Number.isFinite);
export function interpolateHammerFrame(a,b,t) {
  const headCenter=a.headCenter.clone().lerp(b.headCenter,t);
  const headQuaternion=a.headQuaternion.clone().slerp(b.headQuaternion,t);
  const headHalfExtents=a.headHalfExtents.clone().lerp(b.headHalfExtents,t);
  const corners=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>
    new Vector3(x*headHalfExtents.x,y*headHalfExtents.y,z*headHalfExtents.z).applyQuaternion(headQuaternion).add(headCenter))));
  return {...b,headCenter,tip:headCenter,headQuaternion,headHalfExtents,headCorners:corners,
    headMinY:Math.min(...corners.map(c=>c.y))};
}
export function clipHammerSweep(current,previous,phase,previousPhase,window) {
  if(!current?.headCenter||!window)return null;
  if(!previous||!Number.isFinite(previousPhase)||phase<=previousPhase)
    return phase>=window[0]&&phase<=window[1]?{current,previous:null}:null;
  const from=Math.max(previousPhase,window[0]),to=Math.min(phase,window[1]);
  if(to<from)return null;
  const at=p=>interpolateHammerFrame(previous,current,(p-previousPhase)/(phase-previousPhase));
  return {current:at(to),previous:at(from)};
}

// Exact squared distance of a segment to an axis-aligned box: on each interval
// between box-face crossings the distance is one convex quadratic.
function segmentBoxClosest(a,b,half) {
  const delta=b.clone().sub(a),cuts=[0,1];
  for(const axis of ['x','y','z'])if(Math.abs(delta[axis])>1e-12)
    for(const face of [-half[axis],half[axis]]) {const t=(face-a[axis])/delta[axis];if(t>0&&t<1)cuts.push(t);}
  cuts.sort((x,y)=>x-y);
  let distance=Infinity,closestTime=0;
  const evaluate=t=>{
    let result=0;for(const axis of ['x','y','z']){const value=a[axis]+delta[axis]*t;const d=Math.max(0,Math.abs(value)-half[axis]);result+=d*d;}
    if(result<distance){distance=result;closestTime=t;}
  };
  for(let i=0;i<cuts.length-1;i++) {
    const low=cuts[i],high=cuts[i+1],middle=(low+high)*.5;
    let numerator=0,denominator=0;
    for(const axis of ['x','y','z']) {
      const sample=a[axis]+delta[axis]*middle;
      if(Math.abs(sample)<=half[axis])continue;
      const edge=sample>0?half[axis]:-half[axis];
      numerator+=(a[axis]-edge)*delta[axis];denominator+=delta[axis]*delta[axis];
    }
    evaluate(low);evaluate(high);
    if(denominator>0)evaluate(Math.max(low,Math.min(high,-numerator/denominator)));
  }
  const axisPoint=a.clone().addScaledVector(delta,closestTime);
  const point=axisPoint.clone().clamp(half.clone().negate(),half);
  if(distance<1e-12) {
    const axis=['x','y','z'].sort((x,y)=>(half[x]-Math.abs(point[x]))-(half[y]-Math.abs(point[y])))[0];
    point[axis]=(point[axis]>=0?1:-1)*half[axis];
  }
  return {distance,point};
}
function frameContact(frame,target) {
  const radius=Math.max(0,target.radius??.4),minY=target.minY??.12,maxY=target.maxY??1.8;
  const bottom=Math.min(maxY,minY+radius),top=Math.max(bottom,maxY-radius);
  const inverse=new Quaternion().copy(frame.headQuaternion).invert();
  const a=new Vector3(target.x,bottom,target.z).sub(frame.headCenter).applyQuaternion(inverse);
  const b=new Vector3(target.x,top,target.z).sub(frame.headCenter).applyQuaternion(inverse);
  const closest=segmentBoxClosest(a,b,frame.headHalfExtents);
  if(closest.distance>radius*radius+1e-10)return null;
  return {point:closest.point.applyQuaternion(frame.headQuaternion).add(frame.headCenter),frame};
}
export function hammerSweepContact(current,previous,target) {
  if(!validVector(current?.headCenter)||!validVector(current?.headHalfExtents)||!target
    ||![target.x,target.z,target.radius??.4,target.minY??.12,target.maxY??1.8].every(Number.isFinite)
    ||(target.radius??.4)<0||(target.maxY??1.8)<(target.minY??.12)
    ||[current.headHalfExtents.x,current.headHalfExtents.y,current.headHalfExtents.z].some(n=>n<0)
    ||![current.headQuaternion?.x,current.headQuaternion?.y,current.headQuaternion?.z,current.headQuaternion?.w].every(Number.isFinite))return null;
  const from=previous?.headCenter??current.headCenter;
  const dx=current.headCenter.x-from.x,dz=current.headCenter.z-from.z,square=dx*dx+dz*dz;
  const along=square?Math.max(0,Math.min(1,((target.x-from.x)*dx+(target.z-from.z)*dz)/square)):0;
  const envelope=Math.max(current.headHalfExtents.length(),previous?.headHalfExtents?.length()??0)+(target.radius??.4);
  if(Math.hypot(target.x-from.x-dx*along,target.z-from.z-dz*along)>envelope)return null;
  if(!previous?.headCenter)return frameContact(current,target);
  const distance=previous.headCenter.distanceTo(current.headCenter);
  const turn=previous.headQuaternion.angleTo(current.headQuaternion);
  const steps=Math.min(96,Math.max(1,Math.ceil(distance/.035),Math.ceil(turn/.06)));
  for(let i=0;i<=steps;i++) {
    const result=frameContact(interpolateHammerFrame(previous,current,i/steps),target);
    if(result)return result;
  }
  return null;
}
export function hammerSweepContains(current,previous,target) {return !!hammerSweepContact(current,previous,target);}
// The visible pressure rim extends the solid head's strike. Sample the same
// rotating box path, with a bounded envelope rather than a radial body sensor.
export function hammerPressureContact(current,previous,target,padding=0) {
  const solid=hammerSweepContact(current,previous,target);
  if(solid)return {...solid,pressure:false};
  if(!Number.isFinite(padding)||padding<=0||!current?.headHalfExtents)return null;
  const expand=frame=>frame&&({...frame,headHalfExtents:frame.headHalfExtents.clone().addScalar(padding)});
  const contact=hammerSweepContact(expand(current),expand(previous),target);
  return contact?{...contact,pressure:true}:null;
}
export function hammerShockContains(point,target,radius) {
  if(!validVector(point)||!target||![target.x,target.z,target.minY??.12,target.radius??.4,radius].every(Number.isFinite)
    ||radius<=0||(target.radius??.4)<0||(target.minY??.12)>point.y+.48)return false;
  return Math.hypot(target.x-point.x,target.z-point.z)<=radius+(target.radius??.4);
}
export function hammerGroundContact(current,previous,floor=.049) {
  if(!current?.headCorners)return null;
  let contact=null;
  const steps=previous?Math.max(1,Math.min(64,Math.ceil(previous.headCenter.distanceTo(current.headCenter)/.025))):1;
  for(let i=0;i<=steps;i++) {
    const frame=previous?interpolateHammerFrame(previous,current,i/steps):current;
    const low=frame.headCorners.reduce((a,b)=>a.y<b.y?a:b);
    if(low.y>=floor-.008&&low.y<=floor+.016) {contact=low.clone();contact.y=floor+.015;break;}
  }
  return contact;
}
