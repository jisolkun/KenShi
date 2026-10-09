import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/weapons.js';
import { weaponStrikeContains as contains } from '../src/weaponCombat.js';

const moves = WEAPONS.flatMap(weapon => weapon.moves.map((move, index) => ({ weapon, move, index })));
const point = (distance, angle) => [Math.sin(angle) * distance, Math.cos(angle) * distance];
const strike = (move, distance, targetAngle, facing = 0, radius = 0) => contains(move, ...point(distance, targetAngle), facing, radius);

test('all twelve basic attacks hit forward inside their authored reach', () => {
  assert.equal(moves.length, 12);
  for (const {weapon, move, index} of moves) {
    assert.equal(strike(move, move.reach * .8, 0), true, `${weapon.id}/${index}`);
  }
});

test('all moves reject targets beyond reach and the enemy radius', () => {
  for (const {weapon, move, index} of moves) {
    assert.equal(strike(move, move.reach + .01, 0), false, `${weapon.id}/${index}`);
    assert.equal(strike(move, move.reach + .36, 0, 0, .35), false, `${weapon.id}/${index} radius`);
    assert.equal(strike(move, move.reach + .20, 0, 0, .35), true, `${weapon.id}/${index} overlap`);
  }
});

test('thrusts are narrow and reject rear and side targets', () => {
  for (const {weapon, move} of moves.filter(({move}) => move.shape === 'thrust')) {
    assert.equal(contains(move, move.width * .9, move.reach * .6, 0), true, weapon.id);
    assert.equal(contains(move, move.width + .02, move.reach * .6, 0), false, weapon.id);
    assert.equal(strike(move, move.reach * .5, Math.PI), false, weapon.id);
    assert.equal(strike(move, move.reach * .75, Math.PI / 2), false, weapon.id);
    assert.equal(contains(move, move.width + .14, move.reach * .6, 0, .3), true, `${weapon.id} side margin`);
    assert.equal(contains(move, move.width + .24, move.reach * .6, 0, .3), false, `${weapon.id} outside side margin`);
  }
});

test('radial moves hit the full circle within reach', () => {
  const radial = moves.filter(({move}) => move.shape === 'radial');
  assert.ok(radial.length > 0);
  for (const {weapon, move} of radial) {
    for (let i = 0; i < 24; i++) assert.equal(strike(move, move.reach * .9, i * Math.PI / 12), true, weapon.id);
  }
});

test('crush moves require a focused forward corridor', () => {
  for (const {weapon, move} of moves.filter(({move}) => move.shape === 'crush')) {
    assert.equal(strike(move, move.reach * .7, 0), true, weapon.id);
    assert.equal(strike(move, move.reach * .7, Math.PI), false, weapon.id);
    const side = move.width + .34;
    // The lateral corridor rejects even targets inside the authored angular sector.
    const along = Math.min(move.reach * .7, side / Math.tan(move.halfAngle * .7));
    if (Math.hypot(side, along) < move.reach) assert.equal(contains(move, side, along, 0), false, weapon.id);
  }
});

test('enemy radius expands angular arc and hook margins without extending unlimited range', () => {
  for (const {weapon, move} of moves.filter(({move}) => ['arc','hook','chain'].includes(move.shape))) {
    const distance = move.reach * .8;
    const offset = move.halfAngle + .045;
    assert.equal(strike(move, distance, offset), false, weapon.id);
    assert.equal(strike(move, distance, offset, 0, .3), true, `${weapon.id} angular margin`);
    assert.equal(strike(move, move.reach + .31, move.halfAngle * .5, 0, .3), false, `${weapon.id} range limit`);
  }
});

test('collision is invariant under facing and target rotation including radius margins', () => {
  for (const {weapon, move, index} of moves) {
    for (const radius of [0, .3]) {
      for (const offset of [0, .35, 1.4, Math.PI]) {
        const distance = move.reach * .75;
        const expected = strike(move, distance, offset, 0, radius);
        for (const facing of [-2.7, -.8, .6, 2.4]) {
          assert.equal(strike(move, distance, facing + offset, facing, radius), expected, `${weapon.id}/${index} facing ${facing}`);
        }
      }
    }
  }
});
