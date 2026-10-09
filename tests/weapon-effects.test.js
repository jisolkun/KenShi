import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WEAPONS } from '../src/weapons.js';
import { createWeaponEffects } from '../src/weaponEffects.js';

const position=new THREE.Vector3();
function bounds(mesh){mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox.getSize(new THREE.Vector3());}
test('all twelve basic attack trails are finite, match contact shape, and retain diverse geometry',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene),signatures=new Set();
  for(const weapon of WEAPONS)for(let combo=0;combo<4;combo++){
    fx.attack(weapon.id,position,0,combo);
    const group=scene.children.at(-1),mesh=group.children[0],move=weapon.moves[combo];
    assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite),`${weapon.id}:${combo}`);
    signatures.add([...mesh.geometry.attributes.position.array].map(v=>v.toFixed(3)).join(','));
    const size=bounds(mesh);
    if(move.shape==='thrust')assert.ok(size.z>size.x*3,`${weapon.id}:${combo} must point forward`);
    if(move.shape==='crush')assert.ok(size.y>1.8,`${weapon.id}:${combo} must descend`);
    if(move.shape==='radial')assert.ok(size.x>move.reach&&size.z>move.reach,`${weapon.id}:${combo} must circle`);
    fx.clear();
  }
  assert.ok(signatures.size>=6,`distinct geometries: ${signatures.size}`);
  fx.destroy();
});
test('pause freezes, expiry reuses pooled groups, and clear removes every active object',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
  fx.attack('dual-dao',position,0,0);const first=scene.children[0],opacity=first.children[0].material.opacity;
  fx.update(0);assert.equal(first.children[0].material.opacity,opacity);
  fx.update(1);assert.equal(scene.children.length,0);
  fx.attack('dual-dao',position,0,0);assert.equal(scene.children[0],first);
  for(let i=0;i<100;i++)fx.attack('tang-dao',position,0,i%4);
  assert.ok(scene.children.length<=72);
  fx.clear();assert.equal(scene.children.length,0);
  fx.destroy();fx.destroy();fx.attack('dual-dao',position,0,0);assert.equal(scene.children.length,0);
});
test('basic attack contact delegates one physical impact',()=>{
  let impacts=0;const scene=new THREE.Scene(),fx=createWeaponEffects(scene,{impact(){impacts++;},ring(){}});
  for(const weapon of WEAPONS)for(let combo=0;combo<4;combo++){
    fx.impact(weapon.id,position,0,combo,true);
    for(const group of scene.children)group.traverse(mesh=>{if(mesh.isMesh)assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));});
    fx.clear();fx.update(1);
    assert.equal(scene.children.length,0);
  }
  assert.equal(impacts,WEAPONS.length*4);
  fx.destroy();
});
