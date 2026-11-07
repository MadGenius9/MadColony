// Read-only byte and diff guard. No dependencies, hooks, or Git configuration changes.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function profile(bytes) {
  const boms = ['0000feff', 'fffe0000', 'efbbbf', 'fffe', 'feff'];
  const bom = boms.find((hex) => bytes.subarray(0, hex.length / 2).toString('hex') === hex) || '';
  let utf8 = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { utf8 = false; }
  const text = bytes.toString('latin1');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  const cr = (text.match(/\r/g) || []).length - crlf;
  return { bom, utf8, binary: bytes.includes(0), crlf, lf, cr,
    final: /[\r\n]$/.test(text), lines: crlf + lf + cr + (text && !/[\r\n]$/.test(text) ? 1 : 0) };
}

export function inspectBytes(before, after, added = 0, removed = 0) {
  if ((before && after && before.equals(after))) return [];
  const a = before === null ? null : profile(before), b = after === null ? null : profile(after);
  const issues = [];
  if (a && b && a.bom !== b.bom) issues.push('BOM changed');
  if (a && b && (a.utf8 !== b.utf8 || a.binary !== b.binary)) issues.push('encoding/text classification changed');
  // Unknown binary encodings cannot safely be interpreted as lines.
  if (a?.binary || b?.binary) return issues;
  if (a && b && a.final !== b.final) issues.push('final newline changed');
  const styles = (p) => ['crlf', 'lf', 'cr'].filter((s) => p?.[s] > 0);
  const oldStyles = styles(a), newStyles = styles(b);
  if (a && b && oldStyles.length === 1 && newStyles.some((s) => !oldStyles.includes(s))) {
    issues.push('line ending style changed or mixed');
  } else if (newStyles.length > 1 && (!a || newStyles.some((s) => !oldStyles.includes(s)) ||
    ['crlf', 'lf', 'cr'].some((s) => a[s] > 0 && a[s] < Math.max(a.crlf, a.lf, a.cr) && b[s] > a[s]))) {
    issues.push('mixed line endings introduced or increased');
  }
  if (a && b && oldStyles.length > 1 && newStyles.length === 1 && added + removed >= 50) {
    issues.push('existing mixed line endings normalized; review intent');
  }
  if (a && a.lines >= 50 && removed >= a.lines * 0.8 && added >= 20) issues.push('wholesale replacement (>=80% of old lines)');
  if (added + removed >= 1000) issues.push('large change (>=1000 added/deleted lines)');
  return issues;
}

export function main(args = process.argv.slice(2)) {
  let base = 'HEAD', head, staged = false;
  const allowances = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--base', '--head', '--allow'].includes(arg)) {
      const value = args[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      if (arg === '--base') base = value;
      if (arg === '--head') head = value;
      if (arg === '--allow') {
        const split = value.indexOf('=');
        if (split < 1 || value.slice(split + 1).trim().length < 12) throw new Error('--allow needs path=a specific review reason (12+ characters)');
        allowances.set(value.slice(0, split), value.slice(split + 1));
      }
    } else if (arg === '--staged') staged = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (head && staged) throw new Error('--head and --staged are mutually exclusive');
  const git = (...argv) => execFileSync('git', argv, { maxBuffer: 64 * 1024 * 1024 });
  const root = git('rev-parse', '--show-toplevel').toString().trim();
  const original = process.cwd();
  process.chdir(root);
  try {
    // Resolve refs before passing them to diff; invalid/missing history fails closed.
    base = git('rev-parse', '--verify', `${base}^{commit}`).toString().trim();
    if (head) head = git('rev-parse', '--verify', `${head}^{commit}`).toString().trim();
    const treePaths = (ref) => new Set(git('ls-tree', '-r', '--name-only', '-z', ref).toString().split('\0').filter(Boolean));
    const oldPaths = treePaths(base);
    const newPaths = head ? treePaths(head) : new Set(git('ls-files', '-z', ...(staged ? [] : ['--cached', '--others', '--exclude-standard'])).toString().split('\0').filter(Boolean));
    const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', ...(staged ? ['--cached'] : []), base, ...(head ? [head] : []), '--'];
    const stats = new Map(git(...diffArgs).toString().split('\0').filter(Boolean).map((row) => {
      const [add, del, ...path] = row.split('\t');
      return [path.join('\t'), [Number(add) || 0, Number(del) || 0]];
    }));
    let failures = 0, checked = 0;
    const used = new Set();
    for (const path of new Set([...oldPaths, ...newPaths])) {
      const before = oldPaths.has(path) ? git('show', `${base}:${path}`) : null;
      let after = null;
      if (newPaths.has(path)) {
        if (head || staged) after = git('show', `${head || ''}:${path}`);
        else {
          try {
            if (!lstatSync(path).isFile()) continue; // Symlinks/submodules are not text files.
            after = readFileSync(path);
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      if ((before && after && before.equals(after)) || (!before && !after)) continue;
      checked++;
      const [add, del] = stats.get(path) || [after ? profile(after).lines : 0, before ? profile(before).lines : 0];
      const issues = inspectBytes(before, after, add, del);
      if (!issues.length) continue;
      const reason = allowances.get(path);
      if (reason) used.add(path); else failures++;
      console.log(`${reason ? 'REVIEWED' : 'REVIEW REQUIRED'} ${JSON.stringify(path)}: ${issues.join('; ')}${reason ? ` — ${reason}` : ''}`);
    }
    for (const path of allowances.keys()) if (!used.has(path)) {
      console.error(`Unused allowance: ${JSON.stringify(path)} (remove it; do not keep blanket exceptions)`);
      failures++;
    }
    console.log(`Diff guard: ${checked} changed files, ${failures} requiring review. Base ${base}; target ${head || (staged ? 'index' : 'working tree (including untracked)')}.`);
    return failures ? 1 : 0;
  } finally { process.chdir(original); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(`Diff guard error: ${error.message}`); process.exitCode = 2; }
}
