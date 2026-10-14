import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Raycaster} from 'three';
import {createCharacter,poseCharacter} from '../src/characters.js';
import {HAMMER_MOVES,HAMMER_ATTACK_PROFILES,HAMMER_SHAFT} from '../src/customHammer/definition.js';
import {createSourceAttackClock,advanceSourceAttackClock} from '../src/sourceMotion/clock.js';
import {clipHammerSweep,hammerSweepContains,hammerSweepContact,hammerGroundContact} from '../src/customHammer/combat.js';

const rigForTest=()=>{const rig=createCharacter();rig.setWeapon('great-hammer');return rig;};
const world=node=>node.getWorldPosition(new Vector3());
const transforms=rig=>rig.bind.map(({node})=>[...node.position,...node.quaternion,...node.scale]);
const frameAt=(rig,combo,phase)=>{poseCharacter(rig,{state:'attack',combo,phase,immediate:true,dt:1/120});return rig.weaponBlades()[0];};

test('the new hammer exposes exactly three authored attacks and independent attack/recovery clocks',()=>{
  assert.equal(HAMMER_MOVES.length,3);assert.equal(HAMMER_ATTACK_PROFILES.length,3);
  assert.equal(new Set(HAMMER_MOVES.map(move=>move.name)).size,3);
  for(let combo=0;combo<3;combo++){
    const clock=createSourceAttackClock('great-hammer',combo),move=HAMMER_MOVES[combo];
    assert.equal(clock.profile.customHammer,true);assert.equal(clock.timing.duration,move.duration);
    advanceSourceAttackClock(clock,0);
    const carry=advanceSourceAttackClock(clock,move.attackSeconds+.01);
    assert.equal(carry.segment,'recovery');assert.equal(carry.rawTime,0);
    assert.ok(Math.abs(carry.phase-move.recoverAt)<1e-9);
    assert.deepEqual(advanceSourceAttackClock(clock,.1,{hold:true}),carry);
    assert.equal(advanceSourceAttackClock(clock,move.recoverySeconds+.01).done,true);
  }
});

test('both hands retain one rigid shaft with actual limb lengths and complete head/floor clearance',()=>{
  const rig=rigForTest();
  for(let combo=0;combo<3;combo++)for(let i=0;i<=300;i++){
    const phase=i/300,frame=frameAt(rig,combo,phase);
    assert.ok(world(rig.offhandGrip).distanceTo(world(rig.arms[0].wrist))<1e-7,`${combo}/${phase}: support grip`);
    assert.ok(frame.heel.distanceTo(world(rig.arms[1].wrist))<1e-7);
    assert.ok(Math.abs(frame.heel.distanceTo(frame.headCenter)-HAMMER_SHAFT.length)<1e-7);
    assert.ok(frame.headMinY>=HAMMER_SHAFT.floor-1e-7,`${combo}/${phase}: solid head floor clearance`);
    assert.ok(rig.sourcePose.footMinY>=.049-1e-7,`${combo}/${phase}: shoe clearance`);
    for(const arm of rig.arms){
      assert.ok(world(arm.shoulder).distanceTo(world(arm.wrist))<=arm.elbow.position.length()+arm.wrist.position.length()+1e-7);
    }
    for(const {node} of rig.bind){
      assert.ok([...node.position,...node.quaternion,...node.scale].every(Number.isFinite));
      assert.ok(Math.abs(node.quaternion.length()-1)<1e-7);
    }
  }
});

test('the rendered shaft surface does not pass through actual torso or head meshes',()=>{
  const rig=rigForTest(),meshes=[];
  for(const root of [rig.ribcage,rig.head])root.traverse(node=>{if(node.isMesh)meshes.push(node);});
  meshes.push(...rig.body.children.filter(node=>node.isMesh));
  const ray=new Raycaster();
  for(let combo=0;combo<3;combo++)for(let i=0;i<=200;i++){
    frameAt(rig,combo,i/200);
    const shaft=rig.arms[1].weapon;
    for(const [x,z] of [[0,0],[.047,0],[-.047,0],[0,.047],[0,-.047]]){
      const from=shaft.localToWorld(new Vector3(x,.36,z)),to=shaft.localToWorld(new Vector3(x,-.84,z));
      ray.set(from,to.clone().sub(from).normalize());ray.near=.001;ray.far=from.distanceTo(to)-.001;
      const intersections=ray.intersectObjects(meshes,false);
      assert.equal(intersections.length,0,`${combo}/${i/200}: shaft surface intersects body`);
    }
  }
});

