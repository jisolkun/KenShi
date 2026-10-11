import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipHammerHeadSweep, hammerHeadSweepContains } from '../src/weaponCombat.js';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { getWeapon } from '../src/weapons.js';
import { getReviewedAttack } from '../src/choreography/index.js';
import { attackDistances, attackCanTrack } from '../src/heroAI.js';
import { HAMMER_STEPS, hammerStepDelta, greatDaoTargetGap,
  resolveGreatDaoStep } from '../src/greatDaoMovement.js';
import {getHammerArea, hammerAreaContains, hammerPulseCrossed} from '../src/hammerFeedback.js';
import {createWorldCombat} from '../src/worldCombat.js';

const head = (x, y = 1, z = 0) => new THREE.Vector3(x, y, z);
const body = { x: 0, z: 0, minY: .18, maxY: 1.9 };

test('the hammer damages only its physical head neighborhood, including enemy body radius', () => {
  assert.equal(hammerHeadSweepContains(head(.65), null, body, .45), true);
  assert.equal(hammerHeadSweepContains(head(.73), null, body, .45), false);
  assert.equal(hammerHeadSweepContains(head(2), null, body, .45), false,
    'head radius must not become a broad surrounding damage area');
});

test('a victim under the handle receives no hammer hit when the head never touches it', () => {
  const victimAtHandle = { x: 0, z: .5, minY: .18, maxY: 1.9 };
  const previousHead = head(.1, 1, 1.8), currentHead = head(-.1, 1, 1.8);
  assert.equal(hammerHeadSweepContains(currentHead, previousHead, victimAtHandle, .15), false);
  assert.equal(hammerHeadSweepContains(currentHead, previousHead,
    { ...victimAtHandle, z: 1.8 }, .15), true, 'the same motion can hit a body actually under the head');
});

test('the continuously swept head hits an intervening body even when neither endpoint overlaps', () => {
  const previous = head(-2), current = head(2);
  assert.equal(hammerHeadSweepContains(previous, null, body, .15), false);
  assert.equal(hammerHeadSweepContains(current, null, body, .15), false);
  assert.equal(hammerHeadSweepContains(current, previous, body, .15), true);
  assert.equal(hammerHeadSweepContains(head(2, 1, .5), head(-2, 1, .5), body, .15), false);
});

test('fixed head half-height respects the visible .38m thickness at enemy top and bottom', () => {
  assert.equal(hammerHeadSweepContains(head(0, 2.10), null, body, .45), false);
  assert.equal(hammerHeadSweepContains(head(0, 2.08), null, body, .45), true);
  assert.equal(hammerHeadSweepContains(head(0, -.02), null, body, .45), false);
  assert.equal(hammerHeadSweepContains(head(0, 0), null, body, .45), true);
  assert.equal(hammerHeadSweepContains(head(0, 2.15), null, body, .45, .27, .30), true,
    'a caller can supply the real projected half-height of a rotated head');
  assert.equal(hammerHeadSweepContains(head(1, 2.15), null, body, .45, .27, .30), false,
    'a projected vertical extent must not expand the horizontal hit radius');
});

test('horizontal and vertical contacts must occur during the same part of the head sweep', () => {
  assert.equal(hammerHeadSweepContains(head(3, 1), head(0, 3), body, .2), false,
    'the head is overhead while horizontally aligned, then lands away from the body');
  assert.equal(hammerHeadSweepContains(head(0, 1), head(3, 3), body, .2), true);
  assert.equal(hammerHeadSweepContains(head(0, -1), head(0, 3), body, .2), true,
    'a real vertical strike can pass through the valid body height interval');
});

test('clipping excludes shaft windup and head recovery contacts outside the damaging window', () => {
  const previous = head(-2), current = head(2);
  assert.equal(clipHammerHeadSweep(current, previous, .4, .1, [.5, .8]), null);
  const windupHit = clipHammerHeadSweep(current, previous, 1, 0, [.6, .8]);
  assert.ok(windupHit);
  assert.equal(hammerHeadSweepContains(windupHit.current, windupHit.previous, body, .1), false);
  const activeHit = clipHammerHeadSweep(current, previous, 1, 0, [.4, .6]);
  assert.equal(hammerHeadSweepContains(activeHit.current, activeHit.previous, body, .1), true);
  const end = clipHammerHeadSweep(head(2), head(0), 1, .75, [.5, .8]);
  assert.equal(hammerHeadSweepContains(end.current, end.previous, { ...body, x: .2 }, .1), true);
  assert.equal(hammerHeadSweepContains(end.current, end.previous, { ...body, x: 1 }, .1), false);
});

test('a low-rate sample that crosses the entire active interval retains its real middle contact', () => {
  const sweep = clipHammerHeadSweep(head(2), head(-2), .9, .2, [.45, .65]);
  assert.ok(sweep);
  assert.equal(hammerHeadSweepContains(sweep.current, sweep.previous, body, .1), true);
  assert.equal(hammerHeadSweepContains(sweep.current, sweep.previous, { ...body, x: 1.2 }, .1), false);
});

