import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWorldCombat,sweptHammerPropContact} from '../src/worldCombat.js';
import {getHammerArea} from '../src/hammerFeedback.js';

const frame=(x,y,z,bottom)=>({headCenter:new THREE.Vector3(x,y,z),headRadius:.27,headBottom:bottom});
const prop={id:'lamp',type:'stone-lamp',volumes:[{x:2,z:0,radius:.3,minY:.1,maxY:1.8}]};
const fixture=()=>createWorldCombat(new THREE.Group(),{props:[{...prop,volumes:prop.volumes.map(volume=>({...volume}))}],random:()=>.5});
const strike=(current,previous=null,combo=3,strikeId=1)=>({weaponId:'great-hammer',strikeVolume:'hammer-head',
  current,previous,combo,strikeId,headRadius:.27,groundY:.049});

test('only the actual head swept through stone emits fragments, once per prop and stroke',()=>{
  const fx=fixture(),before=frame(0,1,0,.8),after=frame(4,1,0,.8);
  assert.ok(sweptHammerPropContact(before,after,prop.volumes[0]));
  const result=fx.feedbackStrike(strike(after,before,0));assert.equal(result.propContacts.length,1);
  assert.equal(fx.getCombatState().propHits,1);assert.equal(fx.getCombatState().groundHits,0);
  fx.feedbackStrike(strike(after,before,0));assert.equal(fx.getCombatState().propHits,1);
  fx.feedbackStrike({...strike(after,before,0),impactArea:getHammerArea(0,{x:2,y:0,z:0})});
  assert.equal(fx.getCombatState().propHits,1,'the impact fan cannot damage the same head-struck prop again in one stroke');
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
  for(const combo of [0,2])fx.feedbackStrike(strike(frame(0,.25,0,.055),null,combo,combo+2));
  assert.equal(fx.getCombatState().activeParticles,0);
  fx.feedbackStrike(strike(frame(0,.3,0,undefined),null,3,3));assert.equal(fx.getCombatState().groundHits,0,'missing physical bottom is not guessed');
  fx.feedbackStrike(strike(frame(0,.3,0,.07401),null,3,4));assert.equal(fx.getCombatState().groundHits,0);
  fx.feedbackStrike(strike(frame(0,.3,0,.01399),null,1,5));assert.equal(fx.getCombatState().groundHits,0,
    'an implausibly buried head is not a confirmed physical floor impact');
});

test('both grounding hammer strikes emit radial floor dust and cracks at the real head location once',()=>{
  for(const combo of [1,3]){
    const fx=fixture(),payload=strike(frame(0,.3,1,.055),frame(0,1.5,1,1.2),combo);
    const result=fx.feedbackStrike(payload),state=fx.getCombatState();
    assert.ok(result.groundContact);assert.deepEqual(result.groundContact.toArray(),[0,.067,1]);
    assert.equal(state.groundHits,1);assert.equal(state.activeMarks,1);assert.equal(state.activeHammerRings,1);
    assert.ok(state.poolCounts['swept-ground-dust']>=20,'a ground smash throws a broad visible dust burst');
    assert.equal(fx.feedbackStrike(payload).groundContact,null);
    fx.feedbackStrike({...payload,strikeId:2});assert.equal(fx.getCombatState().groundHits,2);
  }
});

test('a fast descending hammer anchors its floor crossing identically at different sample rates',()=>{
  const contacts=[];
  for(const rate of [30,60,120]) {
    const fx=fixture();let previous=frame(-2,1.8,-1,1.6),contact;
    for(let i=1;i<=rate&&!contact;i++) {
      const t=i/rate;
      const current=frame(-2+12*t,1.8-3.1*t,-1+6*t,1.6-3.1*t);
      contact=fx.feedbackStrike(strike(current,previous,3)).groundContact;
      previous=current;
    }
    assert.ok(contact,'a visible step crossing the floor band still emits the physical ground impact');
    contacts.push(contact);
    assert.equal(fx.getCombatState().groundHits,1);
  }
  for(const contact of contacts)assert.ok(contact.distanceTo(contacts[0])<1e-9,
    'dust and cracks attach to the swept floor entry, rather than the first rendered point past it');
});

