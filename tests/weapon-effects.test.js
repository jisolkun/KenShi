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

test('every great dao contact has a compact white core, a directional outline and pooled chips',()=>{
  const contacts=[],scene=new THREE.Scene(),fx=createWeaponEffects(scene,{impact(...args){contacts.push(args);},groundImpact(){assert.fail('weapon contact must not create a ground shockwave');},ring(){assert.fail('weapon contact must not create an extra ring');}});
  const point=new THREE.Vector3(2,1.1,-3),cut=new THREE.Vector3(-.8,-.5,.3).normalize();
  for(let combo=0;combo<4;combo++) {
    fx.impact('great-dao',point,.4,combo,false,cut);
    const group=scene.children.at(-1),flash=group.children[2],chips=group.children[3];
    assert.ok(group.position.distanceTo(point)<1e-10,'the contact remains on the struck enemy');
    assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(group.quaternion).distanceTo(cut)<1e-10,'the flash and fragments follow the actual blade velocity');
    assert.equal(flash.material.color.getHex(),0xfff8df);
    assert.ok(flash.material.opacity>.8,'the first frame has a visible contact core');
    assert.ok(bounds(flash).length()<.55,'the bright core cannot become a screen-sized flash');
    assert.ok(bounds(group.children[0]).length()<1.1,'the directional outline stays near the contact');
    assert.equal(chips.isInstancedMesh,true);
    assert.equal(chips.count,combo===3?6:4);
    assert.ok([...chips.instanceMatrix.array].every(Number.isFinite));
    assert.ok(contacts.at(-1)[1].distanceTo(cut)<1e-10,'the base impact uses the same cut direction');
    assert.equal(contacts.at(-1)[2],combo===3?1.55:1.08,'the upstream physical impact strength is preserved');
    fx.clear();
  }
  assert.equal(contacts.length,4);
  fx.destroy();
});

test('great dao contact survives thirty simulation substeps before the first draw, then fades once',()=>{
  for(let combo=0;combo<4;combo++) {
    const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
    fx.impact('great-dao',position,0,combo);
    const group=scene.children[0],flash=group.children[2],opacity=flash.material.opacity;
    const matrices=[...group.children[3].instanceMatrix.array];
    for(let step=0;step<30;step++)fx.update(1/120);
    assert.equal(scene.children[0],group,'a 250 ms frame must still present the real hit');
    assert.equal(flash.material.opacity,opacity);
    assert.deepEqual([...group.children[3].instanceMatrix.array],matrices);
    assert.equal(fx.getState().awaitingPresentation,1);
    fx.presented();
    assert.equal(fx.getState().awaitingPresentation,0);
    fx.update(.025);
    const firstFade=flash.material.opacity;
    assert.ok(firstFade>0&&firstFade<opacity,'the contact fades after its first actual draw');
    for(let step=0;step<30;step++){fx.update(0);fx.presented();}
    assert.equal(flash.material.opacity,firstFade,'pause and later draws never restart the flash');
    fx.update(.025);
    assert.ok(flash.material.opacity<firstFade);
    fx.update(.21);
    assert.equal(scene.children.length,0);
    fx.destroy();
  }
});

test('unpresented impacts time out at half a second and hidden groups are not marked presented',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
  fx.impact('great-dao',position,0,0);
  const first=scene.children[0];first.visible=false;
  fx.presented();assert.equal(fx.getState().awaitingPresentation,1);
  fx.update(.49);assert.equal(scene.children.length,1);
  fx.update(.01);assert.equal(scene.children.length,0);
  fx.impact('great-dao',position,0,0);
  assert.equal(scene.children[0],first,'the invisible timed-out object is still reusable');
  assert.equal(first.visible,true,'reuse restores visibility after a hidden contact');
  fx.destroy();
});

test('great dao impact pool resets contact data and stays bounded in a crowd',()=>{
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene);
  fx.impact('great-dao',position,0,0);const first=scene.children[0];
  fx.presented();fx.update(.2);
  const point=new THREE.Vector3(3,1.25,4),cut=new THREE.Vector3(.3,-.4,.5).normalize();
  fx.impact('great-dao',point,2,0,true,cut);
  assert.equal(scene.children[0],first);
  assert.equal(first.visible,true);
  assert.equal(first.children[2].material.opacity,.84);
  assert.ok(first.position.distanceTo(point)<1e-10);
  assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(first.quaternion).distanceTo(cut)<1e-10);
  const report=fx.getState();report.lastImpact.position[0]=99;report.lastImpact.cutDirection[0]=99;
  assert.deepEqual(fx.getState().lastImpact.position,point.toArray(),'debug snapshots cannot alter live contact state');
  assert.ok(new THREE.Vector3(...fx.getState().lastImpact.cutDirection).distanceTo(cut)<1e-10);
  for(let i=0;i<200;i++)fx.impact('great-dao',point,0,i%4);
  assert.ok(fx.getState().activeGreatImpacts<=24,'crowd contacts have their own draw budget');
  assert.ok(fx.getState().pooled<=16,'no more than four spare groups per move');
  for(let i=0;i<100;i++)fx.attack('dual-dao',position,0,i%4);
  assert.ok(scene.children.length<=72,'all weapon effects share the global budget');
  fx.clear();assert.equal(fx.getState().active,0);assert.equal(fx.getState().awaitingPresentation,0);assert.equal(fx.getState().lastImpact,null);
  fx.destroy();assert.equal(fx.getState().pooled,0);
});

test('destroy disposes pooled impact materials, instance buffers and shared geometry once',()=>{
  let delegated=0,materialDisposals=0,geometryDisposals=0,instanceDisposals=0;
  const scene=new THREE.Scene(),fx=createWeaponEffects(scene,{impact(){delegated++;}});
  fx.impact('great-dao',position,0,3);
  const group=scene.children[0],geometries=new Set();
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.material.addEventListener('dispose',()=>materialDisposals++);geometries.add(mesh.geometry);
    if(mesh.isInstancedMesh)mesh.addEventListener('dispose',()=>instanceDisposals++);
  });
  for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryDisposals++);
  fx.clear();assert.equal(materialDisposals,0,'clear keeps every pooled resource');
  fx.destroy();fx.destroy();
  assert.equal(materialDisposals,4);assert.equal(geometryDisposals,4);assert.equal(instanceDisposals,1);
  fx.impact('great-dao',position,0,3);fx.attack('great-dao',position,0,0);fx.update(1);fx.presented();
  assert.equal(scene.children.length,0);assert.equal(delegated,1,'destroyed effects cannot create delegated contacts');
});
