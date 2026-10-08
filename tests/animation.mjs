import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarrior, createEnemy } from '../src/characters.js';
import { animateCharacter } from '../src/animation.js';
import { ACTION_CLIPS, COMBO_CLIPS, getActionClip } from '../src/action-clips.js';

// These checks measure rendered geometry and world-space foot contacts rather
// than comparing the animator's authored angles with copies of those angles.
const bounds = new THREE.Box3();
const dt = 1 / 120;
for (const type of Object.keys(ACTION_CLIPS)) {
  for (const step of type === 'attack' ? COMBO_CLIPS.map((_, index) => index) : [0]) {
    const model = createWarrior();
    const clipDuration = getActionClip(type, step).duration;
    const action = { type, duration: clipDuration, age: 0, step };
    let lowest = Infinity;
    for (let frame = 0; frame <= Math.ceil(clipDuration / dt); frame++) {
      action.age = Math.min(clipDuration, frame * dt);
      model.rotation.y = 0;
      animateCharacter(model, 0, action, frame * dt, dt, true);
      model.updateMatrixWorld(true);
      for (const joint of Object.values(model.userData.rig)) {
        assert([...joint.position, ...joint.quaternion].every(Number.isFinite), `${type} has a finite ${joint.name} transform`);
      }
      model.traverse(object => {
        if (object.isMesh) lowest = Math.min(lowest, bounds.setFromObject(object).min.y);
      });
    }
    assert(lowest >= -.015, `${type} ${step} must keep body, cloth and blade above the floor (lowest ${lowest.toFixed(4)})`);
  }
}
console.log('PASS all 11 attack/skill clips: finite joints and floor clearance throughout the complete animation');

// Carry the real articulated state across combo cuts and interrupted skills.
// Fresh models alone cannot reveal a blade crossing the floor during a blend.
for (const rate of [30, 60, 120]) {
  const model = createWarrior();
  model.rotation.y = .35;
  const frameDt = 1 / rate;
  let time = 0;
  const sequence = [
    ['attack', 0, COMBO_CLIPS[0].comboOpen], ['attack', 1, COMBO_CLIPS[1].comboOpen], ['attack', 2, 1],
    ['roll', 0, .75], ['dash', 0, 1], ['heavy', 0, 1], ['frost', 0, 1],
    ['blades', 0, 1], ['whirl', 0, 1], ['burst', 0, 1], ['finisher', 0, 1],
  ];
  for (let frame = 0; frame < rate; frame++) {
    time += frameDt;
    animateCharacter(model, 0, null, time, frameDt, true);
  }
  const previousAnkles = Object.fromEntries(['left', 'right'].map(side =>
    [side, model.userData.rig[`${side}Foot`].getWorldPosition(new THREE.Vector3())]));
  for (const [type, step, end] of sequence) {
    const clip = getActionClip(type, step);
    const action = { type, step, duration: clip.duration, age: 0 };
    while (action.age < clip.duration * end) {
      const stepDt = Math.min(frameDt, clip.duration * end - action.age);
      action.age += stepDt;
      time += stepDt;
      model.rotation.y = .35;
      animateCharacter(model, 0, action, time, stepDt, true);
      model.updateMatrixWorld(true);
      assert([...model.position, ...model.quaternion].every(Number.isFinite), `${type} root stays finite at ${rate} Hz`);
      for (const joint of Object.values(model.userData.rig)) {
        assert([...joint.position, ...joint.quaternion].every(Number.isFinite), `${type} ${joint.name} stays finite through a ${rate} Hz transition`);
      }
      assert(bounds.setFromObject(model).min.y >= -.015, `${type} transition must clear the floor at ${rate} Hz`);
      for (const side of ['left', 'right']) {
        const ankle = model.userData.rig[`${side}Foot`].getWorldPosition(new THREE.Vector3());
        if (type === 'attack') {
          // Allow a quick lifted step; reject a contact switching to the new
          // lunge lead in one frame before the articulated legs can follow.
          const travel = ankle.distanceTo(previousAnkles[side]);
          assert(travel <= stepDt * 12 + .01,
            `combo ${step} ${side} ankle must transfer continuously at ${rate} Hz (travel ${travel.toFixed(3)}m)`);
        }
        previousAnkles[side].copy(ankle);
      }
    }
  }
}
console.log('PASS continuous combo and interrupted skill sequences at 30, 60 and 120 Hz: ankle continuity, finite transforms and floor clearance');

// Check the rendered palm against the physical handle at the decisive cut.
// A reachable IK target alone does not prove the support hand grips the dao.
for (const [type, step] of [['heavy', 0], ['burst', 0], ['attack', 2]]) {
  const model = createWarrior();
  const clip = getActionClip(type, step);
  const action = { type, step, duration: clip.duration, age: 0 };
  const contactAge = clip.duration * clip.contact;
  let time = 0;
  while (time < contactAge) {
    const frameDt = Math.min(dt, contactAge - time);
    time += frameDt;
    action.age = time;
    model.rotation.y = 0;
    animateCharacter(model, 0, action, time, frameDt, true);
  }
  model.updateMatrixWorld(true);
  const { leftHand, weapon } = model.userData.rig;
  const palm = leftHand.localToWorld(new THREE.Vector3(0, -.026, -.010));
  weapon.worldToLocal(palm);
  const handleDistance = Math.hypot(palm.x, palm.z, Math.max(0, -.16 - palm.y, palm.y - .13));
  assert(handleDistance < .055, `${type} support palm must hold the physical handle (gap ${handleDistance.toFixed(3)}m)`);
}
console.log('PASS two-handed combo finish, heavy cut and jump crash: support palm stays on the physical handle');

for (const type of ['hero', 'soldier', 'brute', 'archer']) {
  const model = type === 'hero' ? createWarrior() : createEnemy(type);
  const speed = type === 'hero' ? 5.6 : 2.2;
  const previous = {};
  let contacts = 0;
  for (let frame = 0; frame < 240; frame++) {
    model.position.z += speed * dt;
    model.rotation.y = 0;
    animateCharacter(model, 1, null, frame * dt, dt, type === 'hero', { type, mode: 'chase' });
    model.updateMatrixWorld(true);
    for (const side of ['left', 'right']) {
      const foot = model.userData.rig[`${side}Foot`];
      assert(foot, `${type} has an articulated ankle`);
      const contact = model.userData.motion.feet[side];
      const position = foot.getWorldPosition(new THREE.Vector3());
      if (contact.planted && previous[side]?.planted) {
        assert(position.distanceTo(previous[side].position) < .004, `${type} ${side} planted foot must not skate`);
        assert(bounds.setFromObject(foot).min.y > -.003, `${type} sole must stay above the ground`);
        contacts++;
      }
      previous[side] = { position, planted: contact.planted };
    }
  }
  assert(contacts > 80, `${type} must have repeated support phases`);
}
console.log('PASS hero, soldier, brute and archer: repeated planted contacts stay within 4 mm per frame');

const first = createWarrior(), second = createWarrior();
assert.equal(first.userData.rig.weapon.parent, first.userData.rig.rightHand, 'The sword must follow the gripping wrist');
assert.notEqual(first.userData.rig.rightHand, second.userData.rig.rightHand, 'Character joints are independent');
const firstMesh = first.getObjectByName('body-cloth'), secondMesh = second.getObjectByName('body-cloth');
assert.equal(firstMesh.geometry, secondMesh.geometry, 'Archetype geometry remains shared');
assert(first.userData.rig.capeTail && first.userData.rig.scarfTip, 'Cloth has independent secondary joints');
console.log('PASS independent wrists/ankles/cloth and shared archetype geometry');
