import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSourceImpactFeedback,getSourceCameraImpulse,lerpSourceCameraOffset} from '../src/sourceMotion/impact.js';

test('normal contacts share blood/glint slots while heavy contacts use glint only',()=>{
 const scene=new THREE.Scene(),feedback=createSourceImpactFeedback(scene);
 const normal=feedback.hit(new THREE.Vector3(1,.625,2),0,20);
 assert.ok(normal.blood);
 assert.equal(normal.hit.userData.sourceSlot,normal.blood.userData.sourceSlot);
 assert.equal(feedback.hit(new THREE.Vector3(0,.625,0),0,21).blood,null);
 const count=scene.children.length;
 for(let i=0;i<30;i++)feedback.hit(new THREE.Vector3(i,.625,2),0,28);
 assert.equal(scene.children.length,count,'repeated contacts reuse bounded source pools');
 feedback.clear();assert.equal(scene.children.length,0,'clear releases scene resources');
 feedback.hit(new THREE.Vector3(),0,20);assert.equal(scene.children.length,count,'the next hit recreates fresh bounded pools');
});
test('pause freezes impact pool state and updates finish old contacts',()=>{
 const feedback=createSourceImpactFeedback(new THREE.Scene());
 const event=feedback.hit(new THREE.Vector3(0,.625,0),0,20);
 feedback.update(1/60);const snapshot=feedback.snapshot();
 feedback.update(0);assert.deepEqual(feedback.snapshot(),snapshot);
 for(let i=0;i<120;i++)feedback.update(1/60);
 assert.equal(event.hit.visible,false);assert.equal(event.blood.visible,false);
});
test('source camera hits alternate and return without stopping the action clock',()=>{
 const a=getSourceCameraImpulse(20,0),b=getSourceCameraImpulse(20,1),heavy=getSourceCameraImpulse(21);
 assert.ok(a.clone().add(b).length()<1e-12);
 assert.ok(heavy.y>0&&heavy.x===0);
 const held=a.clone();lerpSourceCameraOffset(a,0);assert.equal(a.distanceTo(held),0);
 lerpSourceCameraOffset(a,.05);assert.ok(Math.abs(a.length()-held.length()*.5)<1e-12);
});
