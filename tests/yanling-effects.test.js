import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponEffects } from '../src/weaponEffects.js';

const pos=new THREE.Vector3(2,1,3);
function size(group){group.children[0].geometry.computeBoundingBox();return group.children[0].geometry.boundingBox.getSize(new THREE.Vector3());}
test('Yanling contact shapes distinguish narrow tip contact from cutting planes and reuse independently',()=>{
  const scene=new THREE.Scene();let impacts=0,rings=0;
  const fx=createWeaponEffects(scene,{impact(){impacts++;},ring(){rings++;}}),groups={};
  for(const kind of ['thrust','cut','chop']) {
    fx.impact('yanling-dao',pos,0,0,false,kind);groups[kind]=scene.children[0];
    assert.ok([...groups[kind].children[0].geometry.attributes.position.array].every(Number.isFinite));
    assert.ok(groups[kind].position.y>pos.y,'chop contact stays at the target rather than ground');
    fx.clear();
  }
  const thrust=size(groups.thrust),cut=size(groups.cut),chop=size(groups.chop);
  assert.ok(thrust.z>thrust.x*5 && thrust.x<0.12,'tip burst has no lateral arc');
  assert.ok(cut.x>cut.z*4 && cut.x>cut.y*2,'cut fragments follow the horizontal edge');
  assert.ok(chop.y>chop.z*4,'chop fragments follow a descending plane');
  assert.notEqual(groups.thrust.children[0].geometry,groups.cut.children[0].geometry);
  for(const kind of ['thrust','cut','chop']) {
    fx.impact('yanling-dao',pos,0,0,false,kind);assert.equal(scene.children[0],groups[kind]);
    const opacity=scene.children[0].children[0].material.opacity;
    fx.update(0);assert.equal(scene.children[0].children[0].material.opacity,opacity);
    fx.update(0.09);assert.equal(scene.children.length,kind==='thrust'?0:1);
    fx.update(1);assert.equal(scene.children.length,0);
  }
  assert.equal(impacts,6);assert.equal(rings,0);fx.destroy();
});
test('optional contact kind preserves legacy Tang and dual pools and Yanling legacy pool',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
  for(const id of ['tang-dao','dual-dao']) {
    fx.impact(id,pos,0,2);const first=scene.children[0];fx.clear();
    fx.impact(id,pos,0,2,false,'thrust');assert.equal(scene.children[0],first);fx.clear();
  }
  fx.impact('yanling-dao',pos,0,0);const legacy=scene.children[0];fx.clear();
  fx.impact('yanling-dao',pos,0,0,false,'thrust');assert.notEqual(scene.children[0],legacy);fx.clear();
  fx.impact('yanling-dao',pos,0,0);assert.equal(scene.children[0],legacy);
  fx.destroy();fx.impact('yanling-dao',pos,0,0,false,'cut');assert.equal(scene.children.length,0);
});
