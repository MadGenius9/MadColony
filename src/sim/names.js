// Colonist names (data: the scenario's `namePool`, mods/core/content/setup.json).
//
// A colonist first gets a plain first name from the pool while one is free. When every first name is
// taken, the name gets a surname from the pool's `surnames` ("Elin Thornwood"); a child inherits a parent's
// surname when it has one, so families share it. Only when every first name + surname pair is taken does
// a Roman numeral follow ("Elin Thornwood II"). Nothing here draws from the rng: the surname order comes
// from a hash of a saved key (the colonist id), so the same state always gives the same name.

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** The name pool: the people's own (peoples.json `namePool`) when it has one, else the scenario's:
 *  { names, surnames } (surnames may be empty). */
export function namePoolOf(g, fallback = 'Settler', people = null) {
  const own = people ? g.reg.get('people', people)?.namePool : null;
  const p = g.reg.get('namePool', own || g.reg.get('scenario', g.s.scenarioId)?.namePool);
  return { names: p?.names?.length ? p.names : [fallback], surnames: p?.surnames || [] };
}

/** A first name chosen by a saved key (no rng draw), for when no first name is free. */
export function firstByKey(pool, key) { return pool.names[hash('first:' + key) % pool.names.length]; }

/** 2 -> "II", 14 -> "XIV". */
export function roman(n) {
  const R = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of R) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The pool surname in a colonist's name, if any ("Elin Thornwood II" -> "Thornwood"). */
export function surnameOf(pool, name) {
  const w = String(name || '').split(' ');
  return w.length > 1 && pool.surnames.includes(w[1]) ? w[1] : null;
}

/** A name not in `used`, built on first name `first`: "first", then "first Family", then "first <surname>"
 *  in an order set by `key`, then "first <surname> II", "III", ... Cost: O(surnames) set lookups. */
export function uniqueName(pool, used, first, key, family = null, allowPlain = true) {
  if (allowPlain && !used.has(first)) return first;
  const sn = pool.surnames, start = sn.length ? hash(key) % sn.length : 0;
  if (family && !used.has(`${first} ${family}`)) return `${first} ${family}`;
  for (let k = 0; k < sn.length; k++) { const n = `${first} ${sn[(start + k) % sn.length]}`; if (!used.has(n)) return n; }
  const base = family ? `${first} ${family}` : sn.length ? `${first} ${sn[start]}` : first;
  for (let k = 2; ; k++) { const n = `${base} ${roman(k)}`; if (!used.has(n)) return n; }
}

/** Names already used by anyone, living or dead (s.dead, death.js): names stay unique. */
export function usedNames(s) {
  const used = new Set(Object.values(s.colonists).map((c) => c.name));
  for (const d of Object.values(s.dead || {})) used.add(d.name);
  return used;
}
