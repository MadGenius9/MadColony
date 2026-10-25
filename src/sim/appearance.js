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

export function makeLook(key) {
  const r = hash(String(key));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(SKIN);
  const style = pick(STYLES);
  // Grey/white hair is rarer; bald people sometimes keep a beard.
  let hair = pick(HAIR);
  if ((hair === '#6e6c6a' || hair === '#dcd6cc') && r() < 0.5) hair = pick(HAIR.slice(0, 6));
  return {
    skin, hair, style,
    pants: pick(PANTS),
    build: 0.85 + r() * 0.35, // shoulder width
    height: 0.94 + r() * 0.12,
    beard: (style === 'short' || style === 'crop' || style === 'bald' || style === 'mohawk') && r() < 0.45,
  };
}
