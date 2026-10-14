import * as THREE from 'three';

// The source has no hammer clips. Keep its pelvis/leg curves and five clocks,
// but drive a weighted two-handed shaft through continuous, broad attacks.
const scale=.9, support=.249/scale, armReach=.69;
const down=new THREE.Vector3(0,-1,0), foreAxis=new THREE.Vector3(0,-.35,.015).normalize();
// A hammer grip is authored as a centre point plus a shaft direction.  These
// five carries are deliberately different: the first exits to the left, the
// second loads over the right shoulder, the third rises through the centre,
// the fourth drops from a true overhead chamber, and the fifth finishes in a
// wide returning circle.  The last carry is exactly the first one so a queued
// sixth clock can never teleport at the combo boundary.
const carries=[
 [.05,.55,.70, .72,-.24],
 [-.28,.57,.66,-1.68,.14],
 [.16,.49,.58,.30,.15],
 [-.10,.76,.57,1.74,.82],
 [.30,.55,.70,-2.34,-.22],
 [.05,.55,.70, .72,-.24],
].map(row=>[...row,0,0,0]);
const loads=[
 [-.26,.76,.66,2.18,.18,-.04,.14,-.05],
 [.34,.80,.55,-1.02,1.40,.05,.12,.08],
 [-1.20,.38,.74,-2.85,-.62,-.08,-.08,.06],
 [.18,.94,.58,1.14,1.42,.02,.20,-.03],
 [.42,.69,.58,-2.86,.10,.10,.04,.09],
];
const contacts=[
 [.03,.55,.93,.08,-.04,.08,-.12,.05],
 [.02,.52,.62,-.10,-.76,-.10,.02,-.06],
 [.75,.50,.98,.68,.56,.12,.10,.08],
 [.00,.65,.60,-.16,-1.18,-.03,-.18,-.04],
 [.02,.53,.89,-.38,-.16,.14,-.08,.10],
];
const followThrough=[
 [.38,.62,.62,-1.56,.06,.03,-.16,.04],
 [.14,.68,.72,.78,.20,-.06,.11,-.08],
 [-.62,.61,.82,2.20,.52,.05,.12,-.10],
 [-.22,.78,.70,-.70,-.25,-.05,-.20,.05],
 [-.37,.58,.68,2.38,.06,.11,-.10,.09],
];
const rebounds=[
 [.25,.60,.68,-1.90,.12,.02,-.08,.02],
 [.05,.65,.58,1.38,.36,-.04,.08,-.02],
 [.22,.66,.68,2.10,.62,.05,.05,-.06],
 [.25,.58,.68,-2.15,-.10,-.03,-.10,.02],
 [-.18,.60,.66,2.58,.17,.08,-.07,.04],
];

