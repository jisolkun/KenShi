import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { createSourceAttackClock, advanceSourceAttackClock } from '../src/sourceMotion/clock.js';
import { getSourceAttackProfile, getSourceAttackTiming } from '../src/sourceMotion/catalogue.js';
import { createSourceAttackVolumes, advanceSourceAttackVolumes } from '../src/sourceMotion/combat.js';
import { createWorldCombat } from '../src/worldCombat.js';

function sampleAttack(combo, dt, onStep) {
  const rig=createCharacter('hero');rig.setWeapon('great-hammer');
  const clock=createSourceAttackClock('great-hammer',combo);advanceSourceAttackClock(clock,0);
  const rows=[];
  while(!clock.done) {
    const native=advanceSourceAttackClock(clock,dt);
    poseCharacter(rig,{state:'attack',combo,sourceAttack:native,dt,immediate:true});
    const head=rig.weaponBlades()[0];
    assert.ok(head.headMinY>=-.001,'the whole moving head stays above the floor');
    assert.ok(rig.sourcePose.offhandGap<.005,'both hands remain on the shared shaft');
    const row={time:clock.wallTime,segment:native.segment,position:head.headCenter.clone(),bottom:head.headMinY};
    rows.push(row);onStep?.({rig,head,native});
  }
  return rows;
}

test('native-clock hammer attacks have broad lateral sweeps and high overhead slams',()=>{
  for(let combo=0;combo<5;combo++) {
    const rows=sampleAttack(combo,1/120).filter(row=>row.segment==='attack');
    const span=new THREE.Box3().setFromPoints(rows.map(row=>row.position)).getSize(new THREE.Vector3());
    if([0,2,4].includes(combo)) {
      assert.ok(span.x>2.4&&span.z>2.3,`attack ${combo+1} must sweep widely across both sides`);
    } else assert.ok(span.y>2.3,`attack ${combo+1} needs a clear overhead lift and full downswing`);
  }
});

for(const combo of [1,3])test(`hammer slam ${combo+1} rebounds promptly without a floor hold or abrupt speed cutoff`,()=>{
  const timing=getSourceAttackTiming('great-hammer',combo);
  const rows=sampleAttack(combo,.001).filter(row=>row.segment==='attack');
  const lowest=rows.reduce((best,row)=>row.bottom<best.bottom?row:best);
  const nearFloor=rows.filter(row=>row.bottom<.045);
  assert.ok(lowest.bottom<.045,'the complete head physically reaches the ground');
  assert.ok(nearFloor.length<(combo===1?80:50),'there is no extended planted-head hold');
  const rebound=rows.find(row=>row.time>lowest.time&&row.bottom>lowest.bottom+.12);
  assert.ok(rebound&&rebound.time-lowest.time<.045,'the head rises 12 cm within 45 ms of its low point');
  let previousSpeed,maxSpeedDelta=0;
  for(let i=1;i<rows.length;i++) {
    const row=rows[i],speed=row.position.distanceTo(rows[i-1].position)/.001;
    if(row.time>timing.hitDelay&&row.time<timing.hitDelay+.16&&previousSpeed!==undefined)
      maxSpeedDelta=Math.max(maxSpeedDelta,Math.abs(speed-previousSpeed));
    previousSpeed=speed;
  }
  assert.ok(maxSpeedDelta<6,'successive 1 ms samples must not repeat the old sudden contact-speed drop');
});

test('starting the next native combo at recovery keeps the actual head and shaft continuous',()=>{
  const rig=createCharacter('hero');rig.setWeapon('great-hammer');
  for(let combo=0;combo<4;combo++) {
    const profile=getSourceAttackProfile('great-hammer',combo);
    poseCharacter(rig,{state:'attack',combo,phase:profile.clipBoundaries[0].phase,dt:.001,immediate:true});
    const before=rig.weaponBlades()[0];
    poseCharacter(rig,{state:'attack',combo:combo+1,phase:0,dt:.001,immediate:true});
    const after=rig.weaponBlades()[0];
    assert.ok(before.headCenter.distanceTo(after.headCenter)<.04,'the next attack does not teleport the hammer');
    assert.ok(before.headQuaternion.angleTo(after.headQuaternion)<1e-5,'the shared shaft direction agrees at the join');
  }
});

test('both new slams reach the floor once during native active volumes at 30, 60 and 120 Hz',()=>{
  for(const rate of [30,60,120])for(const combo of [1,3]) {
    const volumes=createSourceAttackVolumes('great-hammer',combo,.02);
    const world=createWorldCombat(new THREE.Group(),{props:[],random:()=>.5});
    let previous;
    sampleAttack(combo,1/rate,({rig,head})=>{
      const result=advanceSourceAttackVolumes(volumes,1/rate,rig.group);
      const current={...head,headBottom:head.headMinY};
      if(result.active.length)world.feedbackStrike({weaponId:'great-hammer',combo,strikeId:combo,current,previous,groundY:.049});
      previous=current;
    });
    assert.equal(world.getCombatState().groundHits,1,`${rate} Hz slam ${combo+1}: one actual source-window floor impact`);
  }
});
