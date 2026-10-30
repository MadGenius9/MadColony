// Kingdoms (Phase 2, slice 3). A kingdom is a capital plus the villages founded from it (and from its
// members). It forms when a village that is in no kingdom founds a daughter: the founder becomes the capital
// and the daughter its first member. Later daughters of the capital or of any member join the same kingdom.
// Members count as allies of each other for the war rules (combat.js): they cannot attack each other, and
// when one is attacked (the first attack of a war) the other members join its defence. Members never fight
// each other while in one kingdom (combat.js isEnemy treats them as not at war). At the daily check a member
// whose relations with the capital are at or below KINGDOM.leaveBelow (hostile) leaves, and of two members
// hostile to each other the one with the lower relation to the capital leaves (tie: the higher id), each with
// the cause logged; the capital never leaves; a kingdom left with only its capital is dissolved. Rulers,
// succession and rebellion are Phase 6.
//
// State (save format 8; written only when the first kingdom forms, so classic worlds never have it):
//   s.kingdoms[kid] = { id, name, capital, color, founded }   kid from g.newId('k')
//   settlement.kingdom = kid                                   on the capital and on every member
// The name comes from data (`kingdomNames` patterns of the capital's village profile, e.g. "Kingdom of
// {capital}"), picked by a stable hash of the capital's id: no random numbers. The colour is the capital's.
//
// Cost: nothing per tick. Forming and joining are O(1); leaveKingdom (called by hand) counts the members, O(S).
// tickKingdoms (daily, only when kingdoms exist): one sorted pass over the settlements that groups the members
// by kingdom (O(S log S)), then per kingdom O(m^2) relation lookups over member pairs (m = its members, small);
// the member lists are reused for the leave and dissolve decisions.
// Distant (abstract) villages: membership is data only; nothing here changes their level of detail.
import { relationPeek, relationOf, relationStatus } from './villages.js';

export const KINGDOM = Object.freeze({
  // A member whose relation with the capital is AT OR BELOW this leaves (daily check). It is the hostile
  // threshold of relationStatus (villages.js): a member hostile to its capital leaves.
  leaveBelow: -25,
  nameMax: 80,     // longest kingdom name
});

/** Name patterns used when the capital's profile has no `kingdomNames`. */
export const DEFAULT_KINGDOM_NAMES = Object.freeze(['Kingdom of {capital}', '{capital} Realm', 'Crown of {capital}']);

const nameOf = (g, sid) => g.s.settlements?.[sid]?.name || sid;
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Hostile: met, and relation at or below KINGDOM.leaveBelow (the same threshold as relationStatus). */
const hostile = (g, a, b) => { const r = relationPeek(g, a, b); return relationStatus(r) === 'hostile' && r.value <= KINGDOM.leaveBelow; };

/** A relation-history line with no change in value (like villages.js noteRelation), dated `at` (default: now)
 *  and kept in date order; the history keeps its last 16 entries. */
function note(g, a, b, reason, at = g.s.tick) {
  const h = relationOf(g, a, b).history;
  let i = h.length;
  while (i > 0 && h[i - 1].tick > at) i--;
  h.splice(i, 0, { tick: at, delta: 0, reason });
  if (h.length > 16) h.splice(0, h.length - 16);
}

/** "the Kingdom of X", but "The Crown of X" is not doubled. */
export function theKingdom(name) { return /^the\s/i.test(name) ? name : `the ${name}`; }

/** FNV-1a, 32 bit: a stable hash of a string (no random numbers). */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The kingdom's name for a capital: a pattern from the capital profile's `kingdomNames` (or the defaults),
 *  chosen by a hash of the capital's id, with {capital} replaced by its name. Deterministic, read-only. */
export function kingdomName(g, capitalSid) {
  const st = g.s.settlements?.[capitalSid];
  const prof = st?.profile && g.reg?.get?.('villageProfile', st.profile);
  const pats = Array.isArray(prof?.kingdomNames) && prof.kingdomNames.length ? prof.kingdomNames : DEFAULT_KINGDOM_NAMES;
  const pat = pats[hash(String(capitalSid)) % pats.length];
  const name = String(pat).split('{capital}').join(st?.name || capitalSid).trim();
  return (name || `Kingdom of ${st?.name || capitalSid}`).slice(0, KINGDOM.nameMax);
}

/** The kingdom record `sid` belongs to, or null. Read-only. */
export function kingdomOf(g, sid) {
  const kid = g.s.settlements?.[sid]?.kingdom;
  return (kid && g.s.kingdoms?.[kid]) || null;
}

/** Members of kingdom `kid`, the capital included, in id order (the record's `capital` says which is the
 *  capital). Read-only, O(S). */