test('the floor crack has a broad bounded footprint and the finishing crater reads larger than the follow-up',()=>{
  const widths=[];
  for(const combo of [1,3]){
    const fx=fixture();fx.feedbackStrike(strike(frame(0,.3,1,.055),null,combo));
    const crack=fx.group.children.find(mesh=>mesh.visible&&!mesh.isInstancedMesh);
    assert.ok(crack);
    crack.geometry.computeBoundingBox();
    const size=crack.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(crack.scale);
    const span=Math.max(size.x,size.y);
    assert.ok(span>=2,'the floor fracture must read across nearby paving rather than a tiny contact decal');
    assert.ok(span<=[2.2,3.2][combo===3?1:0]*2+.2,'the crack stays within the bounded ground impact footprint');
    widths.push(span);
  }
  assert.ok(widths[1]>widths[0],'the terminal smash has the larger visible floor fracture');
});

test('stone damage follows head contact and restores every authored node transform on restart',()=>{
  const scene=new THREE.Group(),base=new THREE.Mesh(new THREE.BoxGeometry(.5,.4,.5),new THREE.MeshBasicMaterial());
  const cap=new THREE.Mesh(new THREE.BoxGeometry(.6,.2,.6),base.material);
  base.position.set(2,.3,0);base.rotation.set(.1,.2,-.1);base.scale.set(.9,1.1,.8);
  cap.position.set(2,1.4,0);cap.rotation.set(.2,-.3,.1);cap.scale.set(1.2,.9,1);cap.visible=false;
  scene.add(base,cap);
  const transforms=()=>[base,cap].map(node=>({position:node.position.toArray(),quaternion:node.quaternion.toArray(),
    scale:node.scale.toArray(),visible:node.visible}));
  const original=transforms(),stone={...prop,volumes:prop.volumes.map(volume=>({...volume})),nodes:[base,cap]},
    fx=createWorldCombat(scene,{props:[stone],random:()=>.5});
  const payload=strike(frame(4,1,0,.8),frame(0,1,0,.8),0);
  fx.feedbackStrike(payload);
  assert.deepEqual(fx.getCombatState().damagedProps,[{id:'lamp',hits:1,broken:false}]);
  fx.feedbackStrike(payload);assert.equal(fx.getCombatState().damagedProps[0].hits,1,
    'one stroke does not keep breaking its already contacted stone every substep');
  fx.feedbackStrike({...payload,strikeId:2});
  assert.deepEqual(fx.getCombatState().damagedProps,[{id:'lamp',hits:2,broken:true}]);
  assert.notDeepEqual(transforms(),original,'the scene stone visibly collapses when the second impact breaks it');
  fx.clearCombat();assert.deepEqual(transforms(),original);
  assert.deepEqual(fx.getCombatState().damagedProps,[]);
  fx.feedbackStrike(payload);assert.deepEqual(fx.getCombatState().damagedProps,[{id:'lamp',hits:1,broken:false}],
    'a reset prop can be damaged again in the new battle');
});