test('adjacent strikes share their carry pose and retain continuous head and joint motion',()=>{
  const rig=rigForTest();
  for(let combo=0;combo<3;combo++){
    const end=frameAt(rig,combo,HAMMER_MOVES[combo].recoverAt),carry=transforms(rig);
    const next=frameAt(rig,(combo+1)%3,0),begin=transforms(rig);
    assert.ok(end.headCenter.distanceTo(next.headCenter)<1e-7,`${combo}: shared head carry`);
    carry.forEach((row,j)=>row.forEach((value,k)=>assert.ok(Math.abs(value-begin[j][k])<1e-7,`${combo}: shared joint ${j}/${k}`)));
    let previous=null;
    for(let i=0;i<=Math.ceil(HAMMER_MOVES[combo].duration*120);i++){
      const frame=frameAt(rig,combo,i/Math.ceil(HAMMER_MOVES[combo].duration*120));
      const joints=rig.bind.map(({node})=>node.quaternion.clone());
      if(previous){
        assert.ok(frame.headCenter.distanceTo(previous.frame.headCenter)<.26,'head has no frame teleport');
        joints.forEach((q,j)=>assert.ok(q.angleTo(previous.joints[j])<.45,`${combo}: joint ${j} angular continuity`));
      }
      previous={frame,joints};
    }
  }
});

for(const rate of [30,60,120])test(`actual three-hit head paths hit forward targets and only the finisher grounds at ${rate} Hz`,()=>{
  const rig=rigForTest();
  for(let combo=0;combo<3;combo++){
    const move=HAMMER_MOVES[combo],steps=Math.ceil(move.duration*rate);
    let previous=null,previousPhase=0,hit=false,ground=false;
    for(let i=0;i<=steps;i++){
      const phase=i/steps,current=frameAt(rig,combo,phase),sweep=clipHammerSweep(current,previous,phase,previousPhase,move.active);
      if(sweep){
        hit||=hammerSweepContains(sweep.current,sweep.previous,{x:0,z:1.55,radius:.4,minY:.12,maxY:1.8});
        ground||=!!hammerGroundContact(sweep.current,sweep.previous);
        assert.equal(hammerSweepContains(sweep.current,sweep.previous,{x:0,z:4,radius:.4,minY:.12,maxY:1.8}),false,'no invisible area damage');
      }
      previous=current;previousPhase=phase;
    }
    assert.equal(hit,true,`${combo}: forward physical contact`);assert.equal(ground,combo===2);
  }
});

test('swept OBB contact catches intervening head motion, rejects handles and returns a real head surface point',()=>{
  const frame=x=>({headCenter:new Vector3(x,1.2,1.6),headQuaternion:new Quaternion(),headHalfExtents:new Vector3(.26,.18,.17)});
  const a=frame(-1),b=frame(1),target={x:0,z:1.6,radius:.18,minY:1,maxY:1.4};
  assert.equal(hammerSweepContains(a,null,target),false);assert.equal(hammerSweepContains(b,null,target),false);
  const contact=hammerSweepContact(b,a,target);assert.ok(contact);
  const local=contact.point.clone().sub(contact.frame.headCenter).applyQuaternion(contact.frame.headQuaternion.clone().invert());
  assert.ok(Math.abs(local.x)<=.260001&&Math.abs(local.y)<=.180001&&Math.abs(local.z)<=.170001);
  assert.ok([Math.abs(Math.abs(local.x)-.26),Math.abs(Math.abs(local.y)-.18),Math.abs(Math.abs(local.z)-.17)].some(distance=>distance<1e-7));
  assert.equal(hammerSweepContains(frame(0),null,{x:0,z:.65,radius:.05,minY:1.1,maxY:1.3}),false,'a shaft contact cannot damage');
  assert.equal(clipHammerSweep(b,a,.2,.1,[.4,.6]),null);assert.equal(clipHammerSweep(b,a,.9,.8,[.4,.6]),null);
  assert.equal(hammerSweepContains(b,a,{...target,radius:-1}),false);
});

test('world steps keep feet reachable during recovery movement and pause freezes the whole custom pose',()=>{
  const rig=rigForTest();
  for(let combo=0;combo<3;combo++){
    rig.group.position.set(0,0,0);poseCharacter(rig,{state:'idle',dt:1/60,immediate:true});
    const move=HAMMER_MOVES[combo],step={angle:0,feet:rig.legs.map(leg=>world(leg.foot))};
    for(let i=0;i<=120;i++){
      const phase=i/120,t=Math.min(1,phase/move.recoverAt),u=Math.max(0,Math.min(1,(t-.08)/.45));
      const recovery=Math.max(0,phase-move.recoverAt)*move.duration;
      rig.group.position.z=move.lunge*u*u*(3-2*u)+recovery*5.8;
      poseCharacter(rig,{state:'attack',combo,phase,dt:1/120,immediate:true,attackStep:step,speed:1,gaitPhase:rig.group.position.z*Math.PI*2/2.9});
      rig.attackFootTargets.forEach((target,j)=>assert.ok(world(rig.legs[j].foot).distanceTo(rig.group.localToWorld(target.clone()))<.035,`${combo}/${phase}: reachable recovery foot`));
      assert.ok(rig.sourcePose.footMinY>=.049-1e-7);
    }
  }
  const before=transforms(rig),debug=structuredClone(rig.customHammerDebug);
  poseCharacter(rig,{state:'run',time:50,dt:0,gaitPhase:9});
  assert.deepEqual(transforms(rig),before);assert.deepEqual(rig.customHammerDebug,debug);
});
