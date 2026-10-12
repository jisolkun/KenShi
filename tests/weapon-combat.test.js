import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { WEAPONS } from '../src/weapons.js';
import { weaponStrikeContains as contains } from '../src/weaponCombat.js';
import { SOURCE_WEAPON_BINDINGS } from '../src/sourceMotion/catalogue.js';
import { createSourceAttackVolumes, advanceSourceAttackVolumes,
  getSourceAttackRule, sourceVolumeGeometry, sourceVolumeContains } from '../src/sourceMotion/combat.js';

const root = (x = 0, z = 0, facing = 0) => ({ pos: new Vector3(x, 0, z), facing });
const target = (x, z, y = 0, radius = .3) => ({ pos: new Vector3(x, y, z), radius, colliderHeight: .9 });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${actual} differs from ${expected}`);

test('all twenty equipped attacks hit a forward enemy during their actual source emitter clocks', () => {
  assert.equal(WEAPONS.length, 4);
  for (const weapon of WEAPONS) {
    assert.equal(weapon.moves.length, 5, weapon.id);
    for (const [combo, move] of weapon.moves.entries()) {
      assert.equal(move.sourceMotion, true);
      const volumes = createSourceAttackVolumes(weapon.id, combo, SOURCE_WEAPON_BINDINGS[weapon.id].atkspd);
      assert.ok(volumes.length > 0);
      assert.ok(volumes.every(volume => !volume.clock.visible && !volume.clock.colliding),
        'the windup cannot damage a victim');
      const actor = root(), victim = target(0, 1.55, 0, .45);
      let hit = false, activeFrames = 0, finished = false;
      for (let frame = 0; frame < 150; frame++) {
        const event = advanceSourceAttackVolumes(volumes, .02, actor);
        for (const volume of event.active) {
          activeFrames++;
          assert.equal(volume.clock.visible, true);
          assert.equal(volume.clock.colliding, true);
          if (volume.descriptor.type !== 'splash') assert.ok([1, 2].includes(volume.clock.frame));
          hit ||= sourceVolumeContains(volume, victim, actor);
        }
        if (event.finished) { finished = true; break; }
      }
      assert.ok(activeFrames > 0, `${weapon.id}/${combo}: native contact frames exist`);
      assert.ok(hit, `${weapon.id}/${combo}: forward victim lies in an active emitter`);
      assert.ok(finished, `${weapon.id}/${combo}: emitter lifetime ends`);
    }
  }
});

test('normal slash families retain the uploaded sphere sizes and forward offsets', () => {
  const expected = [
    ['dual-dao', 1.7, .75, .85],
    ['tang-dao', 2, .6875, 1],
    ['great-dao', 2, .6875, 1],
    ['great-hammer', 2.6, .75, 1.3],
  ];
  for (const [id, radius, height, forward] of expected) {
    const geometry = sourceVolumeGeometry(getSourceAttackRule(id, 0).volumes[0], root());
    assert.equal(geometry.type, 'sphere', id);
    close(geometry.radius, radius);
    close(geometry.center.x, 0);
    close(geometry.center.y, height);
    close(geometry.center.z, forward);
  }
});

test('sphere contacts use three dimensional source volume boundaries and the enemy body radius', () => {
  for (const weapon of WEAPONS) for (const combo of [0, 1, 2, 3, 4]) {
    const actor = root();
    for (const descriptor of getSourceAttackRule(weapon.id, combo).volumes) {
      const geometry = sourceVolumeGeometry(descriptor, actor);
      if (geometry.type !== 'sphere') continue;
      const { center, radius } = geometry, bodyRadius = .3;
      // Position the enemy body centre at the source emitter height. Sweep
      // each world axis so vertical separation cannot become a ground disk.
      for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
        const inside = center.clone(), outside = center.clone();
        inside[axis] += sign * (radius + bodyRadius - .001);
        outside[axis] += sign * (radius + bodyRadius + .001);
        assert.equal(sourceVolumeContains(descriptor,
          target(inside.x, inside.z, inside.y - .9, bodyRadius), actor), true,
        `${weapon.id}/${combo}/${descriptor.emitter}: ${axis} contact overlaps`);
        assert.equal(sourceVolumeContains(descriptor,
          target(outside.x, outside.z, outside.y - .9, bodyRadius), actor), false,
        `${weapon.id}/${combo}/${descriptor.emitter}: ${axis} separation misses`);
      }
    }
  }
});

test('source slash damage can reach beside and behind its root inside the sphere', () => {
  for (const id of ['dual-dao', 'tang-dao', 'great-dao', 'great-hammer']) {
    const slash = getSourceAttackRule(id, 0).volumes[0];
    assert.equal(sourceVolumeContains(slash, target(0, -.7), root()), true, id);
    assert.equal(sourceVolumeContains(slash, target(1.7, .8), root()), true, id);
    assert.equal(sourceVolumeContains(slash, target(0, -2), root()), false, id);
    assert.equal(sourceVolumeContains(slash, target(0, 1, 5), root()), false, id);
  }
});

test('fourth blade attack uses the original long narrow capsule instead of a cutting arc', () => {
  for (const id of ['tang-dao', 'great-dao']) {
    const thrust = getSourceAttackRule(id, 3).volumes[0];
    const geometry = sourceVolumeGeometry(thrust, root());
    assert.equal(geometry.type, 'capsule', id);
    close(geometry.radius, .125);
    assert.equal(sourceVolumeContains(thrust, target(0, 5), root()), true, id);
    assert.equal(sourceVolumeContains(thrust, target(.7, 5), root()), false, id);
    assert.equal(sourceVolumeContains(thrust, target(0, -2), root()), false, id);
    assert.equal(sourceVolumeContains(thrust, target(0, 7.3), root()), false, id);
  }
});

test('all source emitter collision geometry rotates and translates with its root', () => {
  const yaw = .8, actor = root(4, -3, yaw);
  const rotate = victim => {
    const p = victim.pos.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw).add(actor.pos);
    return { ...victim, pos: p };
  };
  for (const weapon of WEAPONS) for (let combo = 0; combo < 5; combo++) {
    for (const descriptor of getSourceAttackRule(weapon.id, combo).volumes) {
      for (const victim of [target(0, 1.55), target(-.8, -.7), target(1.2, 2.2), target(8, 8), target(0, 1, 5)]) {
        assert.equal(sourceVolumeContains(descriptor, rotate(victim), actor),
          sourceVolumeContains(descriptor, victim, root()), `${weapon.id}/${combo}/${descriptor.emitter}`);
      }
    }
  }
});

// This utility remains available for other actors. Explicit synthetic moves
// cover its contract without treating those arcs as the hero's damage model.
const point = (distance, angle) => [Math.sin(angle) * distance, Math.cos(angle) * distance];
const strike = (move, distance, angle, facing = 0, radius = 0) =>
  contains(move, ...point(distance, angle), facing, radius);
const fixtures = ['arc', 'hook', 'chain', 'radial', 'crush', 'thrust'].map(shape =>
  ({ shape, reach: 2, width: .3, halfAngle: shape === 'radial' ? Math.PI : .9 }));

test('generic strike utility retains bounded reach, radial coverage and narrow thrust corridors', () => {
  for (const move of fixtures) {
    assert.equal(strike(move, 1.6, 0), true, move.shape);
    assert.equal(strike(move, 2.01, 0), false, move.shape);
    assert.equal(strike(move, 2.2, 0, 0, .3), true, move.shape);
    assert.equal(strike(move, 2.31, 0, 0, .3), false, move.shape);
  }
  const radial = fixtures.find(move => move.shape === 'radial');
  for (let i = 0; i < 24; i++) assert.equal(strike(radial, 1.8, i * Math.PI / 12), true);
  const thrust = fixtures.find(move => move.shape === 'thrust');
  assert.equal(contains(thrust, .31, 1.2, 0), false);
  assert.equal(contains(thrust, .44, 1.2, 0, .3), true);
  assert.equal(contains(thrust, .54, 1.2, 0, .3), false);
  assert.equal(strike(thrust, 1.5, Math.PI), false);
  assert.equal(strike(thrust, 1.5, Math.PI / 2), false);
});

test('generic angular radius margins and focused crush corridors reject separated targets', () => {
  for (const move of fixtures.filter(move => ['arc', 'hook', 'chain'].includes(move.shape))) {
    assert.equal(strike(move, 1.6, move.halfAngle + .045), false, move.shape);
    assert.equal(strike(move, 1.6, move.halfAngle + .045, 0, .3), true, move.shape);
    assert.equal(strike(move, 2.31, move.halfAngle * .5, 0, .3), false, move.shape);
  }
  const crush = fixtures.find(move => move.shape === 'crush');
  assert.equal(contains(crush, .7, 1.4, 0), false, 'the corridor excludes a point inside its angular sector');
  assert.equal(strike(crush, 1.4, Math.PI), false);
});

test('generic strike utility remains invariant when attacker and victim turn together', () => {
  for (const move of fixtures) for (const radius of [0, .3]) {
    for (const offset of [0, .35, 1.4, Math.PI]) {
      const expected = strike(move, 1.5, offset, 0, radius);
      for (const facing of [-2.7, -.8, .6, 2.4]) {
        assert.equal(strike(move, 1.5, facing + offset, facing, radius), expected, move.shape);
      }
    }
  }
});