test('a broken stone lamp leaves low collidable rubble and restores its original body volumes on restart',()=>{
  const lamp={id:'breakable-lamp',type:'stone-lamp',volumes:[
    {x:2,z:0,radius:.3,minY:.1,maxY:.4},
    {x:2,z:0,radius:.15,minY:.4,maxY:1.8},
  ]},original=lamp.volumes.map(volume=>({...volume}));
  const fx=createWorldCombat(new THREE.Group(),{props:[lamp],random:()=>.5});
  const payload=strike(frame(4,1,0,.8),frame(0,1,0,.8),0);
  fx.feedbackStrike(payload);
  assert.deepEqual(lamp.volumes,original,'a first chip leaves the standing lamp collision height intact');
  fx.feedbackStrike({...payload,strikeId:2});
  assert.deepEqual(fx.getCombatState().damagedProps,[{id:lamp.id,hits:2,broken:true}]);
  assert.ok(lamp.volumes.length>0,'broken stone remains as physical rubble');
  for(const volume of lamp.volumes){
    assert.ok(volume.minY<=volume.maxY&&volume.maxY<=.45,'lamp collision compresses to the visible low remnants');
    assert.equal(sweptHammerPropContact(null,frame(2,1,0,.8),volume),null,
      'a waist-height head cannot collide with an invisible intact lamp after it has fallen');
  }
  assert.equal(fx.feedbackStrike(strike(frame(2,1,0,.8),null,0,3)).propContacts.length,0);
  assert.ok(lamp.volumes.some(volume=>sweptHammerPropContact(null,frame(2,.25,0,.06),volume)),
    'the head can still physically contact the rubble at ground level');
  fx.clearCombat();assert.deepEqual(lamp.volumes,original);
  assert.ok(lamp.volumes.some(volume=>sweptHammerPropContact(null,frame(2,1,0,.8),volume)),
    'the restored lamp becomes a standing collision target in the next battle');
});

test('an explicit bounded fan damages nearby stone and never reaches behind, beyond or above it',()=>{
  const volumes=(x,z,minY=.1,maxY=1.8)=>[{x,z,radius:.1,minY,maxY}];
  const props=[{id:'front',type:'stone',volumes:volumes(0,1.8)},
    {id:'back',type:'stone',volumes:volumes(0,-1.8)},
    {id:'far',type:'stone',volumes:volumes(0,4)},
    {id:'high',type:'stone',volumes:volumes(0,1.8,3,4)}];
  const fx=createWorldCombat(new THREE.Group(),{props,random:()=>.5});
  const payload={...strike(frame(8,4,8,3.8),null,0),impactArea:getHammerArea(0,{x:0,y:0,z:0})};
  const result=fx.feedbackStrike(payload);
  assert.deepEqual(result.propContacts.map(contact=>contact.prop),['front']);
  assert.deepEqual(fx.getCombatState().damagedProps,[{id:'front',hits:1,broken:false}],
    'volumes-only fixtures keep the same damage record as rendered scene props');
  assert.equal(result.groundContact,null,'a sweeping area cannot manufacture a floor contact');
  fx.feedbackStrike(payload);assert.equal(fx.getCombatState().propHits,1);
  fx.feedbackStrike({...payload,strikeId:2});assert.equal(fx.getCombatState().damagedProps[0].broken,true);
});

test('a confirmed ground pulse damages stone radially around the actual head impact',()=>{
  const impact={x:1.4,y:.067,z:-1.1};
  const props=[{id:'rear',type:'stone',volumes:[{x:impact.x,z:impact.z-2.6,radius:.1,minY:.1,maxY:1.2}]},
    {id:'outside',type:'stone',volumes:[{x:impact.x+3.5,z:impact.z,radius:.1,minY:.1,maxY:1.2}]}];
  const fx=createWorldCombat(new THREE.Group(),{props,random:()=>.5});
  const payload={...strike(frame(impact.x,.3,impact.z,.055),frame(impact.x,1.5,impact.z,1.2)),
    origin:new THREE.Vector3(-8,0,6)};
  const result=fx.feedbackStrike(payload);
  assert.deepEqual(result.groundContact.toArray(),[impact.x,impact.y,impact.z]);
  assert.deepEqual(result.propContacts.map(contact=>contact.prop),['rear']);
  assert.deepEqual(fx.getCombatState().damagedProps,[{id:'rear',hits:1,broken:false}]);
  fx.feedbackStrike(payload);assert.equal(fx.getCombatState().damagedProps[0].hits,1,
    'the floor wave and head contact share one prop hit allowance per stroke');
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
