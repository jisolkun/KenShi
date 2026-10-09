import * as THREE from 'three';
const v=a=>new THREE.Vector3(...a);
export function bladeOrientation(axis,edge=[1,0,0]) {
 const y=v(axis).normalize().negate(),x=v(edge).addScaledVector(y,-v(edge).dot(y)).normalize(),z=new THREE.Vector3().crossVectors(x,y).normalize();
 return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}
const orientation=bladeOrientation;
const caches=new Map();
// One front plane includes armour, straps and palm radius. Intersecting convex
// half-spaces and reach spheres keeps the shaft continuous at high carries;
// height-dependent clearance envelopes can abruptly switch projection branches.
const palmFront=.35;
export function constrainPairedGrip(primary,axis,spec){
 const right=v([.29,.365,spec.shoulderForward??0]),left=v([-.29,.365,spec.shoulderForward??0]);
 const separation=axis.clone().multiplyScalar(-spec.supportDistance),reach=spec.armReach??.545;
 for(let n=0;n<(spec.handClearance?32:8);n++){
  const r=primary.clone().sub(right);if(r.length()>reach)primary.copy(right).add(r.setLength(reach));
  const l=primary.clone().add(separation).sub(left);if(l.length()>reach)primary.copy(left).add(l.setLength(reach)).sub(separation);
  if(spec.handClearance)for(const offset of [.029,.029-spec.supportDistance]){
   const palm=primary.clone().addScaledVector(axis,offset);
   if(palm.z<palmFront)primary.z+=palmFront-palm.z;
  }
 }
 return primary;
}
export function constrainSingleGrip(primary,axis,side,spec){
 const shoulder=v([side*.29,.365,spec.shoulderForward??0]),reach=spec.armReach??.525;
 // A single saber needs its own reachable palm volume. Keep the empty hand
 // independent; it balances the cut rather than sharing a shaft with it.
 const front=(spec.palmFront??palmFront)-axis.z*.029;
 for(let n=0;n<32;n++){
  const offset=primary.clone().sub(shoulder);
  if(offset.length()>reach)primary.copy(shoulder).add(offset.setLength(reach));
  primary.z=Math.max(primary.z,front);
 }
 return primary;
}
function interpolate(keys,p,field) {
 let i=0;while(i<keys.length-2&&p>keys[i+1].p)i++;
 const a=keys[i],b=keys[i+1],dt=b.p-a.p,t=THREE.MathUtils.clamp((p-a.p)/dt,0,1);
 const av=a[field],bv=b[field];
 const tangent=j=>{
  if(j===0||j===keys.length-1||keys[j].stop)return av.map(()=>0);
  const before=keys[j-1],after=keys[j+1];
  return after[field].map((x,k)=>(x-before[field][k])/(after.p-before.p));
 };
 const ma=tangent(i),mb=tangent(i+1);
 return av.map((x,k)=>(2*t*t*t-3*t*t+1)*x+(t*t*t-2*t*t+t)*dt*ma[k]+(-2*t*t*t+3*t*t)*bv[k]+(t*t*t-t*t)*dt*mb[k]);
}
function raw(spec,tracks,p) {
 p=THREE.MathUtils.clamp(p,0,1);
 const [yaw,load]=interpolate(tracks.torso,p,'values');
 const stance={yaw,load,advance:spec.advance*Math.sin(Math.PI*p),...(spec.bodyHeight?{bodyHeight:spec.bodyHeight}:{})};
 if(tracks.body){
  const [pelvisYaw,chestYaw,pitch,shiftX,shiftZ,height]=interpolate(tracks.body,p,'values');
  Object.assign(stance,{pelvisYaw,chestYaw,pitch,shiftX,advance:shiftZ,bodyHeight:height});
 }
 if(tracks.feet){
  stance.feet=tracks.feet(p);
  const pelvis=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),stance.pelvisYaw??yaw*.65);
  for(let i=0;i<2;i++){
   const hip=v([i?.155:-.155,-.035,0]).applyQuaternion(pelvis);
   const foot=stance.feet[i],dx=hip.x+(stance.shiftX??-yaw*.07)-foot.x,dz=hip.z+stance.advance-foot.z;
   const ceiling=foot.y+.035+Math.sqrt(Math.max(.10,.795*.795-dx*dx-dz*dz));
   stance.bodyHeight=Math.min(stance.bodyHeight??.875,ceiling);
  }
 }
 const transform=authoredChestTransform(stance);
 const inverse=transform.q.clone().invert();
 const hands=tracks.tracks.map((track,i)=>{const shoulder=v([i?.29:-.29,.365,spec.shoulderForward??0]);const grip=v(interpolate(track,p,'grip'));if(spec.rootFrame)grip.add(v([0,1.025,0])).sub(transform.position).applyQuaternion(inverse);const offset=grip.sub(shoulder);const length=offset.length();if(length>.51)offset.setLength(.548-.038*Math.exp(-(length-.51)/.038));return {grip:offset.add(shoulder).toArray(),axis:(spec.rootFrame&&track[0].angles?(()=>{const [azimuth,rawTilt]=interpolate(track,p,'angles'),tilt=Math.max(-.54,rawTilt);return v([Math.sin(azimuth)*Math.cos(tilt),Math.sin(tilt),Math.cos(azimuth)*Math.cos(tilt)]);})():v(interpolate(track,p,'axis')).normalize()).applyQuaternion(spec.rootFrame?inverse:new THREE.Quaternion())};});
 for(const lane of spec.pointLanes??[]){
  const t=THREE.MathUtils.clamp((Math.abs(p-lane.phase)-lane.inner)/(lane.outer-lane.inner),0,1),weight=1-t*t*(3-2*t),h=hands[lane.hand];
  h.grip[0]=THREE.MathUtils.lerp(h.grip[0],lane.x,weight);
  h.grip[1]=THREE.MathUtils.lerp(h.grip[1],lane.y,weight);
  h.axis.lerp(v(lane.axis),weight).normalize();
 }
 if(spec.singleHandClearance)hands.forEach((h,i)=>{
  h.grip=constrainSingleGrip(v(h.grip),h.axis,i?1:-1,spec).toArray();
 });
 if(spec.supportDistance){
  // Constrain the shaft's primary grip to the intersection of both arm
  // spheres. Derive the support only after this projection; independent
  // clamping would separate the two hands from the physical hilt.
  const h=hands[1],primary=constrainPairedGrip(v(h.grip),h.axis,spec);
  const separation=h.axis.clone().multiplyScalar(-spec.supportDistance);
  h.grip=primary.toArray();hands[0]={grip:primary.clone().add(separation).toArray(),axis:h.axis.clone()};
 }
 return {hands,stance};
}
export function authoredChestTransform(stance) {
 const {yaw,load,advance}=stance;
 const body=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,stance.pelvisYaw??yaw*.65,0));
 const chest=new THREE.Quaternion().setFromEuler(new THREE.Euler(stance.pitch??(-.055-load*.035),stance.chestYaw??yaw*.35,0));
 return {q:body.clone().multiply(chest),position:v([0,.15,0]).applyQuaternion(body).add(v([stance.shiftX??-yaw*.07,(stance.bodyHeight??.875)-load*.055,advance]))};
}
function midWorld(r,i,spec) {
 const transform=authoredChestTransform(r.stance);
 return v(r.hands[i].grip).addScaledVector(r.hands[i].axis,spec.midLength??.549).applyQuaternion(transform.q).add(transform.position);
}
function build(spec,tracks) {
 const rolls=[[],[]],bases=[[],[]],N=2000;
 // Parallel transport the reference edge with the changing blade axis. This
 // avoids choosing a new global-X frame near a vertical blade each frame.
 for(let i=0;i<2;i++){
  let previousAxis=raw(spec,tracks,0).hands[i].axis;
  let q=new THREE.Quaternion().fromArray(spec.initialHands[i].quaternion);
  for(let n=0;n<=N;n++){
   const axis=raw(spec,tracks,n/N).hands[i].axis;
   q=new THREE.Quaternion().setFromUnitVectors(previousAxis,axis).multiply(q);
   bases[i].push(q.clone());previousAxis=axis;
  }
 }
 const angleAt=(p,i)=>{
  const r=raw(spec,tracks,p),before=raw(spec,tracks,p-.0002),after=raw(spec,tracks,p+.0002),transform=authoredChestTransform(r.stance);
  const axis=r.hands[i].axis,base=bases[i][Math.round(p*N)];
  const velocity=midWorld(after,i,spec).sub(midWorld(before,i,spec)).applyQuaternion(transform.q.clone().invert());
  velocity.addScaledVector(axis,-velocity.dot(axis));
  return Math.atan2(velocity.dot(v([0,0,1]).applyQuaternion(base)),velocity.dot(v([1,0,0]).applyQuaternion(base)));
 };
 for(let i=0;i<2;i++){
  const anchors=[{p:0,values:[0]}];let previous=0;
  for(const c of spec.contacts.filter(c=>c.hand===i&&c.kind!=='thrust')){
   for(const p of [c.edgeWindow?c.start:c.phase-.045,c.edgeWindow?c.end:c.phase+.045]){
    let angle=angleAt(p,i);while(angle-previous>Math.PI)angle-=Math.PI*2;while(angle-previous<-Math.PI)angle+=Math.PI*2;
    anchors.push({p,values:[angle]});previous=angle;
   }
  }
  // Recover the original low blade orientation by the shortest final roll.
  const last=bases[i][N],target=new THREE.Quaternion().fromArray((spec.finalHands??spec.initialHands)[i].quaternion);
  const edge=v([1,0,0]).applyQuaternion(target);let final=Math.atan2(edge.dot(v([0,0,1]).applyQuaternion(last)),edge.dot(v([1,0,0]).applyQuaternion(last)));
  while(final-previous>Math.PI)final-=Math.PI*2;while(final-previous<-Math.PI)final+=Math.PI*2;
  anchors.push({p:1,values:[final]});
  for(let n=0;n<=N;n++){
   const p=n/N,contact=spec.contacts.find(c=>c.hand===i&&c.kind!=='thrust'&&p>=(c.edgeWindow?c.start:c.phase-.045)&&p<=(c.edgeWindow?c.end:c.phase+.045));
   let angle=interpolate(anchors,p,'values')[0];
   if(contact){let desired=angleAt(p,i);while(desired-angle>Math.PI)desired-=Math.PI*2;while(desired-angle<-Math.PI)desired+=Math.PI*2;angle=desired;}
   rolls[i].push(angle);
  }
 }
 return {tracks,rolls,bases,N};
}
export function sampleAuthoredTracks(spec,tracks,phase) {
 const key=spec.cacheKey;let cache=caches.get(key);if(!cache){cache=build(spec,tracks);caches.set(key,cache);}
 const p=THREE.MathUtils.clamp(phase,0,1),r=raw(spec,cache.tracks,p),index=Math.min(cache.N-1,Math.floor(p*cache.N)),fraction=p*cache.N-index;
 const hands=r.hands.map((h,i)=>{
  const angle=THREE.MathUtils.lerp(cache.rolls[i][index],cache.rolls[i][index+1],fraction);
  const q=cache.bases[i][index].clone().slerp(cache.bases[i][index+1],fraction).multiply(new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),-angle));
  const tip=v(h.grip).add(spec.tipOffset?v(spec.tipOffset).applyQuaternion(q):h.axis.clone().multiplyScalar(spec.tipLength??.949));
  return {grip:h.grip,quaternion:q.toArray(),tip:tip.toArray()};
 });
 if(spec.supportDistance){
  // Use the final interpolated shaft quaternion, including its roll, so
  // support remains exactly on the rendered marker between cache samples.
  const axis=v([0,-1,0]).applyQuaternion(new THREE.Quaternion().fromArray(hands[1].quaternion));
  hands[0]={...hands[0],grip:v(hands[1].grip).addScaledVector(axis,-spec.supportDistance).toArray(),quaternion:[...hands[1].quaternion]};
 }
 return {hands,stance:r.stance,contacts:spec.contacts,name:spec.name};
}
