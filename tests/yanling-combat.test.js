import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createCharacter, poseCharacter} from '../src/characters.js';
import {getReviewedAttack} from '../src/choreography/index.js';
import {bladeSweepContains, bladeThrustContains} from '../src/weaponCombat.js';

function fixture(){const rig=createCharacter('hero');rig.setWeapon('yanling-dao');return rig;}
test('Yanling physical tip follows the actual curved metal point',()=>{
 const rig=fixture();rig.group.updateMatrixWorld(true);
 const root=rig.arms[1].weapon,vertices=[];
 root.traverse(mesh=>{
  if(!mesh.isMesh||mesh.material!==rig.materials.metal)return;
  const positions=mesh.geometry.attributes.position;
  for(let i=0;i<positions.count;i++)vertices.push(root.worldToLocal(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions,i))));
 });
 const minimum=Math.min(...vertices.map(v=>v.y));
 const point=vertices.filter(v=>Math.abs(v.y-minimum)<1e-6).reduce((s,v)=>s.add(v),new THREE.Vector3());
 point.divideScalar(vertices.filter(v=>Math.abs(v.y-minimum)<1e-6).length);
 const marker=root.worldToLocal(rig.weaponBlades()[0].tip.clone());
 assert.ok(point.distanceTo(marker)<.001,'collision tip must lie at the metal point, including curve offset');
 assert.ok(marker.x>.10,'curved tip must not be a virtual extension of the straight hilt axis');
});
test('Yanling authored tip and rendered curved point coincide throughout all nine actions',()=>{
 const rig=fixture();
 for(const state of ['attack','skill'])for(let action=0;action<(state==='attack'?4:5);action++){
  for(let frame=0;frame<=60;frame++){
   poseCharacter(rig,{state,combo:action,skill:action,phase:frame/60,time:frame/60,immediate:true,transition:false});
   rig.group.updateMatrixWorld(true);
   const point=rig.chest.localToWorld(new THREE.Vector3(...rig.reviewedAttackSample.hands[1].tip));
   assert.ok(point.distanceTo(rig.weaponBlades()[0].tip)<1e-6,`${state} ${action}, phase ${frame/60}: virtual tip differs from actual blade`);
  }
 }
});
test('Yanling point skill pierces the front lane without sweeping both flanks',()=>{
 const rig=fixture(),spec=getReviewedAttack('yanling-dao',0,'skill'),c=spec.contacts[0];
 assert.equal(c.kind,'thrust');
 let previous,hits=new Set();
 const targets=[{x:0,z:1.4},{x:-.75,z:1.4},{x:.75,z:1.4},{x:0,z:-1.0}];
 for(let frame=0;frame<=120;frame++){
  const phase=frame/120;
  poseCharacter(rig,{state:'skill',skill:0,phase,time:phase*spec.duration,immediate:true,transition:false});
  const blade=rig.weaponBlades()[0];
  if(phase>=c.start&&phase<=c.end){
   targets.forEach((target,i)=>{if(bladeThrustContains(blade,previous,target,.28,spec.width*.5))hits.add(i);});
   previous=blade;
  }
 }
 assert.deepEqual([...hits],[0]);
});
test('Yanling drawing slash physically cuts enemies on both sides of its front',()=>{
 const rig=fixture(),spec=getReviewedAttack('yanling-dao',0),c=spec.contacts[0];
 const targets=[-35,0,35].map(degrees=>({x:Math.sin(degrees*Math.PI/180)*1.2,z:Math.cos(degrees*Math.PI/180)*1.2}));
 let previous,hits=new Set();
 for(let frame=0;frame<=120;frame++){
  const phase=frame/120;
  poseCharacter(rig,{state:'attack',combo:0,phase,time:phase*spec.duration,immediate:true,transition:false});
  const blade=rig.weaponBlades()[0];
  if(phase>=c.start&&phase<=c.end){
   targets.forEach((target,i)=>{if(bladeSweepContains(blade,previous,target,.28,spec.width*.5))hits.add(i);});
   previous=blade;
  }
 }
 assert.equal(hits.size,3,'drawing cut must have an actual lateral blade path');
});
