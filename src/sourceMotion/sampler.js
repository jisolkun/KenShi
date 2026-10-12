// Generated from the user-provided original source by tools/import-source-motion.mjs.
import * as THREE from 'three';
import {referenceCurveNodes,referenceCurveTracks,referenceCurveClips,referenceCurveBinary,referenceCurveMetadata} from './curves.js';
import {referenceScaleTracks,referenceScaleClips,referenceScaleBinary} from './scales.js';
import {sampleReferenceHermite,decodeReferenceCurveBinary} from './hermite.js';
import {referenceWeaponAttackProfiles,referenceActionProfiles,referenceSkillProfiles,referenceCastProfiles,referenceMotionMetadata as metadata} from './data.js';
export {referenceCurveMetadata};

const values=decodeReferenceCurveBinary(referenceCurveBinary);
const scaleValues=decodeReferenceCurveBinary(referenceScaleBinary);
const nodes=referenceCurveNodes.map(row=>({
  parent:row.parent,bindPosition:new THREE.Vector3().fromArray(row.position),
  bindRotation:new THREE.Quaternion().fromArray(row.rotation).normalize(),bindScale:new THREE.Vector3().fromArray(row.scale),
  position:new THREE.Vector3(),rotation:new THREE.Quaternion(),scale:new THREE.Vector3().fromArray(row.scale),
  matrix:new THREE.Matrix4(),world:new THREE.Matrix4(),worldPosition:new THREE.Vector3(),worldRotation:new THREE.Quaternion(),
}));
const indices=new Map(referenceCurveNodes.map((n,i)=>[n.path,i]));
const sourceBindings=metadata.axisCalibration.map(b=>({node:nodes[indices.get(b.source)],alignment:new THREE.Quaternion().fromArray(b.alignment),
  bindPosition:new THREE.Vector3(),rotation:new THREE.Quaternion()}));
const leftDummy=nodes[indices.get(metadata.dualWeaponBind.leftSource)];
const sourceScale=metadata.translationScale,temporaryScale=new THREE.Vector3(),curveValue=new Float64Array(4);
function updateWorld(){
  for(const node of nodes){
    node.matrix.compose(node.position,node.rotation,node.scale);
    if(node.parent<0)node.world.copy(node.matrix);else node.world.multiplyMatrices(nodes[node.parent].world,node.matrix);
    // Matrix decomposition preserves the existing evaluator's treatment of
    // nonuniform source bind scales, including tiny inherited shear.
    node.world.decompose(node.worldPosition,node.worldRotation,temporaryScale);
  }
}
function resetLocals(){for(const node of nodes){node.position.copy(node.bindPosition);node.rotation.copy(node.bindRotation);node.scale.copy(node.bindScale);}}
resetLocals();updateWorld();
for(const b of sourceBindings)b.bindPosition.copy(b.node.worldPosition);
const movingDefinitions=[[3,1,-.42,.52,0],[6,1,.42,.52,0],[2,1,0,.73,.02],[9,0,-.19,-.05,0],[12,0,.19,-.05,0]];
const moving=movingDefinitions.map(([bone,parent,x,y,z])=>({bone,parent,target:new THREE.Vector3(x,y,z),
  bindOffset:sourceBindings[bone].bindPosition.clone().sub(sourceBindings[parent].bindPosition),position:new THREE.Vector3()}));
const hips=new THREE.Vector3(),scratch=new THREE.Vector3(),foot=new THREE.Vector3(),grip=new THREE.Vector3();
const inverse=new THREE.Quaternion(),leftWorld=new THREE.Quaternion();
const descriptorByProfile=new WeakMap();
function register(profile){
  if(descriptorByProfile.has(profile))return;
  const segments=profile.segments??[
    {sha256:profile.sha256,rawDuration:profile.attackRaw,speed:.24,seconds:profile.attackSeconds},
    ...(profile.recoveryRaw>0?[{sha256:profile.recoverySha256,rawDuration:profile.recoveryRaw,speed:profile.recoverySpeed??.24,seconds:profile.recoverySeconds}]:[]),
  ];
  let elapsed=0;
  const queue=segments.map(s=>{
    const clip=referenceCurveClips[s.sha256];
    if(!clip)throw new Error(`Missing continuous source: ${s.sha256}`);
    const scales=referenceScaleClips[s.sha256];
    if(!scales)throw new Error(`Missing source scale supplement: ${s.sha256}`);
    const entry={clip,scales,speed:s.speed,rawDuration:s.rawDuration,start:elapsed,startPhase:elapsed/profile.duration};
    elapsed+=s.seconds??s.rawDuration/s.speed;
    return entry;
  });
  // Use the previously audited boundary phase literally, avoiding a floating
  // point multiply that could select the outgoing clip at the exact boundary.
  for(let i=1;i<queue.length;i++)queue[i].startPhase=profile.clipBoundaries?.[i-1]?.phase??queue[i].startPhase;
  const frame=new Float64Array(profile.frameStride??metadata.stride),attachments=new Float64Array(10);
  // Only complete, identically tracked loop states on this source skeleton
  // may share a local blend. Equipment also determines the later mapping.
  const coverage=queue.length===1?[queue[0].clip.positions,queue[0].clip.rotations,queue[0].scales]
    .map(tracks=>tracks.map(([node])=>node).sort((a,b)=>a-b).join(',')).join(';'):null;
  const sourceMapKey=coverage?JSON.stringify([profile.kind,profile.weaponFamily,
    profile.actorScale??metadata.actorScales.hero,profile.weaponTipLength??metadata.weaponTipLengths[profile.weaponFamily??'blade'],
    !!profile.sourceWeaponMount,!!profile.dualWeaponFrames,frame.length,coverage]):null;
  const blendKey=profile.loop?sourceMapKey:null;
  descriptorByProfile.set(profile,{queue,frame,attachments,blendKey,sourceMapKey,phase:NaN,pair:{a:frame,b:frame,mix:0},clip:null,rawTime:0});
}
function collect(value){if(value?.frames){register(value);return;}if(value&&typeof value==='object')for(const item of Object.values(value))collect(item);}
// Identity registration is deliberate: executions, reactions, enemies, switches
// and other independently bound profiles retain their existing baked fallback.
for(const catalogue of [referenceWeaponAttackProfiles,referenceActionProfiles,referenceSkillProfiles,referenceCastProfiles])collect(catalogue);

