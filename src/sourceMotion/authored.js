import * as THREE from 'three';

// New hammer choreography uses the source's complete pelvis/legs/spine curves
// and its native five attack clocks. These shaft paths are authored for a
// hammer rather than treating its short weighted head as a spear point.
const scale=.9, support=.249/scale;
const down=new THREE.Vector3(0,-1,0), foreAxis=new THREE.Vector3(0,-.35,.015).normalize();
const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const carries=[
 [.17,.18,.46,1.05,-.28],[-.13,.27,.47,-1.65,-.10],
 [.08,.16,.49,.30,-.48],[.12,.46,.43,.65,.92],
 [.04,.19,.50,.12,-.48],[.17,.18,.46,1.05,-.28],
];
const loads=[
 [.17,.35,.44,2.15,.12],[-.10,.46,.42,-.65,1.28],
 [-.10,.18,.46,-1.75,-.32],[.08,.54,.40,.08,1.42],
 [-.09,.30,.46,2.75,.12],
];
const strikes=[
 [.02,.24,.51,-.15,-.08],[.02,.13,.50,.08,-.58],
 [.03,.35,.49,.08,.28],[.02,.12,.50,.015,-.65],
 [.03,.26,.50,-.10,.02],
];
const interpolate=(a,b,u)=>a.map((v,i)=>THREE.MathUtils.lerp(v,b[i],smooth(u)));
const quaternion=row=>{
 const az=row[3],tilt=row[4];
 const x=new THREE.Vector3(Math.cos(az),0,-Math.sin(az));
 const y=new THREE.Vector3(Math.sin(az)*Math.cos(tilt),Math.sin(tilt),Math.cos(az)*Math.cos(tilt));
 return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,new THREE.Vector3().crossVectors(x,y)));
};
function poseAt(index,profile,phase) {
 const attackEnd=profile.clipBoundaries?.[0]?.phase??1;
 const u=Math.min(1,phase/attackEnd);
 const contact=THREE.MathUtils.clamp((profile.hitDelay-.02+.05)*.26/profile.attackRaw,.20,.80);
 const wind=Math.max(.06,contact-.14), follow=Math.min(.94,contact+.19);
 const keys=[[0,carries[index]],[wind,loads[index]],[contact,strikes[index]],
  [follow,carries[index+1]],[1,carries[index+1]]];
 let row=carries[index+1];
 for(let i=1;i<keys.length;i++)if(u<=keys[i][0]){
  row=interpolate(keys[i-1][1],keys[i][1],(u-keys[i-1][0])/(keys[i][0]-keys[i-1][0]));break;
 }
 if(phase>attackEnd)row=interpolate(row,carries[index+1],(phase-attackEnd)/(1-attackEnd));
 return row;
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
function headMinimum(primary,row) {
 const q=quaternion(row),axis=new THREE.Vector3(0,1,0).applyQuaternion(q);
 const x=new THREE.Vector3(1,0,0).applyQuaternion(q),z=new THREE.Vector3(0,0,1).applyQuaternion(q);
 return primary.y*scale+axis.y*1.221-Math.abs(x.y)*.27-Math.abs(axis.y)*.19-Math.abs(z.y)*.19;
}
export function sampleSourceStyledWeapon(weaponId,combo,profile,phase,sampled) {
 if(weaponId!=='great-hammer')return sampled;
 const frame=Float64Array.from(sampled.frame),attachments=Float64Array.from(sampled.attachments);
 const index=((combo%5)+5)%5,row=profile.loop?null:poseAt(index,profile,phase);
 const hips=new THREE.Vector3().fromArray(frame),chestQ=new THREE.Quaternion().fromArray(frame,7).normalize();
 const shoulders=[67,70].map(offset=>new THREE.Vector3().fromArray(frame,offset).applyQuaternion(chestQ).add(hips));
 let primary;
 if(profile.loop) {
  const upper=new THREE.Quaternion().fromArray(frame,27),fore=new THREE.Quaternion().fromArray(frame,31);
  primary=shoulders[1].clone().add(new THREE.Vector3(0,-.39,0).applyQuaternion(upper))
   .add(new THREE.Vector3(0,-.35,.015).applyQuaternion(fore));
 } else primary=new THREE.Vector3(...row.slice(0,3)).applyQuaternion(chestQ).add(hips);
 // Keep the solid head above the floor throughout the authored downward arc.
 if(row&&headMinimum(primary,row)<.018) {
  let low=row[4],high=Math.PI/2;
  for(let i=0;i<24;i++) {const middle=(low+high)/2;
   if(headMinimum(primary,[...row.slice(0,4),middle])<.018)low=middle;else high=middle;}
  row[4]=high;
 }
 const weaponQ=row?quaternion(row):new THREE.Quaternion().fromArray(frame,63).normalize(),axis=new THREE.Vector3(0,1,0).applyQuaternion(weaponQ);
 // Translate the paired grip together into both reach spheres; this retains
 // the authored shaft direction and lets the spine/shoulders drive the swing.
 for(let pass=0;pass<16;pass++) {
  let corrected=false;
  for(let side=0;side<2;side++) {
   const hand=primary.clone().addScaledVector(axis,side===0?-support:0);
   const delta=hand.sub(shoulders[side]),distance=delta.length();
   if(distance>.73){primary.addScaledVector(delta,-(distance-.73)/distance);corrected=true;}
  }
  if(!corrected)break;
 }
 const secondary=primary.clone().addScaledVector(axis,-support);
 writeArm(frame,0,shoulders[0],secondary,chestQ,weaponQ);
 writeArm(frame,1,shoulders[1],primary,chestQ,weaponQ);
 weaponQ.toArray(frame,63);attachments.fill(0,0,3);
 return {...sampled,frame,attachments,authored:true};
}