// Shape-preserving Hermite tangents carry momentum through the contact key.
// Only an actual reversal stops that coordinate; intermediate poses no
// longer reset every shaft coordinate to zero velocity as smoothstep did.
function tangent(keys,index,component) {
 if(index===0||index===keys.length-1)return 0;
 const a=keys[index-1],b=keys[index],c=keys[index+1];
 const h0=b[0]-a[0],h1=c[0]-b[0];
 const d0=(b[1][component]-a[1][component])/h0,d1=(c[1][component]-b[1][component])/h1;
 if(d0*d1<=0)return 0;
 const w0=2*h1+h0,w1=h1+2*h0;
 return (w0+w1)/(w0/d0+w1/d1);
}
function samplePath(keys,phase) {
 let end=1;
 while(end<keys.length-1&&phase>keys[end][0])end++;
 const a=keys[end-1],b=keys[end],h=b[0]-a[0];
 const u=THREE.MathUtils.clamp((phase-a[0])/h,0,1),u2=u*u,u3=u2*u;
 return a[1].map((value,component)=>(2*u3-3*u2+1)*value
  +(u3-2*u2+u)*h*tangent(keys,end-1,component)
  +(-2*u3+3*u2)*b[1][component]
  +(u3-u2)*h*tangent(keys,end,component));
}
const quaternion=row=>{
 const az=row[3],tilt=row[4];
 const x=new THREE.Vector3(Math.cos(az),0,-Math.sin(az));
 const y=new THREE.Vector3(Math.sin(az)*Math.cos(tilt),Math.sin(tilt),Math.cos(az)*Math.cos(tilt));
 return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,new THREE.Vector3().crossVectors(x,y)));
};
function poseAt(index,profile,phase) {
 const attackEnd=profile.clipBoundaries?.[0]?.phase??1;
 const attackSeconds=profile.attackRaw/.26;
 // Contact lies inside the unchanged native active atlas frames. The lower
 // arc continues beyond contact, then rebounds without a planted hold.
 const contact=THREE.MathUtils.clamp((profile.hitDelay-.02+.075)/attackSeconds,.20,.84)*attackEnd;
 const wind=Math.max(.025,contact-attackEnd*(index===0?.29:.33));
 const follow=Math.min(attackEnd*.88,contact+attackEnd*.13);
 const rebound=Math.min(attackEnd*.96,follow+attackEnd*.10);
 const keys=[[0,carries[index]],[wind,loads[index]],[contact,contacts[index]],
  [follow,followThrough[index]],[rebound,rebounds[index]],[attackEnd,carries[index+1]]];
 if(attackEnd<1) {
  const settling=carries[index+1].map((value,i)=>value+[.015,.025,-.025,.10,.08,.04,-.02,0][i]);
  keys.push([attackEnd+(1-attackEnd)*.48,settling],[1,carries[index+1]]);
 }
 return samplePath(keys,phase);
}
function torsoScore(point,hips,chestQ) {
 const local=point.clone().sub(hips).applyQuaternion(chestQ.clone().invert());
 const dx=local.x/.34,dy=(local.y-.30)/.42,dz=local.z/.225;
 return dx*dx+dy*dy+dz*dz;
}
function applyHammerChestAccent(frame,index,profile,phase,row){
 const end=profile.clipBoundaries?.[0]?.phase??1;if(phase>end)return;
 const u=THREE.MathUtils.clamp(phase/end,0,1),weight=Math.sin(Math.PI*u);
 const yaw=[.12,-.14,.17,-.11,.19][index]*weight;
 const pitch=[.02,.05,-.03,.10,.01][index]*weight;
 const roll=[.03,-.02,.05,.02,-.04][index]*weight;
 const chest=new THREE.Quaternion().fromArray(frame,7).normalize();
 chest.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,roll,'YXZ'))).normalize();
 if(row){
  const swing=new THREE.Vector3(row[0],row[1]-.36,row[2]).normalize();
  const local=swing.applyQuaternion(chest.clone().invert());
  const activation=THREE.MathUtils.clamp((.36-local.z)/.34,0,1);
  if(activation>0){
   const smooth=activation*activation*(3-2*activation);
   const theta=THREE.MathUtils.clamp(Math.atan2(local.x,local.z),-.20,.20)*smooth;
   chest.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,theta,0,'YXZ'))).normalize();
  }
 }
 chest.toArray(frame,7);
}
function segmentTorsoClearance(a,b,hips,chestQ){
 const inverse=chestQ.clone().invert();let minimum=Infinity;
 // Sample the actual arm centreline against a padded chest capsule. The
 // rendered forearm has radius, so the proxy is deliberately wider than the
 // visual rib mesh and leaves a margin before a pole is accepted.
 for(let n=1;n<=8;n++){
  const point=a.clone().lerp(b,n/8).sub(hips).applyQuaternion(inverse);
  const score=(point.x/.38)**2+((point.y-.32)/.52)**2+(point.z/.30)**2;
  minimum=Math.min(minimum,score);
 }
 return minimum;
}
function writeArm(frame,index,shoulder,target,chestQ,weaponQ,hips,maxReach=armReach) {
 const vector=target.clone().sub(shoulder),length=THREE.MathUtils.clamp(vector.length(),.025,maxReach);
 const axis=vector.normalize();
 const side=index===0?-1:1;
 const candidates=[-.05,.22].flatMap(y=>[.48,.82,1.18].flatMap(z=>[
  new THREE.Vector3(side*.7,y,z),new THREE.Vector3(side*1.35,y,z*.72)]));
 let elbow,best=-Infinity;
 for(const localPole of candidates) {
  const pole=localPole.applyQuaternion(chestQ);
  pole.addScaledVector(axis,-pole.dot(axis));
  if(pole.lengthSq()<1e-8)continue;
  pole.normalize();
  const along=(.39**2+length**2-.35**2)/(2*length);
  const candidate=axis.clone().multiplyScalar(along)
   .addScaledVector(pole,Math.sqrt(Math.max(0,.39**2-along**2))).add(shoulder);
  const localElbow=candidate.clone().sub(hips).applyQuaternion(chestQ.clone().invert());
  const sideClear=torsoScore(candidate,hips,chestQ), handSide=(index===0?-1:1)*localElbow.x;
  // Keep the elbow on its anatomical side and slightly in front of the
  // torso. A mathematically valid elbow on the centreline is the source of
  // the old forearm-through-abdomen silhouette.
  const upperClear=segmentTorsoClearance(shoulder,candidate,hips,chestQ),foreClear=segmentTorsoClearance(candidate,target,hips,chestQ);
  const strict=handSide>=.20&&localElbow.z>=.20&&upperClear>=1.02&&foreClear>=1.02;
  const score=(strict?1000:0)+Math.min(upperClear,foreClear)*12+sideClear+Math.max(0,handSide)*1.1+Math.max(0,localElbow.z)*.8;
  if(score>best){best=score;elbow=candidate;}
 }
 // Fallback is unreachable for normal source poses, but keeps malformed input finite.
 if(!elbow)elbow=shoulder.clone().add(axis.clone().multiplyScalar((.39**2+length**2-.35**2)/(2*length)));
 const elbowOffset=elbow.clone().sub(shoulder);
 const upperQ=new THREE.Quaternion().setFromUnitVectors(down,elbowOffset.clone().normalize());
 const fore=target.clone().sub(elbow).normalize();
 const foreQ=new THREE.Quaternion().setFromUnitVectors(foreAxis,fore);
 const bone=index===0?3:6;
 upperQ.toArray(frame,3+bone*4);foreQ.toArray(frame,3+(bone+1)*4);weaponQ.toArray(frame,3+(bone+2)*4);
}
function headMinimum(primary,q) {
 const axis=new THREE.Vector3(0,1,0).applyQuaternion(q);
 const x=new THREE.Vector3(1,0,0).applyQuaternion(q),z=new THREE.Vector3(0,0,1).applyQuaternion(q);
 return primary.y*scale+axis.y*1.221-Math.abs(x.y)*.27-Math.abs(axis.y)*.19-Math.abs(z.y)*.19;
}
function constrainGrip(primary,axis,shoulders,minimumY=-Infinity,maxReach=armReach) {
 for(let pass=0;pass<20;pass++) {
  let corrected=false;
  for(let side=0;side<2;side++) {
   const hand=primary.clone().addScaledVector(axis,side===0?-support:0);
   const delta=hand.sub(shoulders[side]),distance=delta.length();
   if(distance<.072) {
    const push=delta.lengthSq()>.000001?delta.normalize():new THREE.Vector3(side===0?-.7:.7,0,.7);
    primary.addScaledVector(push,.072-distance);
    corrected=true;
   } else if(distance>maxReach){
    if(Number.isFinite(minimumY)&&primary.y-delta.y+delta.y*maxReach/distance<minimumY) {
     primary.y=minimumY;
     const center=shoulders[side].clone().addScaledVector(axis,side===0?support:0);
     const radius=Math.sqrt(Math.max(.00001,maxReach**2-(primary.y-center.y)**2));
     const horizontal=new THREE.Vector3(primary.x-center.x,0,primary.z-center.z),length=horizontal.length();
     if(length>radius)primary.addScaledVector(horizontal,-(length-radius)/length);
    } else primary.addScaledVector(delta,-(distance-maxReach)/distance);
    corrected=true;
   }
  }
  if(!corrected)break;
 }
}
function constrainTorsoEnvelope(primary,axis,hips,chestQ,strength=1) {
 const inverse=chestQ.clone().invert(),center=new THREE.Vector3(0,.30,0);
 const radii=new THREE.Vector3(.34,.42,.225), targetScore=1.16;
 let bestCorrection=null,bestWeight=0;
 for(const offset of [0,-support]) {
  const world=primary.clone().addScaledVector(axis,offset);
  const local=world.clone().sub(hips).applyQuaternion(inverse).sub(center);
  const normalized=new THREE.Vector3(local.x/radii.x,local.y/radii.y,local.z/radii.z);
  const radius=Math.max(normalized.length(),1e-4),u=THREE.MathUtils.clamp((1.25-radius)/.25,0,1);
  // Start the lift before contact with the envelope and ease it to a
  // predictable 16% margin. This keeps the wrist outside the torso without
  // introducing a derivative jump at the old hard projection boundary.
  const smooth=u*u*(3-2*u),desiredRadius=1+.16*smooth;
  if(radius>=desiredRadius)continue;
  const scale=desiredRadius/radius;
  const desired=center.clone().add(new THREE.Vector3(local.x*scale,local.y*scale,local.z*scale));
  const localCorrection=desired.sub(world.clone().sub(hips).applyQuaternion(inverse));
  const weight=desiredRadius-radius;
  if(weight>bestWeight){bestWeight=weight;bestCorrection=localCorrection.applyQuaternion(chestQ);}
 }
 if(bestCorrection)primary.addScaledVector(bestCorrection,.92*strength);
}
export function sampleSourceStyledWeapon(weaponId,combo,profile,phase,sampled) {
 if(weaponId!=='great-hammer')return sampled;
 const frame=Float64Array.from(sampled.frame),attachments=Float64Array.from(sampled.attachments);
 // The native catalogue clamps out-of-range requests to the first/last
 // source clip. Use the profile's baked combo id when present so the authored
 // hammer keys stay on the same five-clock selection (negative replay values
 // must not wrap to the fifth pose while the clock is playing attack1).
 const requested=Number.isFinite(combo)?Math.floor(combo):0;
 const index=Number.isInteger(profile.combo)
   ? profile.combo : Math.max(0,Math.min(4,requested));
 const row=profile.loop?null:poseAt(index,profile,phase);
 if(!profile.loop)applyHammerChestAccent(frame,index,profile,phase,row);
 const attackEnd=profile.clipBoundaries?.[0]?.phase??1;
 const hips=new THREE.Vector3().fromArray(frame),chestQ=new THREE.Quaternion().fromArray(frame,7).normalize();
 // Keep the native source torso orientation.  The shaft is solved against
 // this joint frame below; rotating the chest again from the hammer track
 // makes the shoulder parent disagree with the source spine and is the
 // deformation that used to pull the arms through the body.
 const shoulders=[67,70].map(offset=>new THREE.Vector3().fromArray(frame,offset).applyQuaternion(chestQ).add(hips));
 let primary;
 if(profile.loop) {
  const upper=new THREE.Quaternion().fromArray(frame,27),fore=new THREE.Quaternion().fromArray(frame,31);
  primary=shoulders[1].clone().add(new THREE.Vector3(0,-.39,0).applyQuaternion(upper))
   .add(new THREE.Vector3(0,-.35,.015).applyQuaternion(fore));
 } else {
  // Attack keys stay in the source character frame.  The shoulders below
  // use the same pelvis/chest frame, while the two-bone solve absorbs the
  // torso turn without warping the authored swing path.
  primary=new THREE.Vector3(...row.slice(0,3)).add(hips);
 }
 const weaponQ=row?quaternion(row):new THREE.Quaternion().fromArray(frame,63).normalize(),axis=new THREE.Vector3(0,1,0).applyQuaternion(weaponQ);
 // A differentiable clearance envelope raises the paired grip instead of
 // abruptly changing shaft angle at floor contact. The authored low point
 // and continuing follow-through provide the actual rebound.
 const gap=row?(.028-headMinimum(primary,weaponQ))/scale:0;
 const minimumY=row?primary.y+gap:-Infinity;
 if(row)primary.y+=.5*(gap+Math.sqrt(gap*gap+.028**2));
 // The fourth (overhead) clock already clears the torso on its native
 // vertical plane. Leaving that plane untouched preserves its smooth release
 // velocity; the other four paths use the soft envelope guard above.
 const torsoStart=THREE.MathUtils.clamp(phase/.08,0,1);
 // Keep the carry endpoint exact for combo chaining, then resume the guard
 // through recovery and ease it out again only at the final frame.
 const torsoEnd=phase<=attackEnd
  ? THREE.MathUtils.clamp((attackEnd-phase)/.08,0,1)
  : THREE.MathUtils.clamp((1-phase)/.08,0,1);
 const torsoBlend=(torsoStart*torsoStart*(3-2*torsoStart))*(torsoEnd*torsoEnd*(3-2*torsoEnd));
 if(index!==3&&torsoBlend>0)constrainTorsoEnvelope(primary,axis,hips,chestQ,torsoBlend);
 if(index===3){
  const guardIn=THREE.MathUtils.clamp(phase/.10,0,1),guardOut=THREE.MathUtils.clamp((.42-phase)/.10,0,1);
  const guard=(guardIn*guardIn*(3-2*guardIn))*(guardOut*guardOut*(3-2*guardOut));
  if(guard>0)constrainTorsoEnvelope(primary,axis,hips,chestQ,.72*guard);
 }
 const reach=.74;
 constrainGrip(primary,axis,shoulders,minimumY,reach);
 const secondary=primary.clone().addScaledVector(axis,-support);
 writeArm(frame,0,shoulders[0],secondary,chestQ,weaponQ,hips,reach);
 writeArm(frame,1,shoulders[1],primary,chestQ,weaponQ,hips,reach);
 weaponQ.toArray(frame,63);attachments.fill(0,0,3);
 return {...sampled,frame,attachments,authored:true};
}
