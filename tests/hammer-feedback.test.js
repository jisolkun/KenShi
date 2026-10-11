import assert from 'node:assert/strict';
import test from 'node:test';
import {getHammerFeedback, hammerReactionDirection, hammerWakeActive,
  hammerContactAccent} from '../src/hammerFeedback.js';
import {getReviewedAttack} from '../src/choreography/index.js';
import {createCharacter, poseCharacter} from '../src/characters.js';

test('hammer wake requires measured head velocity during release instead of illuminating its carry', () => {
  for (let combo = 0; combo < 4; combo++) {
    const action = getReviewedAttack('great-hammer', combo), [release, finish] = action.swing;
    assert.equal(hammerWakeActive(action, (release + finish) / 2, 8), true);
    assert.equal(hammerWakeActive(action, release - .001, 8), false);
    assert.equal(hammerWakeActive(action, finish + .001, 8), false);
    assert.equal(hammerWakeActive(action, action.contact, .5), false,
      'a held hammer receives no motion streak simply because its attack clock is active');
    for (const speed of [0, -4, NaN, Infinity])
      assert.equal(hammerWakeActive(action, action.contact, speed), false);
  }
  assert.equal(hammerWakeActive(null, .5, 8), false);
});

test('the measured hammer direction drives horizontal knockback and vertical hits use the victim escape direction', () => {
  const descending = hammerReactionDirection({x:3,y:-12,z:4});
  assert.deepEqual(descending, {x:.6,y:0,z:.8});
  const ascending = hammerReactionDirection({x:-3,y:12,z:4});
  assert.deepEqual(ascending, {x:-.6,y:0,z:.8});
  assert.deepEqual(hammerReactionDirection({x:0,y:-20,z:0},{x:-4,z:0}), {x:-1,y:0,z:0});
  assert.deepEqual(hammerReactionDirection({x:NaN,y:Infinity,z:NaN},{x:0,z:0}), {x:0,y:0,z:1});
});

test('one hammer stroke applies a bounded contact pause even when its head meets a crowd', () => {
  assert.equal(hammerContactAccent(.04), .04);
  const first = hammerContactAccent(.4);
  assert.ok(first > 0 && first <= .07, 'the pause has a perceptible but bounded duration');
  assert.equal(hammerContactAccent(.4, true), 0, 'a second victim cannot stack the same stroke pause');
  for (const duration of [-1, NaN, Infinity]) assert.equal(hammerContactAccent(duration), 0);
});

test('hammer contacts have distinct compact accents and the terminal smash carries the strongest low transient', () => {
  const profiles = [0,1,2,3].map(getHammerFeedback);
  assert.equal(new Set(profiles.map(profile=>profile.hitTone)).size, 4);
  assert.ok(profiles[3].hitTone < Math.min(...profiles.slice(0,3).map(profile=>profile.hitTone)));
  assert.ok(profiles[3].cameraGain > Math.max(...profiles.slice(0,3).map(profile=>profile.cameraGain)));
  assert.ok(profiles[1].impactLife < profiles[2].impactLife,
    'the compact upward follow-up clears sooner than the wide body sweep');
  for (const profile of profiles) {
    assert.ok(Math.hypot(...profile.coreScale) * 2 < .6, 'contact cores remain small compared with the weapon');
    assert.ok(profile.wakeLife <= .12, 'the hammer wake clears quickly after the measured head moves');
    assert.ok(profile.impactLife <= .25, 'contacts cannot become a persistent broad damage-looking cloud');
  }
  assert.equal(getHammerFeedback(-1), profiles[3]);
  assert.equal(getHammerFeedback(5), profiles[1]);
});

test('actual victims lift under a rising hammer, fold under a falling hammer and keep their ordinary hurt pose', () => {
  for (const type of ['grunt', 'brute']) {
    const pose = options => {
      const rig=createCharacter(type);
      poseCharacter(rig,{state:'hurt',phase:.12,hurtDirection:0,time:0,
        immediate:true,transition:false,...options});
      rig.group.updateMatrixWorld(true);
      rig.group.traverse(node=>assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
      return {height:rig.body.position.y,bodyPitch:rig.body.rotation.x,chestPitch:rig.chest.rotation.x};
    };
    const ordinary=pose({hurtStrength:1});
    assert.deepEqual(pose({hurtStrength:1.5}),ordinary,
      'an ordinary weapon retains its existing reaction strength ceiling');
    assert.deepEqual(pose({hurtStrength:1,hurtVertical:NaN}),ordinary,
      'a missing physical vertical direction must not corrupt the victim pose');
    const blunt=pose({hurtStrength:1.5,hurtBlunt:true});
    assert.ok(Math.abs(blunt.bodyPitch)>Math.abs(ordinary.bodyPitch),
      'the actual blunt contact gives the victim a stronger stagger');
    const rising=pose({hurtStrength:1.3,hurtBlunt:true,hurtVertical:.8});
    const falling=pose({hurtStrength:1.3,hurtBlunt:true,hurtVertical:-.8});
    assert.ok(rising.height>falling.height+.03,`${type}: the rising hit lifts while the descending hit compresses`);
    assert.ok(rising.bodyPitch<falling.bodyPitch&&rising.chestPitch<falling.chestPitch,
      `${type}: the torso reacts to the measured vertical head travel`);
  }
});
