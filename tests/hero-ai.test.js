import assert from 'node:assert/strict';
import test from 'node:test';
import { isCombatTarget, attackDistances, chooseAttackTarget, attackCanTrack,
  attackRecoveryPhase, attackChainPhase, planObstaclePath, projectWalkablePoint, segmentClear } from '../src/heroAI.js';
import { getWeapon } from '../src/weapons.js';
import { getReviewedAttack } from '../src/choreography/index.js';
import { createCharacter, poseCharacter } from '../src/characters.js';
import { bladeSweepContains, weaponStrikeContains } from '../src/weaponCombat.js';

const enemy = (id, x, z, state = 'idle') => ({ id, pos: { x, z }, radius: .45, hp: 100, state });
const weapon = getWeapon('dual-dao');
const decision = (enemies, options = {}) => chooseAttackTarget({
  position: { x: 0, z: 0 }, enemies, move: weapon.moves[0], ...options,
});

test('manual enemy selection stays stable when another enemy moves closer', () => {
  const locked = enemy(1, 0, 1.8), closer = enemy(2, 0, .9);
  assert.equal(decision([closer, locked], { manualTarget: locked }), locked);
  locked.pos.z = 8;
  assert.equal(decision([closer, locked], { manualTarget: locked }), closer,
    'the incidental strike stays on the pursuit route without replacing the selected enemy');
  assert.equal(locked.pos.z, 8, 'the original pursuit command remains intact');
});

test('pursuit slashes reachable enemies along its route without detouring to side or rear enemies', () => {
  const locked=enemy(1,0,8), along=enemy(2,.2,1.4), side=enemy(3,1.3,.2), rear=enemy(4,0,-.8);
  assert.equal(decision([locked,side,rear,along],{manualTarget:locked}),along);
  assert.equal(decision([locked,side,rear],{manualTarget:locked}),null);
  assert.equal(decision([locked,side,rear,along],{manualTarget:locked,previousTarget:side}),along);
  assert.equal(decision([locked,along],{manualTarget:locked,moving:true}),null,
    'a new walking or retreat command still takes priority');
});

test('automatic combat only selects reachable nearby enemies and creates no pursuit command', () => {
  const distant = enemy(1, 0, 5), nearby = enemy(2, .2, 1.4);
  assert.equal(decision([distant]), null);
  const before = JSON.stringify(nearby);
  assert.equal(decision([distant, nearby]), nearby);
  assert.equal(JSON.stringify(nearby), before, 'selection does not mutate enemy or issue a command');
  assert.equal(decision([nearby], { moving: true }), null, 'walking commands win over automatic attacks');
  assert.equal(decision([nearby], { disengage: .2 }), null, 'a roll keeps its disengage interval');
  assert.equal(decision([nearby], { cooldown: .1 }), null, 'a recovery movement command gets time to move');
});

test('dead, spawning, removed and invalid targets clear before chaining to a nearby survivor', () => {
  const dead = enemy(1, 0, .8, 'dead'), spawning = enemy(2, 0, .9, 'spawn');
  const alive = enemy(3, 0, 1.3), removed = enemy(4, 0, 1);
  assert.equal(decision([dead, spawning, alive], { manualTarget: dead, previousTarget: dead }), alive);
  assert.equal(isCombatTarget(removed, [alive]), false);
  assert.equal(decision([alive], { manualTarget: removed, previousTarget: removed }), alive);
  assert.equal(isCombatTarget({ ...alive, hp: 0 }), false);
  assert.equal(isCombatTarget({ ...alive, pos: { x: NaN, z: 0 } }), false);
});

test('small target drift preserves an existing combo while an initial attack uses its tighter range', () => {
  const range = attackDistances(weapon.moves[0], .45);
  const drifting = enemy(1, 0, (range.enter + range.retain) / 2);
  assert.equal(decision([drifting]), null);
  assert.equal(decision([drifting], { previousTarget: drifting }), drifting);
  drifting.pos.z = range.retain + .01;
  assert.equal(decision([drifting], { previousTarget: drifting }), null);
  assert.ok(range.stop < range.enter && range.enter < range.retain);
});

test('automatic combat does not attack through solid circular props', () => {
  const blocked = enemy(1, 0, 1.3), visible = enemy(2, 1.2, .3);
  assert.equal(decision([blocked, visible], { obstacles: [{ x: 0, z: .65, radius: .22 }] }), visible);
});

test('facing tracks the windup and remains fixed through every contact of a stroke', () => {
  const move = { active: [.3, .7] };
  assert.equal(attackCanTrack(.2, move), true);
  for (const phase of [.3, .5, .7]) assert.equal(attackCanTrack(phase, move), false);
  assert.equal(attackCanTrack(.8, move), true);
  const twoContacts = { contacts: [{ window: [.25, .4] }, { window: [.55, .7] }] };
  assert.equal(attackCanTrack(.48, move, twoContacts), false, 'root cannot pivot between two physical contacts');
});

