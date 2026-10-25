// Node-only helper: read mod folders from disk into packages for buildRegistry().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODS_DIR = path.join(ROOT, 'mods');

export function readModFolder(dir, source = 'folder') {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const files = {};
  for (const rel of manifest.content || []) {
    const p = path.join(dir, rel);
    if (!p.startsWith(dir)) continue;
    if (fs.existsSync(p)) files[rel] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return { manifest, files, source };
}

export function readAllMods(dir = MODS_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'manifest.json')))
    .map((d) => readModFolder(path.join(dir, d.name), `mods/${d.name}`));
}