test('head contacts are invariant under world translation, horizontal facing and reversed travel', () => {
  for (const facing of [-2.8, -.6, .8, 2.7]) {
    const transform = point => point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), facing)
      .add(new THREE.Vector3(7, 0, -4));
    const target = { ...body, x: 7, z: -4 };
    for (const z of [.2, .7]) {
      const a = transform(head(-1, 1, z)), b = transform(head(1, 1, z));
      const expected = z < .5;
      assert.equal(hammerHeadSweepContains(b, a, target, .2), expected);
      assert.equal(hammerHeadSweepContains(a, b, target, .2), expected);
    }
  }
});

test('actual hammer head or emitted strike area reaches every automatic combat distance with real root steps', () => {
  const weapon = getWeapon('great-hammer');
  assert.equal(weapon.id, 'great-hammer');
  const bounds = { minX: -17, maxX: 17, minZ: -15, maxZ: 15 };
  for (let combo = 0; combo < 4; combo++) {
    const action = getReviewedAttack('great-hammer', combo), move = weapon.moves[combo];
    assert.ok(Number.isFinite(move.reach), 'AI reach must come from a valid hammer move');
    const rig = createCharacter('hero'); rig.setWeapon('great-hammer');
    for (const rate of [30, 60, 120]) for (const enemy of [{ type: 'grunt', radius: .45, maxY: 1.85 },
      { type: 'brute', radius: .75, maxY: 2.4 }, { type: 'boss', radius: 1, maxY: 3.2 }]) {
      const ranges = attackDistances(move, enemy.radius, true);
      for (const band of ['stop', 'enter', 'retain']) {
        const target = { x: 0, z: ranges[band], radius: enemy.radius, minY: .18, maxY: enemy.maxY };
        let position = { x: 0, z: 0 }, angle = 0, previous = null, previousPhase = 0, hit = false;
        rig.group.position.set(0, 0, 0); rig.group.rotation.y = 0;
        poseCharacter(rig, { state: 'idle', time: 0, immediate: true, transition: false });
        rig.group.updateMatrixWorld(true);
        const step = { start: { ...position }, angle, startPhase: 0, ...HAMMER_STEPS[combo],
          footStarts: rig.legs.map(leg => leg.foot.getWorldPosition(new THREE.Vector3())),
          footRotations: rig.legs.map(leg => leg.foot.getWorldQuaternion(new THREE.Quaternion())),
          obstacles: [], bounds };
        const world=createWorldCombat(new THREE.Group(),{props:[],random:()=>.5});
        const combatRate=Math.max(120,rate),frames = Math.ceil(action.duration * combatRate);
        for (let frame = 0; frame <= frames; frame++) {
          const phase = Math.min(1, frame / (action.duration * combatRate)), dt = frame ? 1 / combatRate : 0;
          if (attackCanTrack(phase, move, action)) {
            const desired = Math.atan2(target.x - position.x, target.z - position.z);
            angle += Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle)) * (1 - Math.exp(-dt * 24));
          }
          const stride = hammerStepDelta(combo, previousPhase, phase);
          stride.forward = Math.min(stride.forward, Math.max(0,
            Math.hypot(target.x - position.x, target.z - position.z) - greatDaoTargetGap(target.radius)));
          const before = position;
          position = resolveGreatDaoStep(position, { x: Math.sin(angle) * stride.forward + Math.cos(angle) * stride.lateral,
            z: Math.cos(angle) * stride.forward - Math.sin(angle) * stride.lateral }, { bounds, targets: [target] });
          assert.ok(Math.hypot(target.x - position.x, target.z - position.z) >= greatDaoTargetGap(target.radius) - 1e-6,
            'a head contact must not depend on stepping through the enemy');
          const carry = dt ? Math.hypot(position.x - before.x, position.z - before.z) / dt / 5.3824 : 0;
          rig.group.position.set(position.x, 0, position.z); rig.group.rotation.y = angle;
          poseCharacter(rig, { state: 'attack', combo, phase, time: frame / combatRate, dt,
            attackStep: step, speed: Math.min(1, carry), attackCarry: Math.min(1, carry),
            immediate: true, transition: false });
          const current = rig.weaponBlades().find(frame => frame.kind === 'hammer');
          assert.ok(current?.headCenter, 'a real hammer head marker is required');
          const sweep = clipHammerHeadSweep(current.headCenter, previous?.headCenter,
            phase, previousPhase, action.contacts[0].window);
          if (sweep) {
            const contact = hammerHeadSweepContains(sweep.current, sweep.previous, target, enemy.radius,
              current.headRadius, Math.max(current.headHalfHeight, previous?.headHalfHeight ?? .19));
            hit ||= contact;
          }
          if(combo%2===0&&hammerPulseCrossed(action,phase,previousPhase))
            hit ||= hammerAreaContains(getHammerArea(combo,position,angle),target,enemy.radius);
          if(phase>=action.release&&phase<=action.brake) {
            const physical=source=>source?{...source,headBottom:source.headMinY}:null;
            const response=world.feedbackStrike({weaponId:'great-hammer',strikeVolume:'hammer-head',
              combo,strikeId:combo,current:physical(current),previous:physical(previous),groundY:.049});
            if(response.groundContact)
              hit ||= hammerAreaContains(getHammerArea(combo,response.groundContact,angle),target,enemy.radius);
          }
          previous = current; previousPhase = phase;
        }
        assert.ok(hit, `great-hammer ${combo}, ${rate} Hz, ${enemy.type} ${band}=${ranges[band]}: AI must stand inside the real head or emitted area`);
      }
    }
  }
});

