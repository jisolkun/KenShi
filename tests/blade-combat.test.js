import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bladeSweepContains} from '../src/weaponCombat.js';
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
