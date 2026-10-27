// The firefighting job (Phase 5b, slice 6c; the rules are in fire.js). Its own module so ai.js can register it
// without an import cycle through fire.js and ruin.js.
import { travel, workSpeed } from './ai/jobs.js';
import { fireRules, putOut } from './fire.js';

/** The firefighting job: go next to the burning tile, beat it out. */
export const FIRE_DRIVERS = {
  firefight: {
    valid(g, c, j) { return !!g.s.disasters?.fires && Object.hasOwn(g.s.disasters.fires, j.tile); },
    tick(g, c, j) {
      const D = g.s.disasters;
      if (!D?.fires || !Object.hasOwn(D.fires, j.tile)) return 'done'; // it went out
      const r = travel(g, c, j, j.x, j.y, 'adj', 'the fire');
      if (r === false) { c.status.action = 'Running to the fire'; return 'running'; }
      if (r !== true) return r;
      const F = fireRules(g);
      j.prog += (j.water ? 2 : 1) * workSpeed(g, c, null, null);
      c.status.action = j.water ? 'Throwing water on the fire' : 'Beating out the fire';
      if (j.prog < F.fightWork) return 'running';
      putOut(g, j.tile);
      g.log(`${c.name} put out a fire.`, 'info', `putout:${c.settlementId}`, 600);
      return 'done';
    },
  },
};