export function hasReferenceCurveMotion(profile){return descriptorByProfile.has(profile);}

export function sampleReferenceCurveMotion(profile,phase){
  const sampled=descriptorByProfile.get(profile);if(!sampled)return null;
  const clamped=Math.max(0,Math.min(1,phase));
  if(sampled.phase===clamped)return sampled;
  sampled.phase=clamped;
  let selected=sampled.queue[0];
  for(let i=1;i<sampled.queue.length;i++){if(clamped<sampled.queue[i].startPhase)break;selected=sampled.queue[i];}
  const time=Math.max(0,Math.min(selected.rawDuration,(clamped-selected.startPhase)*profile.duration*selected.speed));
  sampled.clip=selected.clip;sampled.rawTime=time;
  resetLocals();
  for(const [index,track]of selected.clip.positions){sampleReferenceHermite(values,referenceCurveTracks[track],time,curveValue);nodes[index].position.fromArray(curveValue);}
  for(const [index,track]of selected.clip.rotations){sampleReferenceHermite(values,referenceCurveTracks[track],time,curveValue);nodes[index].rotation.fromArray(curveValue).normalize();}
  for(const [index,track]of selected.scales){sampleReferenceHermite(scaleValues,referenceScaleTracks[track],time,curveValue);nodes[index].scale.fromArray(curveValue);}
  updateWorld();
  return mapCurrentSourceToLowPoly(profile,sampled);
}

// Each caller owns its accumulation and output buffers. Mixed poses never
// borrow or overwrite a single-profile descriptor's cached frame.
export function createReferenceCurveBlendWorkspace(){
  const frame=new Float64Array(91);
  return {frame,attachments:new Float64Array(10),locals:new Float64Array(nodes.length*10),
    anchors:new Float64Array(nodes.length*4),pair:{a:frame,b:frame,mix:0}};
}

export function sampleReferenceCurveBlend(samples,workspace){
  let first=null,total=0,count=0,key=null;
  for(const sample of samples){
    if(!(sample.weight>0))continue;
    const descriptor=descriptorByProfile.get(sample.profile);
    if(!descriptor?.blendKey)return null;
    if(first===null){first=sample;key=descriptor.blendKey;}
    else if(descriptor.blendKey!==key)return null;
    total+=sample.weight;count++;
  }
  if(count===0)return null;
  if(count===1)return sampleReferenceCurveMotion(first.profile,first.phase);
  const {locals,anchors}=workspace;locals.fill(0);
  let initial=true;
  for(const {profile,phase,weight}of samples){
    if(!(weight>0))continue;
    const selected=descriptorByProfile.get(profile).queue[0];
    const time=Math.max(0,Math.min(selected.rawDuration,Math.max(0,Math.min(1,phase))*profile.duration*selected.speed));
    resetLocals();
    for(const [index,track]of selected.clip.positions){sampleReferenceHermite(values,referenceCurveTracks[track],time,curveValue);nodes[index].position.fromArray(curveValue);}
    // Native run/walk evidence distinguishes these raw Hermite components
    // from blending quaternions that have already been normalized per clip.
    for(const [index,track]of selected.clip.rotations){sampleReferenceHermite(values,referenceCurveTracks[track],time,curveValue);nodes[index].rotation.fromArray(curveValue);}
    for(const [index,track]of selected.scales){sampleReferenceHermite(scaleValues,referenceScaleTracks[track],time,curveValue);nodes[index].scale.fromArray(curveValue);}
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i],q=node.rotation,offset=i*10,anchor=i*4;
      if(initial)q.toArray(anchors,anchor);
      const signedWeight=weight*(anchors[anchor]*q.x+anchors[anchor+1]*q.y+anchors[anchor+2]*q.z+anchors[anchor+3]*q.w<0?-1:1);
      locals[offset]+=node.position.x*weight;locals[offset+1]+=node.position.y*weight;locals[offset+2]+=node.position.z*weight;
      locals[offset+3]+=q.x*signedWeight;locals[offset+4]+=q.y*signedWeight;locals[offset+5]+=q.z*signedWeight;locals[offset+6]+=q.w*signedWeight;
      locals[offset+7]+=node.scale.x*weight;locals[offset+8]+=node.scale.y*weight;locals[offset+9]+=node.scale.z*weight;
    }
    initial=false;
  }
  for(let i=0;i<nodes.length;i++){
    const node=nodes[i],offset=i*10;
    node.position.fromArray(locals,offset).divideScalar(total).toArray(locals,offset);
    node.rotation.fromArray(locals,offset+3).normalize().toArray(locals,offset+3);
    node.scale.fromArray(locals,offset+7).divideScalar(total).toArray(locals,offset+7);
  }
  updateWorld();
  return mapCurrentSourceToLowPoly(first.profile,workspace);
}

