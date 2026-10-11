import assert from 'node:assert/strict';
import test from 'node:test';
import {getHammerArea, hammerAreaContains, hammerPulseCrossed} from '../src/hammerFeedback.js';

const targetAt=(origin,angle,distance,extra={})=>({
  x:origin.x+Math.sin(angle)*distance,z:origin.z+Math.cos(angle)*distance,
  minY:.18,maxY:1.85,...extra,
});

test('hammer sweeps clear a bounded forward fan while the two ground smashes pulse radially',()=>{
  const origin={x:4,y:0,z:-6};
  for(const [combo,radius,halfAngle] of [[0,2.65,1.70],[2,3.0,1.92]]){
    const area=getHammerArea(combo,origin);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,radius-.01)),true);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,radius+.01)),false);
    assert.equal(hammerAreaContains(area,targetAt(origin,halfAngle-.01,2)),true);
    assert.equal(hammerAreaContains(area,targetAt(origin,-halfAngle+.01,2)),true);
    assert.equal(hammerAreaContains(area,targetAt(origin,halfAngle+.01,2)),false);
    assert.equal(hammerAreaContains(area,targetAt(origin,Math.PI,1)),false,
      'a sweeping hammer cannot turn its front-facing fan into a full surrounding aura');
  }
  for(const [combo,radius] of [[1,2.20],[3,3.20]]){
    const area=getHammerArea(combo,origin);
    for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
      assert.equal(hammerAreaContains(area,targetAt(origin,angle,radius-.01)),true);
      assert.equal(hammerAreaContains(area,targetAt(origin,angle,radius+.01)),false,
        'the confirmed floor pulse remains finite in every direction');
    }
  }
});

test('facing and actual impact origin control the hammer area in world space',()=>{
  const origins=[{x:0,y:0,z:0},{x:9,y:0,z:-7}];
  for(const origin of origins)for(const facing of [-2.8,-.6,.8,2.7]){
    const fan=getHammerArea(0,origin,facing);
    assert.equal(hammerAreaContains(fan,targetAt(origin,facing,2)),true);
    assert.equal(hammerAreaContains(fan,targetAt(origin,facing+Math.PI,2)),false);
    const ground=getHammerArea(3,origin,facing);
    assert.equal(hammerAreaContains(ground,targetAt(origin,facing+Math.PI,3)),true);
    assert.equal(hammerAreaContains(ground,{x:origin.x+6,z:origin.z,minY:.18,maxY:1.85}),false);
  }
  const impact={x:5,y:.067,z:-3},ground=getHammerArea(3,impact);
  assert.equal(hammerAreaContains(ground,{x:5,z:-3,minY:.18,maxY:1.85}),true);
  assert.equal(hammerAreaContains(ground,{x:0,z:0,minY:.18,maxY:1.85}),false,
    'a remote grounded head must not substitute the hero position for the actual floor contact');
});

test('body radius admits real edge overlap without widening a hammer pulse indefinitely',()=>{
  const origin={x:0,y:0,z:0};
  for(const combo of [0,1,2,3]){
    const area=getHammerArea(combo,origin),radius=[2.65,2.20,3.0,3.20][combo];
    assert.equal(hammerAreaContains(area,targetAt(origin,0,radius+.19),.2),true);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,radius+.21),.2),false);
  }
  const fan=getHammerArea(0,origin);
  assert.equal(hammerAreaContains(fan,targetAt(origin,1.72,2)),false);
  assert.equal(hammerAreaContains(fan,targetAt(origin,1.72,2),.1),true,
    'a body straddling a sector edge still receives the bounded impact');
  assert.equal(hammerAreaContains(fan,targetAt(origin,1.90,2),.1),false);
});

test('a hammer area must overlap the victim body height and reject non-finite geometry',()=>{
  const origin={x:0,y:0,z:0};
  for(const [combo,ceiling] of [[0,2.25],[1,1.60],[2,2.25],[3,2.0]]){
    const area=getHammerArea(combo,origin);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,1,{minY:ceiling-.01,maxY:ceiling+.2})),true);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,1,{minY:ceiling+.01,maxY:ceiling+.2})),false);
    assert.equal(hammerAreaContains(area,targetAt(origin,0,1,{minY:-2,maxY:-1})),false,
      'a ground pulse must not strike bodies wholly below the contact plane');
    for(const field of ['x','z','minY','maxY'])for(const invalid of [NaN,Infinity,-Infinity]){
      assert.equal(hammerAreaContains(area,{...targetAt(origin,0,1),[field]:invalid}),false);
    }
    for(const radius of [-1,NaN,Infinity])assert.equal(hammerAreaContains(area,targetAt(origin,0,1),radius),false);
  }
  assert.equal(hammerAreaContains(null,targetAt(origin,0,1)),false);
  assert.equal(hammerAreaContains(getHammerArea(0,origin),null),false);
  for(const field of ['x','y','z'])for(const invalid of [NaN,Infinity]){
    assert.equal(hammerAreaContains(getHammerArea(0,{...origin,[field]:invalid}),targetAt(origin,0,1)),false);
  }
});

test('a hammer contact pulse crosses once, including a frame that skips the whole contact instant',()=>{
  const action={contact:.5};
  assert.equal(hammerPulseCrossed(action,.49,.40),false);
  assert.equal(hammerPulseCrossed(action,.50,.49),true);
  assert.equal(hammerPulseCrossed(action,.70,.49),true,
    'a low frame rate still emits the contact pulse when it passes the authored instant');
  assert.equal(hammerPulseCrossed(action,.70,.50),false);
  assert.equal(hammerPulseCrossed(action,.70,.70),false);
  assert.equal(hammerPulseCrossed(action,.60,.70),false,
    'a pose clock moving backward cannot manufacture another contact');
  assert.equal(hammerPulseCrossed(action,.50,undefined),true,
    'a first sampled contact pose has no earlier phase and still receives one pulse');
  for(const phase of [NaN,Infinity])assert.equal(hammerPulseCrossed(action,phase,.1),false);
  assert.equal(hammerPulseCrossed(null,.7,.1),false);
  assert.equal(hammerPulseCrossed({contact:NaN},.7,.1),false);
});