test('great dao retains its authored recovery and completes each stroke before chaining', () => {
  for (let combo = 0; combo < 4; combo++) {
    const move = getWeapon('great-dao').moves[combo];
    assert.equal(attackRecoveryPhase(move, getReviewedAttack('great-dao', combo)), move.recoverAt);
    assert.equal(attackChainPhase('great-dao', combo), 1);
  }
  assert.equal(attackChainPhase('dual-dao', 0), .9);
  assert.equal(attackChainPhase('tang-dao', 3), .96);
});

test('pursuit detours around consecutive pillars and reaches the command without colliding', () => {
  const start = { x: -5, z: 0 }, end = { x: 5, z: 0 };
  const obstacles = [{ x: -1.5, z: 0, radius: 1 }, { x: 1.5, z: .5, radius: 1.2 }];
  const clearance = .5;
  const path = planObstaclePath(start, end, obstacles, clearance,
    { minX: -6, maxX: 6, minZ: -4, maxZ: 4 });
  assert.ok(path.length > 1, 'pursuit needs an actual detour');
  let current = start;
  for (const waypoint of path) {
    const steps = Math.ceil(Math.hypot(waypoint.x - current.x, waypoint.z - current.z) / .04);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = current.x + (waypoint.x - current.x) * t;
      const z = current.z + (waypoint.z - current.z) * t;
      for (const obstacle of obstacles) assert.ok(
        Math.hypot(x - obstacle.x, z - obstacle.z) >= obstacle.radius + clearance - 1e-6,
        'each simulated step remains outside the collision radius');
      assert.ok(x >= -5.5 && x <= 5.5 && z >= -3.5 && z <= 3.5);
    }
    current = waypoint;
  }
  assert.deepEqual(current, end);
  assert.deepEqual(planObstaclePath(start, { x: -1.5, z: 0 }, obstacles, clearance), [],
    'an impossible endpoint must not send the hero straight into the pillar');
});

test('AI attack distances place every equipped weapon inside its real damaging path', () => {
  for (const id of ['dual-dao', 'tang-dao', 'great-dao']) {
    const rig = createCharacter('hero');
    rig.setWeapon(id);
    for (let combo = 0; combo < 4; combo++) {
      const move = getWeapon(id).moves[combo], action = getReviewedAttack(id, combo);
      const radius = .45, distances = attackDistances(move, radius, !!action);
      const target = { x: 0, z: distances.retain, minY: .18, maxY: 1.85 };
      if (!action) {
        assert.ok(weaponStrikeContains(move, target.x, target.z, 0, radius), `${id} ${combo}: stopping range is hittable`);
        continue;
      }
      let hit = false, previous = null;
      for (let frame = 0; frame <= Math.ceil(move.duration * 60); frame++) {
        const phase = Math.min(1, frame / (move.duration * 60));
        poseCharacter(rig, { state: 'attack', combo, phase, speed: 0, attackCarry: 0,
          time: 0, dt: 1 / 60, immediate: true, transition: false });
        rig.group.updateMatrixWorld(true);
        const blades = rig.weaponBlades();
        for (const contact of action.contacts) {
          if (phase < contact.window[0] || phase > contact.window[1]) continue;
          const blade = blades.find(blade => blade.hand === contact.hand);
          const prior = previous?.phase >= contact.window[0]
            ? previous.blades.find(blade => blade.hand === contact.hand) : null;
          hit ||= bladeSweepContains(blade, prior, target, radius, action.width * .5);
        }
        previous = { phase, blades };
      }
      assert.ok(hit, `${id} ${combo}: AI must start inside the physical blade sweep`);
    }
  }
});

test('commands beside edge lanterns stay inside the map and remain reachable', () => {
  const bounds = { minX: -17, maxX: 17, minZ: -15, maxZ: 15 };
  const obstacles = [{ x: 15.9, z: -7, radius: .57 }, { x: -15.9, z: -7, radius: .57 }];
  for (const sign of [-1, 1]) {
    const endpoint = projectWalkablePoint({ x: sign * 17, z: -7 }, obstacles, .5, bounds);
    assert.ok(endpoint.x >= -16.5 && endpoint.x <= 16.5);
    assert.ok(endpoint.z >= -14.5 && endpoint.z <= 14.5);
    assert.ok(segmentClear(endpoint, endpoint, obstacles, .5), 'endpoint clears both props');
    const path = planObstaclePath({ x: 0, z: 4 }, endpoint, obstacles, .5, bounds);
    assert.ok(path.length, 'the projected edge command has a valid route');
    assert.deepEqual(path.at(-1), endpoint);
  }
});
