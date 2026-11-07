// Colonist appearance. Derived from a hash (not the game RNG) so adding looks never changes how a seed plays.
export const SKIN = ['#f5d6c0', '#ecc19f', '#ddab84', '#c99068', '#b07850', '#8f5c3b', '#704430', '#523222'];
export const HAIR = ['#1d1612', '#35231a', '#55361f', '#7c5130', '#a87842', '#d4ac68', '#9c3a1e', '#6e6c6a', '#dcd6cc'];
export const PANTS = ['#3a4866', '#4a3b2e', '#33402f', '#5a5048', '#2f2c2a', '#5b4a3a'];
export const STYLES = ['short', 'crop', 'long', 'bun', 'ponytail', 'curly', 'bald', 'braid', 'mohawk'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

/** A look from a hash of `key`. pal: a people's palette (peoples.json `look`: skin, hair, pants, styles, build
 *  and height [lo, hi], beard chance); without one (the Hearthfolk), today's palette, drawn exactly as before. */
export function makeLook(key, pal = null) {
  const r = hash(String(key));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(pal?.skin || SKIN);
  const style = pick(pal?.styles || STYLES);
  // Grey/white hair is rarer; bald people sometimes keep a beard.
  const H = pal?.hair || HAIR;
  let hair = pick(H);
  if (!pal?.hair && (hair === '#6e6c6a' || hair === '#dcd6cc') && r() < 0.5) hair = pick(HAIR.slice(0, 6));
  return {
    skin, hair, style,
    pants: pick(pal?.pants || PANTS),
    build: pal?.build ? pal.build[0] + r() * (pal.build[1] - pal.build[0]) : 0.85 + r() * 0.35, // shoulder width
    height: pal?.height ? pal.height[0] + r() * (pal.height[1] - pal.height[0]) : 0.94 + r() * 0.12,
    beard: (style === 'short' || style === 'crop' || style === 'bald' || style === 'mohawk') && r() < (pal?.beard ?? 0.45),
  };
}

/** A child's look: each part from one parent (by a hash of `key`); build and height between theirs, a little
 *  either way. Hair style and beard are the child's own (a fresh look from the people's palette). */
export function inheritLook(key, a, b, pal = null) {
  const own = makeLook(key, pal);
  if (!a || !b) return own;
  const r = hash(`${key}:inherit`);
  const from = () => (r() < 0.5 ? a : b);
  const mid = (x, y, j) => Math.round(((x + y) / 2 + (r() - 0.5) * j) * 1000) / 1000;
  return {
    ...own,
    skin: from().skin ?? own.skin,
    hair: from().hair ?? own.hair,
    pants: own.pants,
    build: Number.isFinite(a.build) && Number.isFinite(b.build) ? mid(a.build, b.build, 0.1) : own.build,
    height: Number.isFinite(a.height) && Number.isFinite(b.height) ? mid(a.height, b.height, 0.04) : own.height,
  };
}
