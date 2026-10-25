// Building-template parsing, rotation and layout validation (shared by the loader and the planner).

export function parseTemplate(def) {
  const h = def.layout.length;
  const w = Math.max(...def.layout.map((r) => r.length));
  const cells = [];
  for (let cy = 0; cy < h; cy++) {
    const row = def.layout[cy];
    for (let cx = 0; cx < w; cx++) {
      const ch = row[cx] ?? ' ';
      if (ch === ' ' && !def.legend[' ']) continue;
      const spec = def.legend[ch];
      cells.push({ cx, cy, ch, spec });
    }
  }
  return { w, h, cells };
}

// Rotate a cell position inside a w x h grid by rot * 90 degrees clockwise.
export function rotateCell(cx, cy, w, h, rot) {
  switch (rot & 3) {
    case 0: return [cx, cy];
    case 1: return [h - 1 - cy, cx];
    case 2: return [w - 1 - cx, h - 1 - cy];
    default: return [cy, w - 1 - cx];
  }
}
// Rotate a direction/offset vector the same way.
export function rotateVec(dx, dy, rot) {
  switch (rot & 3) {
    case 0: return [dx, dy];
    case 1: return [-dy, dx];
    case 2: return [-dx, -dy];
    default: return [dy, -dx];
  }
}
export const rotatedSize = (w, h, rot) => ((rot & 1) ? [h, w] : [w, h]);

export function slotCandidates(reg, tag) {
  return reg.all('building').filter((b) => (b.slotTags || []).includes(tag));
}

export function cellKind(reg, spec) {
  if (!spec) return 'none';
  if (spec.floor) return 'floor';
  if (spec.clear) return 'clear';
  if (spec.build) return 'build';
  if (spec.slot) return 'slot';
  return 'none';
}

// Conservative passability for validation: a slot is passable only if every candidate is.
export function cellPassable(reg, spec) {
  const k = cellKind(reg, spec);
  if (k === 'floor' || k === 'clear') return true;
  if (k === 'build') return !!reg.get('building', spec.build)?.passable;
  if (k === 'slot') {
    const c = slotCandidates(reg, spec.slot);
    return c.length > 0 && c.every((b) => b.passable);
  }
  return true;
}

export function templateCapacity(reg, def) {
  if (def.capacity !== undefined) return def.capacity;
  const { cells } = parseTemplate(def);
  return cells.filter((c) => (c.spec?.slot === 'core:bed') || (c.spec?.build && reg.get('building', c.spec.build)?.bed)).length;
}

export function validateTemplate(reg, def) {
  const errors = [];
  const rows = def.layout;
  const w = Math.max(...rows.map((r) => r.length));
  if (rows.some((r) => r.length !== w)) errors.push('layout rows must all have the same length (pad with spaces)');
  for (const [ch, spec] of Object.entries(def.legend)) {
    if (ch.length !== 1) errors.push(`legend key "${ch}" must be a single character`);
    const kinds = ['build', 'slot', 'floor', 'clear'].filter((k) => spec[k] !== undefined && spec[k] !== false);
    if (kinds.length !== 1) errors.push(`legend "${ch}" must set exactly one of build, slot, floor, clear`);
    if (spec.slot && !spec.optional && slotCandidates(reg, spec.slot).length === 0) {
      errors.push(`legend "${ch}": no building has slotTag "${spec.slot}"`);
    }
  }
  for (const r of rows) for (const ch of r) if (ch !== ' ' && !def.legend[ch]) errors.push(`layout uses "${ch}" which is not in the legend`);
  if (errors.length) return errors;

  const { h, cells } = parseTemplate(def);
  const at = new Map(cells.map((c) => [`${c.cx},${c.cy}`, c]));
  const pass = (cx, cy) => {
    const c = at.get(`${cx},${cy}`);
    return !c || cellPassable(reg, c.spec);
  };
  const inside = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h;
  // Flood from every passable cell on the grid edge (outside access) through passable cells.
  const seen = new Set();
  const q = [];
  for (const c of cells) {
    const edge = c.cx === 0 || c.cy === 0 || c.cx === w - 1 || c.cy === h - 1;
    if (edge && pass(c.cx, c.cy)) { seen.add(`${c.cx},${c.cy}`); q.push([c.cx, c.cy]); }
  }
  // Empty (space) cells on the edge are outside too.
  for (let cx = 0; cx < w; cx++) for (let cy = 0; cy < h; cy++) {
    const edge = cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1;
    if (edge && !at.has(`${cx},${cy}`)) { seen.add(`${cx},${cy}`); q.push([cx, cy]); }
  }
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!inside(nx, ny) || seen.has(k) || !pass(nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  const reachable = (cx, cy) => seen.has(`${cx},${cy}`);
  let doors = 0;
  for (const c of cells) {
    const k = cellKind(reg, c.spec);
    const b = k === 'build' ? reg.get('building', c.spec.build) : null;
    if (b?.category === 'door') doors++;
    if (cellPassable(reg, c.spec)) {
      if (!reachable(c.cx, c.cy)) errors.push(`cell "${c.ch}" at (${c.cx},${c.cy}) cannot be reached from outside`);
      continue;
    }
    const isWall = (b && b.category === 'wall') || (k === 'slot' && slotCandidates(reg, c.spec.slot).every((x) => x.category === 'wall') && slotCandidates(reg, c.spec.slot).length > 0);
    if (isWall) continue;
    if (b?.interaction) {
      const [ix, iy] = [c.cx + b.interaction[0], c.cy + b.interaction[1]];
      if (!inside(ix, iy) || !pass(ix, iy) || !reachable(ix, iy)) errors.push(`"${b.name}" at (${c.cx},${c.cy}) has its interaction spot blocked or unreachable`);
      else if (at.get(`${ix},${iy}`) && cellKind(reg, at.get(`${ix},${iy}`).spec) !== 'floor' && cellKind(reg, at.get(`${ix},${iy}`).spec) !== 'clear') {
        errors.push(`"${b.name}" at (${c.cx},${c.cy}) must have a floor (.) cell as its interaction spot`);
      }
      continue;
    }
    const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = c.cx + dx, ny = c.cy + dy;
      return inside(nx, ny) && pass(nx, ny) && reachable(nx, ny) && at.has(`${nx},${ny}`);
    });
    if (!ok) errors.push(`furniture cell "${c.ch}" at (${c.cx},${c.cy}) has no reachable interaction space next to it`);
  }
  if (def.kind === 'home') {
    if (doors === 0) errors.push('home templates need at least one door');
    if (templateCapacity(reg, def) < 1) errors.push('home templates need at least one bed slot (slot "core:bed")');
  }
  for (const p of def.provides || []) {
    if (!cells.some((c) => c.spec?.build === p)) errors.push(`provides "${p}" but the layout never builds it`);
  }
  return errors;
}
