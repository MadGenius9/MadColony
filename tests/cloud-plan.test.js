// Phase 9, slice 6: the settlement plan explains its choices (docs/proposals/phase-9-livestock.md; owner,
// 2026-11-04: "you pick"): each new building site and field records why it was chosen; pens keep away from homes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload } from './cloud-helpers.js';
import { pensOf, PEN } from '../src/sim/pens.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('plan: every new building site and field says why it was chosen; saved and loaded', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const sited = Object.values(g.s.projects).filter((p) => p.templateId && g.reg.get('template', p.templateId)?.kind !== 'pen' && p.siteWhy !== undefined);
  assert.ok(sited.length >= 4, 'the colony\'s first buildings');
  for (const p of sited) assert.match(p.siteWhy, /^the nearest good spot, \d+ tiles from the centre/);
  const fields = Object.values(g.s.fields);
  assert.ok(fields.length && fields.every((f) => /^the nearest fertile ground, \d+ tiles from the centre$/.test(f.why)));
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
});

test('plan: a pen is laid out away from the homes, and says so', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  const sid = g.s.playerSettlement;
  let p = null;
  for (let d = 0; d < 20 && !p; d++) { g.step(TICKS_PER_DAY); p = pensOf(g, sid)[0]; }
  assert.ok(p, 'a pen');
  assert.match(p.siteWhy, /from the homes/);
  const homes = g.owned('projects', sid).filter((x) => g.reg.get('template', x.templateId)?.kind === 'home');
  const mx = p.x + 3.5, my = p.y + 2.5;
  const near = Math.min(...homes.map((h) => Math.max(Math.abs(h.x - mx), Math.abs(h.y - my))));
  if (/at least/.test(p.siteWhy)) assert.ok(near >= PEN.homeGap, `kept ${near} tiles from the nearest home`);
});
