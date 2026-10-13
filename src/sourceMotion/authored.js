import * as THREE from 'three';

// The source has no hammer clips. Keep its pelvis/leg curves and five clocks,
// but drive a weighted two-handed shaft through continuous, broad attacks.
const scale=.9, support=.249/scale;
const down=new THREE.Vector3(0,-1,0), foreAxis=new THREE.Vector3(0,-.35,.015).normalize();
const carries=[
 [.18,.25,.41,1.25,-.12],[-.16,.28,.43,-1.70,.10],
 [.13,.22,.46,.45,-.40],[.10,.43,.34,2.15,.66],
 [-.03,.51,.34,-1.18,.34],[.18,.25,.41,1.25,-.12],
].map(row=>[...row,0,0,0]);
const loads=[
 [.22,.42,.34,2.70,.25,.22,-.06,-.08],
 [-.07,.64,.26,-1.35,1.43,-.14,-.16,-.10],
 [-.20,.22,.33,-2.55,-.08,-.25,.08,.08],
 [.10,.64,.23,.95,1.46,.18,-.16,.08],
 [.17,.42,.29,-2.93,.22,.28,-.07,-.10],
];
const contacts=[
 [.04,.30,.52,.05,-.03,-.18,.10,.08],
 [.09,.41,.46,.22,-.66,.12,-.12,.07],
 [.02,.36,.47,.03,.36,.18,-.10,-.08],
 [-.01,.46,.49,-.12,-.88,-.16,.24,-.10],
 [.00,.30,.51,-.13,.02,-.24,.12,.12],
];
const followThrough=[
 [-.17,.28,.39,-1.92,.08,-.24,.03,.06],
 [.05,.48,.42,.70,-.30,.18,-.08,.06],
 [.18,.43,.29,2.15,.66,.22,-.16,-.10],
 [-.19,.47,.36,-.62,-.56,-.25,.18,-.12],
 [-.19,.31,.37,2.70,.12,-.35,.04,.10],
];
const rebounds=[
 [-.10,.32,.39,-1.96,.17,-.12,-.02,.03],
 [.08,.51,.35,1.15,.35,.08,-.02,0],
 [.09,.42,.35,1.92,.71,.08,-.10,-.03],
 [-.03,.51,.34,-1.18,.34,-.12,-.03,0],
 [-.06,.36,.36,2.46,.22,-.13,-.02,.03],
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
function writeArm(frame,index,shoulder,target,chestQ,weaponQ) {
 const vector=target.clone().sub(shoulder),length=THREE.MathUtils.clamp(vector.length(),.025,.7399);
 const axis=vector.normalize();
 const pole=new THREE.Vector3(index===0?-.7:.7,-.05,.5).applyQuaternion(chestQ);
 pole.addScaledVector(axis,-pole.dot(axis)).normalize();
 const along=(.39**2+length**2-.35**2)/(2*length);
 const elbow=axis.clone().multiplyScalar(along).addScaledVector(pole,Math.sqrt(Math.max(0,.39**2-along**2)));
 const upperQ=new THREE.Quaternion().setFromUnitVectors(down,elbow.clone().normalize());
 const fore=target.clone().sub(shoulder).sub(elbow).normalize();
 const foreQ=new THREE.Quaternion().setFromUnitVectors(foreAxis,fore);
 const bone=index===0?3:6;
 upperQ.toArray(frame,3+bone*4);foreQ.toArray(frame,3+(bone+1)*4);weaponQ.toArray(frame,3+(bone+2)*4);
}
function headMinimum(primary,q) {
 const axis=new THREE.Vector3(0,1,0).applyQuaternion(q);
 const x=new THREE.Vector3(1,0,0).applyQuaternion(q),z=new THREE.Vector3(0,0,1).applyQuaternion(q);
 return primary.y*scale+axis.y*1.221-Math.abs(x.y)*.27-Math.abs(axis.y)*.19-Math.abs(z.y)*.19;
}
function constrainGrip(primary,axis,shoulders,minimumY=-Infinity) {
 for(let pass=0;pass<20;pass++) {
  let corrected=false;
  for(let side=0;side<2;side++) {
   const hand=primary.clone().addScaledVector(axis,side===0?-support:0);
   const delta=hand.sub(shoulders[side]),distance=delta.length();
   if(distance>.73){
    if(Number.isFinite(minimumY)&&primary.y-delta.y+delta.y*.73/distance<minimumY) {
     primary.y=minimumY;
     const center=shoulders[side].clone().addScaledVector(axis,side===0?support:0);
     const radius=Math.sqrt(Math.max(.00001,.73**2-(primary.y-center.y)**2));
     const horizontal=new THREE.Vector3(primary.x-center.x,0,primary.z-center.z),length=horizontal.length();
     if(length>radius)primary.addScaledVector(horizontal,-(length-radius)/length);
    } else primary.addScaledVector(delta,-(distance-.73)/distance);
    corrected=true;
   }
  }
  if(!corrected)break;
 }
}
export function sampleSourceStyledWeapon(weaponId,combo,profile,phase,sampled) {
 if(weaponId!=='great-hammer')return sampled;
 const frame=Float64Array.from(sampled.frame),attachments=Float64Array.from(sampled.attachments);
 const index=((combo%5)+5)%5,row=profile.loop?null:poseAt(index,profile,phase);
 const hips=new THREE.Vector3().fromArray(frame),chestQ=new THREE.Quaternion().fromArray(frame,7).normalize();
 if(row) {
  // Waist/shoulder accents follow the continuous shaft trajectory. Native
  // pelvis, stepping legs, head rotations and clocks remain untouched.
  chestQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(row[6],row[5],row[7],'YXZ'))).normalize();
  chestQ.toArray(frame,7);
 }
 const shoulders=[67,70].map(offset=>new THREE.Vector3().fromArray(frame,offset).applyQuaternion(chestQ).add(hips));
 let primary;
 if(profile.loop) {
  const upper=new THREE.Quaternion().fromArray(frame,27),fore=new THREE.Quaternion().fromArray(frame,31);
  primary=shoulders[1].clone().add(new THREE.Vector3(0,-.39,0).applyQuaternion(upper))
   .add(new THREE.Vector3(0,-.35,.015).applyQuaternion(fore));
 } else primary=new THREE.Vector3(...row.slice(0,3)).add(hips);
 const weaponQ=row?quaternion(row):new THREE.Quaternion().fromArray(frame,63).normalize(),axis=new THREE.Vector3(0,1,0).applyQuaternion(weaponQ);
 // A differentiable clearance envelope raises the paired grip instead of
 // abruptly changing shaft angle at floor contact. The authored low point
 // and continuing follow-through provide the actual rebound.
 const gap=row?(.028-headMinimum(primary,weaponQ))/scale:0;
 const minimumY=row?primary.y+gap:-Infinity;
 if(row)primary.y+=.5*(gap+Math.sqrt(gap*gap+.028**2));
 constrainGrip(primary,axis,shoulders,minimumY);
 const secondary=primary.clone().addScaledVector(axis,-support);
 writeArm(frame,0,shoulders[0],secondary,chestQ,weaponQ);
 writeArm(frame,1,shoulders[1],primary,chestQ,weaponQ);
 weaponQ.toArray(frame,63);attachments.fill(0,0,3);
 return {...sampled,frame,attachments,authored:true};
}
