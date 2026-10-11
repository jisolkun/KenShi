import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWorldCombat,sweptHammerPropContact} from '../src/worldCombat.js';

const frame=(x,y,z,bottom)=>({headCenter:new THREE.Vector3(x,y,z),headRadius:.27,headBottom:bottom});
const prop={id:'lamp',type:'stone-lamp',volumes:[{x:2,z:0,radius:.3,minY:.1,maxY:1.8}]};
const fixture=()=>createWorldCombat(new THREE.Group(),{props:[prop],random:()=>.5});
const strike=(current,previous=null,combo=3,strikeId=1)=>({weaponId:'great-hammer',strikeVolume:'hammer-head',
  current,previous,combo,strikeId,headRadius:.27,groundY:.049});

test('only the actual head swept through stone emits fragments, once per prop and stroke',()=>{
  const fx=fixture(),before=frame(0,1,0,.8),after=frame(4,1,0,.8);
  assert.ok(sweptHammerPropContact(before,after,prop.volumes[0]));
  const result=fx.feedbackStrike(strike(after,before,0));assert.equal(result.propContacts.length,1);
  assert.equal(fx.getCombatState().propHits,1);assert.equal(fx.getCombatState().groundHits,0);
  fx.feedbackStrike(strike(after,before,0));assert.equal(fx.getCombatState().propHits,1);
  fx.feedbackStrike(strike(frame(4,3,0,2.8),frame(0,3,0,2.8),0,2));assert.equal(fx.getCombatState().propHits,1);
  assert.equal(sweptHammerPropContact(frame(0,1,-2,.8),frame(0,1,2,.8),prop.volumes[0]),null,
    'a shaft could cross the prop while the real head stays far away');
});

test('stone-top contact uses physical head thickness rather than its wider horizontal radius',()=>{
  const fx=fixture(),top=prop.volumes[0].maxY;
  const high={...frame(2,top+.20,0,top+.01),headHalfHeight:.19};
  assert.equal(fx.feedbackStrike(strike(high,null,0)).propContacts.length,0);
  assert.equal(fx.getCombatState().activeParticles,0);
  const low={...frame(2,top+.18,0,top-.01),headHalfHeight:.19};
  assert.equal(fx.feedbackStrike(strike(low,null,0,2)).propContacts.length,1);
  assert.equal(fx.getCombatState().propHits,1);
});

test('rotating projected head height and horizontal approach must overlap at the same phase',()=>{
  const volume=prop.volumes[0],y=volume.maxY+.24;
  const before={...frame(2,y,0,volume.maxY+.05),headHalfHeight:.19};
  const near={...frame(2.4,y,0,volume.maxY-.06),headHalfHeight:.30};
  const contact=sweptHammerPropContact(before,near,volume);
  assert.ok(contact,'the rotated head reaches the stone top during its actual sweep');
  const t=(contact.x-before.headCenter.x)/.4;
  assert.ok(t>=.45&&t<=1);
  assert.ok(contact.y-(.19+(.30-.19)*t)<=volume.maxY+1e-12);
  const away={...near,headCenter:new THREE.Vector3(4,y,0)};
  assert.equal(sweptHammerPropContact(before,away,volume),null,
    'early horizontal proximity cannot combine with later vertical reach after the head moves away');
});

test('high and ordinary sweeps never manufacture a floor impact from the head collision sphere',()=>{
  const fx=fixture();
  fx.feedbackStrike(strike(frame(0,.25,0,.15)));assert.equal(fx.getCombatState().groundHits,0,'sphere overlaps floor but physical head bottom does not');
  fx.feedbackStrike(strike(frame(0,.25,0,.055),null,0,2));assert.equal(fx.getCombatState().activeParticles,0);
  fx.feedbackStrike(strike(frame(0,.3,0,undefined),null,3,3));assert.equal(fx.getCombatState().groundHits,0,'missing physical bottom is not guessed');
  fx.feedbackStrike(strike(frame(0,.3,0,.07401),null,3,4));assert.equal(fx.getCombatState().groundHits,0);
});

test('the finishing head contact emits a radial floor burst and crack at the actual location only once',()=>{
  const fx=fixture(),payload=strike(frame(0,.3,1,.055),frame(0,1.5,1,1.2));
  const result=fx.feedbackStrike(payload),state=fx.getCombatState();
  assert.ok(result.groundContact);assert.deepEqual(result.groundContact.toArray(),[0,.067,1]);
  assert.equal(state.groundHits,1);assert.equal(state.activeMarks,1);assert.equal(state.activeHammerRings,1);
  assert.ok(state.poolCounts['swept-ground-dust']>0);
  assert.equal(fx.feedbackStrike(payload).groundContact,null);
  fx.feedbackStrike({...payload,strikeId:2});assert.equal(fx.getCombatState().groundHits,2);
});

test('a confirmed hammer floor crack holds through the heavy recovery and then fades without growing',()=>{
  const fx=fixture(),payload=strike(frame(0,.3,1,.055));
  fx.feedbackStrike(payload);
  const crack=fx.group.children.find(mesh=>mesh.visible&&!mesh.isInstancedMesh);
  assert.ok(crack,'the confirmed physical floor contact creates a real pooled mark');
  const opacity=crack.material.opacity,scale=crack.scale.clone();
  fx.presentedCombat();fx.update(.5);fx.update(.5);
  assert.equal(crack.visible,true);assert.equal(crack.material.opacity,opacity);
  assert.ok(crack.scale.equals(scale),'the ground crack retains its contact footprint');
  assert.equal(fx.getCombatState().activeHammerRings,0,'the flash ring clears while the impact crack remains');
  fx.feedbackStrike(payload);assert.equal(fx.getCombatState().groundHits,1);
  fx.update(.25);assert.ok(crack.material.opacity>0&&crack.material.opacity<opacity);
  const faded=crack.material.opacity;fx.update(0);assert.equal(crack.material.opacity,faded);
  fx.update(.26);assert.equal(crack.visible,false);assert.equal(fx.getCombatState().activeMarks,0);
});

test('hammer world feedback shares fixed budgets, freezes during pause and clears completely on restart',()=>{
  const fx=fixture(),objects=fx.group.children.length,payload=strike(frame(0,.3,1,.055));
  fx.feedbackStrike(payload);fx.update(.02);
  const snapshot=()=>fx.group.children.map(mesh=>mesh.isInstancedMesh?[...mesh.instanceMatrix.array]:
    [mesh.material.opacity,...mesh.position.toArray(),...mesh.children.flatMap(child=>[child.visible,child.material.opacity,...child.scale.toArray()])]);
  const before=snapshot();for(let i=0;i<10;i++)fx.update(0);assert.deepEqual(snapshot(),before);
  fx.presentedCombat();fx.update(.3);assert.equal(fx.getCombatState().activeHammerRings,0);
  for(let strikeId=2;strikeId<150;strikeId++)fx.feedbackStrike({...payload,strikeId});
  const state=fx.getCombatState();assert.ok(state.activeParticles<=232);assert.ok(state.activeMarks<=12);assert.ok(state.activeHammerRings<=12);
  assert.ok(state.trackedStrikes<=32);assert.equal(fx.group.children.length,objects);
  fx.clearCombat();assert.equal(fx.getCombatState().activeParticles,0);assert.equal(fx.getCombatState().activeMarks,0);assert.equal(fx.getCombatState().activeHammerRings,0);
  fx.feedbackStrike(payload);assert.equal(fx.getCombatState().groundHits,1);fx.presentedCombat();fx.update(2);
  assert.equal(fx.getCombatState().activeParticles,0);assert.equal(fx.getCombatState().activeMarks,0);
});
