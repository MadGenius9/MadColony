// Mood (docs/proposals/mood.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { thoughtsOf, moodTarget, moodLevel, stepToward, tickMood, villageFacts, MOOD } from '../src/sim/mood.js';
import { setCivLaw } from '../src/sim/civlaws.js';
import { explainColonist } from '../src/sim/explain.js';

const ids = (g, c, V) => thoughtsOf(g, c, V).map((t) => t.id);

test('mood: thoughts come from needs, home, food, health and the village; mood moves toward them a tenth an hour', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const c = g.colonists()[0], sid = g.s.playerSettlement;
  assert.ok(Number.isInteger(c.mood), 'everyone has a mood');
  const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
  c.needs[hunger.id] = 0.3;
  assert.ok(ids(g, c).includes('core:hungry'));
  c.needs[hunger.id] = 0.1;
  assert.ok(ids(g, c).includes('core:starving'));
  c.needs[hunger.id] = 0.9;
  c.grief = { until: g.s.tick + 100, for: 'x', work: 0.85 };
  assert.ok(ids(g, c).includes('core:grieving'));
  delete c.grief;
  // Laws: rationing (-3 x 3) for everyone.
  const before = moodTarget(g, c);
  setCivLaw(g, sid, 'core:rationing', 'rationed', '', { force: true });
  assert.equal(moodTarget(g, c), Math.max(-100, before - 9));
  assert.ok(thoughtsOf(g, c).some((t) => t.id === 'core:laws' && t.value === -9));
  // A tenth of the gap an hour, at least 1, settling exactly.
  assert.equal(stepToward(0, 50), 5);
  assert.equal(stepToward(0, 4), 1);
  assert.equal(stepToward(10, 10), 10);
  assert.equal(stepToward(-30, -31), -31);
  assert.equal(moodLevel(25), 'content'); assert.equal(moodLevel(-25), 'unhappy'); assert.equal(moodLevel(-60), 'miserable'); assert.equal(moodLevel(0), 'fine');
  // Shown with reasons.
  const ex = explainColonist(g, c);
  assert.equal(ex.mood.value, c.mood);
  assert.ok(ex.mood.thoughts.length > 0);
  assert.match(g.plans[sid].moodNote || '', /^Mood: /);
});

test('mood: a people\'s own leanings do not upset them; Cheerful and Gloomy shift it by 10', () => {
  const g = newGame({ seed: 4242 });
  const sid = g.s.playerSettlement, c = g.colonists()[0];
  setCivLaw(g, sid, 'core:conscription', 'militia', '', { force: true });
  c.traits = [];
  const hearth = thoughtsOf(g, c).find((t) => t.id === 'core:laws')?.value;
  assert.equal(hearth, -3, 'Hearthfolk dislike a militia');
  g.s.settlements[sid].people = 'core:cragborn';
  for (const p of g.colonists()) p.people = 'core:cragborn';
  assert.equal(thoughtsOf(g, c).find((t) => t.id === 'core:laws'), undefined, 'the Cragborn do not mind their own militia');
  const t0 = moodTarget(g, c);
  c.traits = ['core:cheerful'];
  assert.equal(moodTarget(g, c), Math.min(100, t0 + 10));
  c.traits = ['core:gloomy'];
  assert.equal(moodTarget(g, c), Math.max(-100, t0 - 10));
});

test('mood: saves, loads and mends; an old save starts at the thoughts; distant villages have moods too', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  const t = JSON.parse(serializeGame(g));
  for (const c of Object.values(t.state.colonists)) { delete c.mood; delete c.ate; delete c.rough; }
  t.format = 32;
  const o = loadGame(g.reg, JSON.stringify(t));
  tickMood(o);
  for (const c of o.colonists()) assert.equal(c.mood, moodTarget(o, c, villageFacts(o)[o.s.playerSettlement]), 'starts at its target');
  const bad = JSON.parse(serializeGame(g));
  Object.values(bad.state.colonists)[0].mood = 300;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /invalid mood/);
  // Distant villages.
  const w = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(w, 2);
  const far = Object.keys(w.s.settlements).find((k) => w.s.settlements[k].detail === 'abstract');
  assert.ok(w.owned('colonists', far).every((c) => Number.isInteger(c.mood) && c.mood >= MOOD.min && c.mood <= MOOD.max));
});

// ---- slice 2: effects
import { moodWork, moodBirth, onBreak } from '../src/sim/mood.js';
import { workSpeed } from '../src/sim/ai/jobs.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('mood: happy people work a little faster, miserable ones slower; happier couples have children more often', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const c = g.colonists()[0];
  const at = (m) => { c.mood = m; return workSpeed(g, c, 'core:chop', 'core:woodcutting'); };
  const base = at(0);
  assert.ok(Math.abs(at(50) / base - 1.05) < 1e-9);
  assert.ok(Math.abs(at(-50) / base - 0.85) < 1e-9);
  assert.ok(Math.abs(at(-100) / base - 0.85) < 1e-9, 'no worse than at -50');
  assert.equal(moodWork(0), 1);
  assert.equal(moodBirth({ mood: 100 }, { mood: 100 }), 1.25);
  assert.equal(moodBirth({ mood: -100 }, { mood: -100 }), 0.75);
  assert.equal(moodBirth({ mood: 0 }, {}), 1);
});

test('mood: a miserable person sometimes stops work for 3 hours, sulking; the break saves and loads', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const c = g.colonists()[0];
  let day = Math.floor(g.s.tick / TICKS_PER_DAY) + 1;
  for (let k = 0; k < 30 && !onBreak(g, c); k++, day++) {
    while (g.s.tick < day * TICKS_PER_DAY + 9 * (TICKS_PER_DAY / 24) - 1) g.tick();
    c.mood = -90;
    g.tick(); // this tick reaches 09:00, where the hourly mood pass may start a break
  }
  assert.ok(onBreak(g, c), 'a break came within 30 days of misery');
  assert.match(g.s.log.map((e) => e.msg).join('\n'), new RegExp(`${c.name} is miserable and stops work`));
  for (let t = 0; t < 60; t++) { g.tick(); if (onBreak(g, c)) assert.ok(!(c.job?.workType && !c.job.need && c.job.type !== 'slay'), `no work while on a break (${c.job?.type})`); }
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  assert.equal(onBreak(g, c), false, 'over within the day');
});