export function membersOf(g, kid) {
  if (!g.s.kingdoms?.[kid]) return [];
  const out = [];
  for (const sid of Object.keys(g.s.settlements || {}).sort()) if (g.s.settlements[sid].kingdom === kid) out.push(sid);
  return out;
}

/** Are `a` and `b` in the same kingdom? Read-only. */
export function sameKingdom(g, a, b) {
  const ka = kingdomOf(g, a);
  return !!ka && ka === kingdomOf(g, b);
}

/** Form a kingdom with `capitalSid` as its capital and `firstDaughterSid` as its first member (founding.js;
 *  exported for tests and the save migration). Returns the kingdom id, or null if the capital is already in one. */
export function formKingdom(g, capitalSid, firstDaughterSid, opts = {}) {
  const s = g.s;
  const cap = s.settlements?.[capitalSid];
  if (!cap || cap.kingdom) return null;
  let kid = g.newId('k');
  while (s.kingdoms?.[kid]) kid = g.newId('k');
  const name = kingdomName(g, capitalSid);
  s.kingdoms ||= {};
  s.kingdoms[kid] = { id: kid, name, capital: capitalSid, color: cap.color || '#a0c0e0', founded: opts.at ?? s.tick };
  cap.kingdom = kid;
  g.log(opts.conquered ? `${cap.name} becomes the capital of ${theKingdom(name)}, with ${nameOf(g, firstDaughterSid)} under its crown.` : `${cap.name} founded ${nameOf(g, firstDaughterSid)} and becomes the capital of ${theKingdom(name)}.`, 'good', null, 0, { kind: 'core:kingdom_formed', sids: [capitalSid, firstDaughterSid], cause: opts.cause });
  if (firstDaughterSid && s.settlements[firstDaughterSid]) joinKingdom(g, firstDaughterSid, kid, opts.conquered ? `conquered by ${cap.name}` : `founded by ${cap.name}`, opts);
  return kid;
}

/** `sid` joins kingdom `kid` (`reason` is shown in the log and its relation history with the capital).
 *  A village already in a kingdom does not change kingdom. `opts.at`: the date of the history line (the save
 *  migration dates it at the founding). Returns { ok, msg }. */
export function joinKingdom(g, sid, kid, reason = '', opts = {}) {
  const s = g.s;
  const st = s.settlements?.[sid], k = s.kingdoms?.[kid];
  if (!st || !k) return { ok: false, msg: 'There is no such village or kingdom.' };
  if (st.kingdom === kid) return { ok: false, msg: `${st.name} is already in ${theKingdom(k.name)}.` };
  if (st.kingdom) return { ok: false, msg: `${st.name} is in another kingdom.` };
  st.kingdom = kid;
  if (k.capital !== sid && s.settlements[k.capital]) note(g, sid, k.capital, `Joined ${theKingdom(k.name)}${reason ? ` (${reason})` : ''}`, opts.at ?? s.tick);
  g.log(`${st.name} joins ${theKingdom(k.name)}${reason ? ` (${reason})` : ''}.`, 'good', null, 0, { kind: 'core:kingdom_joined', sids: [sid, k.capital], cause: opts.cause });
  return { ok: true, msg: `${st.name} joined ${theKingdom(k.name)}.` };
}

/** `sid` leaves its kingdom (`reason` is logged). The capital never leaves. A kingdom left with only its
 *  capital is dissolved (unless `opts.noDissolve`: tickKingdoms decides that itself). Returns { ok, msg }. */
export function leaveKingdom(g, sid, reason = '', opts = {}) {
  const s = g.s;
  const st = s.settlements?.[sid], k = kingdomOf(g, sid);
  if (!st || !k) return { ok: false, msg: 'That village is in no kingdom.' };
  if (k.capital === sid && opts.force) { dissolveKingdom(g, k.id, reason || 'its capital is gone'); return { ok: true, msg: `${theKingdom(k.name)} is no more.` }; } // a fallen capital with no heir (fallen.js)
  if (k.capital === sid) return { ok: false, msg: `${st.name} is the capital of ${theKingdom(k.name)} and never leaves it.` };
  delete st.kingdom;
  if (s.settlements[k.capital]) note(g, sid, k.capital, `Left ${theKingdom(k.name)}${reason ? `: ${reason}` : ''}`);
  g.log(`${st.name} leaves ${theKingdom(k.name)}${reason ? `: ${reason}` : ''}.`, 'warn', null, 0, { kind: 'core:kingdom_left', sids: [sid, k.capital] });
  if (!opts.noDissolve && membersOf(g, k.id).length <= 1) dissolveKingdom(g, k.id, 'only its capital is left');
  return { ok: true, msg: `${st.name} left ${theKingdom(k.name)}.` };
}

/** Succession (Phase 5, fallen.js): `sid`, a member, becomes the capital of kingdom `kid`. The kingdom keeps its
 *  name and colour. */