function mapCurrentSourceToLowPoly(profile,sampled){
  const frame=sampled.frame,attachments=sampled.attachments;
  for(let i=0;i<sourceBindings.length;i++){
    const b=sourceBindings[i];b.rotation.copy(b.node.worldRotation).multiply(b.alignment).normalize().toArray(frame,3+i*4);
  }
  hips.copy(sourceBindings[0].node.worldPosition).sub(sourceBindings[0].bindPosition).multiplyScalar(sourceScale);hips.y+=1;
  for(let i=0;i<moving.length;i++){
    const joint=moving[i],parent=sourceBindings[joint.parent];
    joint.position.copy(sourceBindings[joint.bone].node.worldPosition).sub(parent.node.worldPosition)
      .applyQuaternion(inverse.copy(parent.rotation).invert()).sub(joint.bindOffset).multiplyScalar(sourceScale).add(joint.target).toArray(frame,67+3*i);
  }
  let soleY=0;
  for(let side=0;side<2;side++){
    const thigh=9+3*side;
    foot.copy(moving[3+side].position).applyQuaternion(sourceBindings[0].rotation).add(hips);
    foot.add(scratch.set(0,-.46,0).applyQuaternion(sourceBindings[thigh].rotation));
    foot.add(scratch.set(0,-.43,0).applyQuaternion(sourceBindings[thigh+1].rotation));
    for(let corner=0;corner<8;corner++){
      scratch.set(corner&1?.135:-.135,corner&2?.12:-.05,corner&4?.268:-.122).applyQuaternion(sourceBindings[thigh+2].rotation).add(foot);
      soleY=Math.min(soleY,scratch.y);
    }
  }
  hips.y-=soleY;hips.toArray(frame,0);
  const sourceMount=profile.sourceWeaponMount||!!profile.dualWeaponFrames;
  if(sourceMount){
    scratch.copy(sourceBindings[15].node.worldPosition).sub(sourceBindings[8].node.worldPosition).multiplyScalar(sourceScale)
      .applyQuaternion(inverse.copy(sourceBindings[8].rotation).invert()).toArray(attachments,0);
  }else{attachments[0]=0;attachments[1]=.01;attachments[2]=.04;}
  if(profile.dualWeaponFrames){
    scratch.copy(leftDummy.worldPosition).sub(sourceBindings[5].node.worldPosition).multiplyScalar(sourceScale)
      .applyQuaternion(inverse.copy(sourceBindings[5].rotation).invert()).toArray(attachments,3);
    leftWorld.copy(leftDummy.worldRotation).multiply(sourceBindings[15].alignment).normalize();
  }else{
    attachments.set(metadata.dualWeaponBind.leftPosition,3);
    leftWorld.copy(sourceBindings[5].rotation).multiply(inverse.fromArray(metadata.dualWeaponBind.leftLocalQuaternion));
  }
  leftWorld.toArray(attachments,6);
  if(frame.length>=91){frame[88]=attachments[0];frame[89]=attachments[1];frame[90]=attachments[2];}
  grip.copy(moving[1].position).applyQuaternion(sourceBindings[1].rotation).add(hips);
  grip.add(scratch.set(0,-.39,0).applyQuaternion(sourceBindings[6].rotation));
  grip.add(scratch.set(0,-.35,.015).applyQuaternion(sourceBindings[7].rotation));
  grip.add(scratch.fromArray(attachments).applyQuaternion(sourceBindings[8].rotation));
  const scale=profile.actorScale??metadata.actorScales.hero;
  scratch.set(0,profile.weaponTipLength??metadata.weaponTipLengths[profile.weaponFamily??'blade'],0)
    .applyQuaternion(sourceBindings[15].rotation).add(grip).multiplyScalar(scale).toArray(frame,82);
  grip.multiplyScalar(scale).toArray(frame,85);
  return sampled;
}
