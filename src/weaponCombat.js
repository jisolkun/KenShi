// Collision uses the same move definition that drives the pose and visual path.
export function weaponStrikeContains(move, dx, dz, angle, radius = 0) {
  const distance = Math.hypot(dx, dz);
  if (distance > move.reach + radius) return false;
  const forwardX = Math.sin(angle), forwardZ = Math.cos(angle);
  const along = dx * forwardX + dz * forwardZ;
  const side = Math.abs(dx * forwardZ - dz * forwardX);
  if (move.shape === 'thrust') return along >= -radius * 0.3 && side <= move.width + radius * 0.7;
  if (move.shape === 'radial') return true;
  const dot = distance < 0.01 ? 1 : along / distance;
  const margin = Math.asin(Math.min(1, radius / Math.max(distance, 0.01)));
  if (dot < Math.cos(Math.min(Math.PI, move.halfAngle + margin))) return false;
  return move.shape !== 'crush' || side <= move.width + radius + 0.32;
}

function segmentDistance(target,a,b) {
  const low=target.minY??.18,high=target.maxY??1.9;
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dz*dz,full=length+dy*dy;
  const horizontal=(target.x-a.x)*dx+(target.z-a.z)*dz;
  const candidates=[0,1,length?horizontal/length:0];
  for(const height of [low,high]){
    if(full)candidates.push((horizontal+(height-a.y)*dy)/full);
    if(Math.abs(dy)>1e-8)candidates.push((height-a.y)/dy);
  }
  let distance=Infinity;
  for(const candidate of candidates){
    const t=Math.max(0,Math.min(1,candidate)),y=a.y+dy*t;
    distance=Math.min(distance,Math.hypot(target.x-a.x-dx*t,target.z-a.z-dz*t,y-Math.max(low,Math.min(high,y))));
  }
  return distance;
}

// Sample the physical blade's swept surface between rendered poses. There is
// no invisible radial damage outside the heel-to-tip trajectory.
export function bladeSweepContains(frame,previous,target,radius,width=.08) {
  const threshold=radius+width;
  if(segmentDistance(target,frame.heel,frame.tip)<=threshold)return true;
  if(!previous)return false;
  const count=Math.max(2,Math.min(16,Math.ceil(previous.tip.distanceTo(frame.tip)/.08)));
  for(let i=0;i<=count;i++){
    const t=i/count;
    const heel={x:previous.heel.x+(frame.heel.x-previous.heel.x)*t,y:previous.heel.y+(frame.heel.y-previous.heel.y)*t,z:previous.heel.z+(frame.heel.z-previous.heel.z)*t};
    const tip={x:previous.tip.x+(frame.tip.x-previous.tip.x)*t,y:previous.tip.y+(frame.tip.y-previous.tip.y)*t,z:previous.tip.z+(frame.tip.z-previous.tip.z)*t};
    if(segmentDistance(target,heel,tip)<=threshold)return true;
  }
  return false;
}

// A point-first attack only sweeps the physical tip. The already extended
// shaft must not turn a narrow stab into a wide cutting hit.
export function bladeThrustContains(frame,previous,target,radius,width=.04) {
  return segmentDistance(target,previous?.tip??frame.tip,frame.tip)<=radius+width;
}
