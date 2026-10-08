import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarrior, createEnemy } from '../src/characters.js';
import { animateCharacter } from '../src/animation.js';

// These checks measure rendered geometry and world-space foot contacts rather
// than comparing the animator's authored angles with copies of those angles.
const bounds = new THREE.Box3();
const dt = 1 / 120;
const actions = { attack: .42, heavy: .83, roll: .48, whirl: .92, burst: 1.12, dash: .48, finisher: .8, frost: .68, blades: .56 };
for (const [type, duration] of Object.entries(actions)) {
  for (const step of type === 'attack' ? [0, 1, 2] : [0]) {
    const model = createWarrior();
    const clipDuration = type === 'attack' ? [.42, .45, .6][step] : duration;
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
