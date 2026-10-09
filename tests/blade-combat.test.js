import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bladeSweepContains, bladeThrustContains, clipBladeSweep} from '../src/weaponCombat.js';
const v=(x,z)=>new THREE.Vector3(x,1,z);
const frame=(a,b)=>({heel:v(...a),tip:v(...b)});
test('physical blade hit is a narrow segment and never an invisible rear circle',()=>{
 const b=frame([.1,.25],[.1,1.35]);
 assert.equal(bladeSweepContains(b,null,{x:.1,z:1},.15),true);
 assert.equal(bladeSweepContains(b,null,{x:1.1,z:1},.15),false);
 assert.equal(bladeSweepContains(b,null,{x:0,z:-1},.15),false);
 assert.equal(bladeSweepContains(b,null,{x:0,z:2.5},.15),false);
});
test('a fast cut includes its swept surface between both rendered frames',()=>{
 const before=frame([-.25,.4],[-.8,1.25]),after=frame([.25,.4],[.8,1.25]);
 assert.equal(bladeSweepContains(after,before,{x:0,z:1.1},.1),true);
 assert.equal(bladeSweepContains(after,before,{x:0,z:-.7},.1),false);
 assert.equal(bladeSweepContains(after,before,{x:1.4,z:1.1},.1),false);
});
test('a raised chamber above the enemy cannot cause a hit before the blade descends',()=>{
 const high={heel:new THREE.Vector3(0,3,.3),tip:new THREE.Vector3(0,3,1.3)};
 assert.equal(bladeSweepContains(high,null,{x:0,z:1,maxY:1.9},.2),false);
 const low={heel:new THREE.Vector3(0,1.8,.3),tip:new THREE.Vector3(0,.6,1.3)};
 assert.equal(bladeSweepContains(low,null,{x:0,z:1,maxY:1.9},.2),true);
});
test('swept blade hit detection rotates with the actual weapon instead of a fixed attack cone',()=>{
 const before=frame([-.2,.4],[-.7,1.2]),after=frame([.2,.4],[.7,1.2]);
 for(const angle of [0,.3,1.2,2.6,4.8]){
  const rotate=p=>v(p.x*Math.cos(angle)+p.z*Math.sin(angle),p.z*Math.cos(angle)-p.x*Math.sin(angle));
  const hit=rotate({x:0,z:1}),miss=rotate({x:0,z:-1});
  const a={heel:rotate(after.heel),tip:rotate(after.tip)},b={heel:rotate(before.heel),tip:rotate(before.tip)};
  assert.equal(bladeSweepContains(a,b,hit,.1),true);
  assert.equal(bladeSweepContains(a,b,miss,.1),false);
 }
});
test('a point attack hits with its tip without damage along an extended shaft',()=>{
 const blade=frame([0,.25],[0,1.6]);
 assert.equal(bladeThrustContains(blade,null,{x:0,z:1.6},.1),true);
 assert.equal(bladeThrustContains(blade,null,{x:0,z:.75},.1),false);
 assert.equal(bladeSweepContains(blade,null,{x:0,z:.75},.1),true);
 assert.equal(bladeThrustContains(blade,null,{x:.5,z:1.6},.1),false);
});
test('fast point entries sweep a narrow forward line and respect enemy height',()=>{
 const before=frame([0,.3],[0,.9]),after=frame([0,.6],[0,1.7]);
 assert.equal(bladeThrustContains(after,before,{x:0,z:1.3},.12),true);
 assert.equal(bladeThrustContains(after,before,{x:.5,z:1.3},.12),false);
 assert.equal(bladeThrustContains(after,before,{x:0,z:1.3,minY:2,maxY:3},.12),false);
});

test('fast strikes retain boundary contact without granting windup or recovery damage',()=>{
 const before=frame([-1,.4],[-1,1.4]),after=frame([1,.4],[1,1.4]);
 const full=clipBladeSweep(after,before,.7,.3,[.4,.6]);
 assert.ok(full);
 assert.equal(bladeSweepContains(full.current,full.previous,{x:0,z:1},.05,0),true);
 assert.equal(bladeSweepContains(full.current,full.previous,{x:-.9,z:1},.05,0),false);
 assert.equal(bladeSweepContains(full.current,full.previous,{x:.9,z:1},.05,0),false);
 const entering=clipBladeSweep(after,before,.5,.3,[.4,.6]);
 assert.ok(entering.previous,'the entry segment survives even when the previous frame preceded the window');
 const leaving=clipBladeSweep(after,before,.7,.5,[.4,.6]);
 assert.ok(leaving,'the final crossing survives even when the current frame passed the window');
 assert.equal(clipBladeSweep(after,before,.3,.2,[.4,.6]),null);
 assert.equal(clipBladeSweep(after,before,.8,.7,[.4,.6]),null);
 assert.equal(clipBladeSweep(after,null,.3,undefined,[.4,.6]),null);
 assert.equal(clipBladeSweep(after,null,.5,undefined,[.4,.6]).current,after);
 assert.equal(before.tip.x,-1,'clipping never mutates the live physical pose');
 assert.equal(after.tip.x,1);
});
