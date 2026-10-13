import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Group } from 'three';
import { sampleWeaponContact } from '../src/sourceMotion/contact.js';
import { getSourceAttackRule } from '../src/sourceMotion/combat.js';

test('contact direction and cut plane follow the actual blade sweep', () => {
  const frame={tip:new Vector3(1,2,0),heel:new Vector3(1,0,0),normal:new Vector3(0,0,1)};
  const contact=sampleWeaponContact({frame,previous:{tip:new Vector3(0,2,0)},
    targetPosition:new Vector3(0,0,3),attackerPosition:new Vector3()});
  assert.deepEqual(contact.direction.toArray(),[1,0,0]);
  assert.equal(Math.abs(contact.cutNormal.z),1);
  assert.equal(contact.cutNormal.dot(contact.direction),0);
  assert.equal(contact.cutNormal.dot(frame.tip.clone().sub(frame.heel)),0);
});

test('hammer downward impulse stays vertical visually but knockback stays on the ground', () => {
  const contact=sampleWeaponContact({frame:{headCenter:new Vector3(0,.4,2)},
    previous:{headCenter:new Vector3(0,1.4,2)},targetPosition:new Vector3(0,0,2),attackerPosition:new Vector3()});
  assert.deepEqual(contact.direction.toArray(),[0,-1,0]);
  assert.deepEqual(contact.knockback.toArray(),[0,0,1]);
});

test('contact point uses the posed target torso with its actual actor scale', () => {
  const group=new Group(),chest=new Group();group.add(chest);
  group.position.set(4,.6,5);group.scale.setScalar(1.66);chest.position.set(.1,1,.2);
  const {point}=sampleWeaponContact({targetRig:{group,chest},attackerPosition:new Vector3()});
  assert.ok(point.distanceTo(new Vector3(4.166,.6+.92*1.66,5.332))<1e-10);
});

test('thrusts and stationary weapon samples have finite unit contact vectors', () => {
  for (const previous of [undefined,{tip:new Vector3(0,2,0)},{tip:new Vector3(0,1,0)}]) {
    const result=sampleWeaponContact({frame:{tip:new Vector3(0,2,0),heel:new Vector3(),normal:new Vector3()},
      previous,targetPosition:new Vector3(),attackerPosition:new Vector3()});
    for (const key of ['direction','knockback','cutNormal']) {
      assert.ok(result[key].toArray().every(Number.isFinite));
      assert.ok(Math.abs(result[key].length()-1)<1e-10);
    }
  }
});

test('each reference damage descriptor carries its own weapon and correct real hand', () => {
  for (const id of ['dual-dao','tang-dao','great-dao','great-hammer']) for(let combo=0;combo<5;combo++) {
    for(const descriptor of getSourceAttackRule(id,combo).volumes) {
      assert.equal(descriptor.weaponId,id);assert.equal(descriptor.combo,combo);
      assert.equal(descriptor.hand,id==='dual-dao'&&descriptor.emitter==='swing2'?0:1);
    }
  }
});
