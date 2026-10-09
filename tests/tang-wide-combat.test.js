import assert from 'node:assert/strict';
import test from 'node:test';
import {createCharacter, poseCharacter} from '../src/characters.js';
import {getReviewedAttack} from '../src/choreography/index.js';
import {bladeSweepContains} from '../src/weaponCombat.js';

// Check actual rendered geometry against enemies spread across the front.
// Metadata reach or a wide decorative effect cannot satisfy these checks.
for (const combo of [0, 1]) {
  test(`Tang broad slash ${combo + 1} reaches enemies on both flanks`, () => {
    const rig = createCharacter('hero');
    rig.setWeapon('tang-dao');
    const action = getReviewedAttack('tang-dao', combo);
    const targets = [-65, 0, 65].map(degrees => {
      const angle = degrees * Math.PI / 180;
      return {x: Math.sin(angle) * 1.4, z: Math.cos(angle) * 1.4, minY: .18, maxY: 1.85};
    });
    const hit = new Set();
    let previous = null;
    for (let frame = 0; frame <= Math.ceil(action.duration * 60); frame++) {
      const phase = Math.min(1, frame / (action.duration * 60));
      poseCharacter(rig, {state: 'attack', combo, phase, time: frame / 60,
        dt: 1 / 60, immediate: true, transition: false});
      const blade = rig.weaponBlades()[0];
      if (!action.contacts.some(c => phase >= c.start && phase <= c.end)) {
        previous = null;
        continue;
      }
      targets.forEach((target, index) => {
        if (bladeSweepContains(blade, previous, target, .22, action.width / 2)) hit.add(index);
      });
      previous = blade;
    }
    assert.equal(hit.size, targets.length, 'the physical blade must sweep left, center, and right enemies');
  });
}

test('Tang low carry preserves breathing and the travelling foot gait', () => {
  const rig = createCharacter('hero');
  rig.setWeapon('tang-dao');
  const ribs = [], chestHeights = [], bladeHeights = [], ankles = [];
  for (let frame = 0; frame < 360; frame++) {
    poseCharacter(rig, {state: 'idle', speed: 0, time: frame / 60, dt: 1 / 60,
      immediate: true, transition: false});
    ribs.push(rig.ribcage.scale.z);
    chestHeights.push(rig.chest.position.y);
    bladeHeights.push(rig.weaponTips()[0].y);
  }
  const spread = values => Math.max(...values) - Math.min(...values);
  assert.ok(spread(ribs) > .04, 'the ribcage must expand with the breath');
  assert.ok(spread(chestHeights) > .03, 'the torso must follow the breath');
  assert.ok(spread(bladeHeights) > .02, 'the connected blade must follow that breath');
  for (let frame = 0; frame < 120; frame++) {
    poseCharacter(rig, {state: 'run', speed: 1, moveBlend: 1,
      time: 6 + frame / 60, dt: 1 / 60, gaitPhase: frame / 60 * Math.PI * 4,
      immediate: true, transition: false});
    ankles.push(...rig.legs.map(leg => leg.foot.getWorldPosition(rig.group.position.clone()).y));
  }
  assert.ok(spread(ankles) > .08, 'running must lift and land the feet instead of freezing the legs');
});

test('Tang stepping and recovery retain a grounded support foot', () => {
  const rig = createCharacter('hero');
  rig.setWeapon('tang-dao');
  for (const state of ['attack']) {
    for (let action = 0; action < 4; action++) {
      const spec = getReviewedAttack('tang-dao', action, state);
      for (let frame = 0; frame <= Math.ceil(spec.duration * 60); frame++) {
        poseCharacter(rig, {state, combo: action, skill: action,
          phase: Math.min(1, frame / (spec.duration * 60)), time: frame / 60,
          immediate: true, transition: false});
        const height = Math.min(...rig.legs.map(leg => leg.foot.getWorldPosition(rig.group.position.clone()).y));
        assert.ok(Math.abs(height - .075) < 1e-5, `${state} ${action}, frame ${frame}: support lost`);
      }
    }
  }
});