function actualHammerEvents(combo,visibleRate=60) {
  const rig=createCharacter('hero');rig.setWeapon('great-hammer');
  poseCharacter(rig,{state:'idle',time:0,immediate:true,transition:false});
  rig.group.updateMatrixWorld(true);
  const action=getReviewedAttack('great-hammer',combo),history=[],areas=[];
  const step={start:{x:0,z:0},angle:0,startPhase:0,...HAMMER_STEPS[combo],
    footStarts:rig.legs.map(leg=>leg.foot.getWorldPosition(new THREE.Vector3())),
    footRotations:rig.legs.map(leg=>leg.foot.getWorldQuaternion(new THREE.Quaternion()))};
  const world=createWorldCombat(new THREE.Group(),{props:[],random:()=>.5});
  let elapsed=0,previousPhase=0,previous;
  // The real game divides slow visible frames into at most 1/120s combat
  // steps. Exercise distinct visible frame sizes without discarding a brief
  // floor contact between presentations.
  while(elapsed<action.duration-1e-10) {
    const frameEnd=Math.min(action.duration,elapsed+1/visibleRate);
    const count=Math.ceil((frameEnd-elapsed)/(1/120));
    const dt=(frameEnd-elapsed)/count;
    for(let part=0;part<count;part++) {
      elapsed+=dt;
      const phase=Math.min(1,elapsed/action.duration),stride=hammerStepDelta(combo,previousPhase,phase);
      rig.group.position.x+=stride.lateral;rig.group.position.z+=stride.forward;
      poseCharacter(rig,{state:'attack',combo,phase,time:elapsed,dt,attackStep:step,
        attackCarry:0,immediate:true,transition:false});
      const frame=rig.weaponBlades()[0],origin=rig.group.position.clone();
      if(combo%2===0&&hammerPulseCrossed(action,phase,previousPhase))
        areas.push({phase,area:getHammerArea(combo,origin,0)});
      if(phase>=action.release&&phase<=action.brake) {
        const physical=source=>source?{...source,headBottom:source.headMinY}:null;
        const response=world.feedbackStrike({weaponId:'great-hammer',strikeVolume:'hammer-head',
          combo,strikeId:combo,current:physical(frame),previous:physical(previous),groundY:.049});
        if(response.groundContact)areas.push({phase,area:getHammerArea(combo,response.groundContact,0)});
      }
      history.push({phase,frame});previous=frame;previousPhase=phase;
    }
    elapsed=frameEnd;
  }
  return {action,history,areas};
}

test('every actual hammer strike damages dispersed crowd positions beyond the physical head path at every visible frame rate',()=>{
  for(const combo of [0,1,2,3]) {
    let reference;
    for(const rate of [30,60,120]) {
      const {action,history,areas}=actualHammerEvents(combo,rate);
      assert.equal(areas.length,1,`combo ${combo+1}, ${rate}Hz: one area pulse belongs to one real stroke`);
      const event=areas[0],area=event.area;
      const angles=area.kind==='radial'?[0,Math.PI/2,Math.PI,Math.PI*1.5]:[-1.35,-.65,.65,1.35];
      const targets=angles.map(angle=>({x:area.origin.x+Math.sin(angle)*(area.radius-.12),
        z:area.origin.z+Math.cos(angle)*(area.radius-.12),minY:.18,maxY:1.85}));
      const physical=new Set();
      let previous;
      for(const current of history) {
        const sweep=clipHammerHeadSweep(current.frame.headCenter,previous?.frame.headCenter,
          current.phase,previous?.phase,action.active);
        if(sweep)targets.forEach((target,index)=>{
          if(hammerHeadSweepContains(sweep.current,sweep.previous,target,.18,current.frame.headRadius,
            Math.max(current.frame.headHalfHeight,previous?.frame.headHalfHeight??0)))physical.add(index);
        });
        previous=current;
      }
      targets.forEach((target,index)=>assert.ok(hammerAreaContains(area,target,.18),
        `combo ${combo+1}: separated crowd victim ${index} lies inside the actual emitted area`));
      assert.ok(targets.length-physical.size>=2,
        'the strike reaches multiple scattered victims beyond the moving head instead of only a line touching its shaft');
      assert.equal(hammerAreaContains(area,{x:area.origin.x+area.radius+1,z:area.origin.z,minY:.18,maxY:1.85},.18),false);
      assert.equal(hammerAreaContains(area,{x:area.origin.x,z:area.origin.z,minY:4,maxY:5},.18),false);
      if(reference) {
        assert.ok(Math.hypot(area.origin.x-reference.x,area.origin.z-reference.z)<.04,
          'visible frame rate does not relocate the real impact area');
      } else reference=area.origin;
    }
  }
});
