import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWeaponEffects} from '../src/weaponEffects.js';
import {createEffects} from '../src/effects.js';

test('hammer contact is compact, follows the actual head velocity and creates no sword or floor effects',()=>{
  const scene=new THREE.Scene(),point=new THREE.Vector3(2,1.3,-3),direction=new THREE.Vector3(.1,-.9,.3).normalize();
  let contacts=0;
  const fx=createWeaponEffects(scene,{hammerImpact(p,d){contacts++;assert.ok(p.distanceTo(point)<1e-8);assert.ok(d.distanceTo(direction)<1e-8);},
    impact(){assert.fail('hammer cannot enter the sword impact path');},groundImpact(){assert.fail('enemy contact cannot invent a floor hit');}});
  fx.attack('great-hammer',point,0,0);assert.equal(scene.children.length,0,'unconfirmed swing creates no impact');
  for(let combo=0;combo<4;combo++){
    fx.impact('great-hammer',point,0,combo,combo===3,direction);
    const group=scene.children.at(-1),core=group.children[0];
    assert.ok(group.position.distanceTo(point)<1e-8);
    assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(group.quaternion).distanceTo(direction)<1e-8);
    core.geometry.computeBoundingBox();assert.ok(core.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(core.scale).length()<.55);
    assert.equal(group.children[1].isInstancedMesh,true);
    assert.equal(group.children[1].count,combo===3?8:6);
    fx.clear();
  }
  assert.equal(contacts,4);fx.destroy();
});

test('hammer impact survives a slow first draw, freezes on pause, fades once and reuses bounded resources',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene),point=new THREE.Vector3(0,1,0);
  fx.impact('great-hammer',point,0,3);const first=scene.children[0],core=first.children[0];
  const matrices=[...first.children[1].instanceMatrix.array],opacity=core.material.opacity;
  for(let i=0;i<30;i++)fx.update(1/120);
  assert.equal(core.material.opacity,opacity);assert.deepEqual([...first.children[1].instanceMatrix.array],matrices);
  fx.presented();fx.update(.03);assert.ok(core.material.opacity<opacity);
  const paused=core.material.opacity;
  for(let i=0;i<10;i++){fx.update(0);fx.presented();}assert.equal(core.material.opacity,paused);
  fx.update(.3);fx.impact('great-hammer',point,0,3);assert.equal(scene.children[0],first);
  for(let i=0;i<200;i++)fx.impact('great-hammer',point,0,i%4);
  assert.ok(fx.getState().activeHammerImpacts<=24);assert.ok(scene.children.length<=72);
  fx.clear();assert.equal(fx.getState().active,0);assert.equal(fx.getState().lastImpact,null);
  fx.impact('great-hammer',point,0,0);fx.update(.5);assert.equal(scene.children.length,0,'unseen contacts expire');
  fx.destroy();fx.destroy();fx.impact('great-hammer',point,0,0);assert.equal(scene.children.length,0);
});

test('the base blunt hit uses existing particle passes without allocating slash arcs or ground rings',()=>{
  const scene=new THREE.Scene(),fx=createEffects(scene,new THREE.PerspectiveCamera()),objects=scene.children.length;
  fx.hammerImpact(new THREE.Vector3(0,1.2,0),new THREE.Vector3(0,-1,0),1.5,true);fx.update(1/120);
  assert.equal(scene.children.length,objects);
  assert.ok(scene.children.some(mesh=>mesh.isInstancedMesh&&mesh.count>0));
  fx.clear();assert.ok(scene.children.every(mesh=>!mesh.isInstancedMesh||mesh.count===0));fx.destroy();
});
