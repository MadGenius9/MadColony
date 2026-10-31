// Balance, 2026-10-31 (docs/proposals/balance-feud-and-hunting.md): the feud between peoples and hunting as food.
import test from 'node:test';
import assert from 'node:assert/strict';
import { meatWanted, MEAT_PER_PERSON, HUNGRY_DAYS, DISTANT_HUNTERS } from '../src/sim/animals.js';
import { OTHER_PEOPLE_RIVALRY } from '../src/sim/war.js';

test('balance: a hungry village hunts for twice the meat; a distant one sends up to two hunters', () => {
  assert.equal(meatWanted(5, 10), MEAT_PER_PERSON * 5);
  assert.equal(meatWanted(1, 10), MEAT_PER_PERSON * 2, 'at least for two');
  assert.equal(meatWanted(5, HUNGRY_DAYS - 0.1), 2 * MEAT_PER_PERSON * 5);
  assert.equal(meatWanted(5, HUNGRY_DAYS), MEAT_PER_PERSON * 5, 'from 3 days of food: as before');
  assert.equal(meatWanted(5, undefined), MEAT_PER_PERSON * 5, 'no plan yet: as before');
  assert.equal(DISTANT_HUNTERS, 2);
});

test('balance: different peoples drift apart faster than kin, by 1.2', () => {
  assert.equal(OTHER_PEOPLE_RIVALRY, 1.2);
});
