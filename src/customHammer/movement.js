import {resolveGreatDaoStep,greatDaoTargetGap} from '../greatDaoMovement.js';

// Keep the swept collision resolver, then spend the unblocked component along
// the contact tangent. A spinning step can circle a body without crossing it.
export function resolveHammerStep(start,displacement,options={}) {
  const clearance=options.clearance??.5;
  const circles=[...(options.obstacles??[]).map(o=>({...o,gap:o.radius+clearance})),
    ...(options.targets??[]).map(o=>({...o,gap:greatDaoTargetGap(o.radius)}))];
  let position={x:start.x,z:start.z},remaining={x:displacement.x,z:displacement.z};
  for(let iteration=0;iteration<3;iteration++) {
    if(Math.hypot(remaining.x,remaining.z)<1e-8)break;
    const next=resolveGreatDaoStep(position,remaining,options);
    remaining={x:remaining.x-(next.x-position.x),z:remaining.z-(next.z-position.z)};
    position=next;
    for(const circle of circles) {
      const x=position.x-circle.x,z=position.z-circle.z,distance=Math.hypot(x,z);
      if(distance>circle.gap+.012||distance<1e-8)continue;
      const nx=x/distance,nz=z/distance,inward=remaining.x*nx+remaining.z*nz;
      if(inward<0) {remaining.x-=nx*inward;remaining.z-=nz*inward;}
    }
    if(options.bounds) {
      const b=options.bounds;
      if(position.x<=b.minX+clearance+.001)remaining.x=Math.max(0,remaining.x);
      if(position.x>=b.maxX-clearance-.001)remaining.x=Math.min(0,remaining.x);
      if(position.z<=b.minZ+clearance+.001)remaining.z=Math.max(0,remaining.z);
      if(position.z>=b.maxZ-clearance-.001)remaining.z=Math.min(0,remaining.z);
    }
  }
  return position;
}