export function setCapital(g, kid, sid, reason = '') {
  const k = g.s.kingdoms?.[kid];
  if (!k || g.s.settlements?.[sid]?.kingdom !== kid) return false;
  k.capital = sid;
  g.log(`${nameOf(g, sid)} is now the capital of ${theKingdom(k.name)}${reason ? ` (${reason})` : ''}.`, 'warn', null, 0, { kind: 'core:capital_moved', sids: [sid] });
  return true;
}

/** Remove a kingdom: the record goes, and so does the field on every village still in it. */
function dissolveKingdom(g, kid, reason) {
  const s = g.s, k = s.kingdoms?.[kid];
  if (!k) return;
  for (const sid of Object.keys(s.settlements || {}).sort()) if (s.settlements[sid].kingdom === kid) delete s.settlements[sid].kingdom;
  delete s.kingdoms[kid];
  const t = theKingdom(k.name);
  g.log(`${t.charAt(0).toUpperCase()}${t.slice(1)} is dissolved${reason ? `: ${reason}` : ''}.`, 'warn', null, 0, { kind: 'core:kingdom_dissolved', sids: [k.capital] });
}

/** Where a village founded by `parentSid` belongs: the parent's kingdom, or a new one with the parent as capital.
 *  Called by foundDaughter once the child exists. Returns the kingdom id. */
export function kingdomForDaughter(g, parentSid, childSid, opts = {}) {
  const k = kingdomOf(g, parentSid);
  if (!k) return formKingdom(g, parentSid, childSid, opts);
  joinKingdom(g, childSid, k.id, `founded by ${nameOf(g, parentSid)}`, opts);
  return k.id;
}

/** Daily (no random numbers; nothing when there are no kingdoms), everything in id order:
 *  1. a member hostile to its capital (relation at or below KINGDOM.leaveBelow) leaves;
 *  2. of two members hostile to each other, the one with the lower relation to the capital leaves (tie: the
 *     higher id), with the cause "at war with fellow member X"; the capital never leaves;
 *  3. a kingdom whose capital is gone, or with only its capital left, is dissolved. */
export function tickKingdoms(g) {
  const s = g.s;
  if (!s.kingdoms) return;
  const members = new Map(); // kid -> member sids in id order: one pass, reused below
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const kid = s.settlements[sid].kingdom;
    if (!kid || !s.kingdoms[kid]) continue;
    let m = members.get(kid);
    if (!m) members.set(kid, (m = []));
    m.push(sid);
  }
  for (const kid of Object.keys(s.kingdoms).sort()) {
    const k = s.kingdoms[kid], m = members.get(kid) || [];
    const cap = k.capital;
    if (!s.settlements[cap]) continue; // dissolved below
    const gone = new Set();
    const leave = (sid, why) => { gone.add(sid); leaveKingdom(g, sid, why, { noDissolve: true }); };
    for (const sid of m) {
      if (sid !== cap && hostile(g, sid, cap)) leave(sid, `relations with the capital ${nameOf(g, cap)} soured (${relationPeek(g, sid, cap).value})`);
    }
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
      const a = m[i], b = m[j];
      if (a === cap || b === cap || gone.has(a) || gone.has(b) || !hostile(g, a, b)) continue;
      const va = relationPeek(g, a, cap).value, vb = relationPeek(g, b, cap).value;
      const out = va < vb ? a : vb < va ? b : (a > b ? a : b);
      leave(out, `at war with fellow member ${nameOf(g, out === a ? b : a)}`);
    }
    if (gone.size) members.set(kid, m.filter((x) => !gone.has(x)));
  }
  for (const kid of Object.keys(s.kingdoms).sort()) {
    const k = s.kingdoms[kid];
    if (!s.settlements[k.capital]) dissolveKingdom(g, kid, 'its capital is gone');
    else if ((members.get(kid) || []).length <= 1) dissolveKingdom(g, kid, 'only its capital is left');
  }
}

/** Save migration 7 -> 8: kingdoms for villages founded before kingdoms existed. The same rules as at founding
 *  time, replayed in founding order (settlement.founded, then id); no random numbers and no log lines; the
 *  "Joined ..." relation-history lines are dated at the founding. Works on the raw state (`reg` gives the
 *  profiles' name patterns; without it the default patterns are used). */
export function kingdomsFromParents(s, reg = null) {
  const daughters = Object.values(s.settlements || {}).filter((st) => st.parent && st.parent !== st.id && s.settlements[st.parent] && !st.kingdom)
    .sort((a, b) => (a.founded ?? 0) - (b.founded ?? 0) || byStr(a.id, b.id));
  if (!daughters.length) return 0;
  const g = { s, reg, newId: (p) => p + s.nextId++, log() {} };
  for (const d of daughters) kingdomForDaughter(g, d.parent, d.id, { at: d.founded ?? s.tick });
  return daughters.length;
}
