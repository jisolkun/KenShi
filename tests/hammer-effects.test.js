import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWeaponEffects} from '../src/weaponEffects.js';
import {createEffects} from '../src/effects.js';
import {getHammerArea} from '../src/hammerFeedback.js';

test('hammer pressure fans show the actual bounded area and survive their first presentation',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
  for(const combo of [0,2]) {
    const area=getHammerArea(combo,{x:3,y:0,z:-4},.73);
    fx.hammerFan(area,combo);
    const group=scene.children[0],pressure=group.getObjectByName('hammer-thick-pressure-fan');
    assert.equal(fx.getState().activeHammerFans,1);
    assert.deepEqual(group.userData.hammerArea,area);
    assert.deepEqual(group.position.toArray(),[3,0,-4]);
    assert.equal(group.rotation.y,area.angle);
    const positions=pressure.geometry.attributes.position;
    let outer=0;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i)*group.scale.x,z=positions.getZ(i)*group.scale.z;
      outer=Math.max(outer,Math.hypot(x,z));
      assert.ok(Math.abs(Math.atan2(x,z))<=area.halfAngle+1e-6);
      assert.ok(Math.hypot(x,z)<=area.radius+1e-6);
    }
    assert.ok(Math.abs(outer-area.radius)<1e-6,'the visible outer edge matches the damage radius');
    const opacity=pressure.material.opacity;
    fx.update(.25);assert.equal(pressure.material.opacity,opacity);
    fx.presented();fx.update(.08);assert.ok(pressure.material.opacity<opacity);
    fx.update(.10);assert.equal(fx.getState().activeHammerFans,0);
    fx.hammerFan(area,combo);assert.equal(scene.children[0],group,'the next sweep reuses its fan');
    fx.clear();assert.equal(scene.children.length,0);
  }
  fx.hammerFan(getHammerArea(1,{x:0,y:0,z:0}),1);
  fx.hammerFan({...getHammerArea(0,{x:0,y:0,z:0}),radius:Infinity},0);
  assert.equal(scene.children.length,0,'radial and invalid areas never fabricate fan effects');
  fx.destroy();
});

test('hammer contact stays bounded, follows the actual head velocity and creates no sword or floor effects',()=>{
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
    core.geometry.computeBoundingBox();
    const extent=core.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(core.scale).multiply(group.scale).length();
    assert.ok(extent<=.8,'bright contact core stays below 0.8 m even on a critical finisher');
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
