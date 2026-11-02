import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectBytes } from '../tools/check-diff.mjs';

const b = (s) => Buffer.from(s);
const check = (a, z, add = 1, del = 1) => inspectBytes(a === null ? null : b(a), z === null ? null : b(z), add, del);
for (const eol of ['\n', '\r\n']) test(`tiny edit preserves ${JSON.stringify(eol)}`, () => {
  assert.deepEqual(check(`one${eol}two${eol}`, `one${eol}three${eol}`), []);
});
for (const eol of ['\n', '\r\n']) test(`JSON entry patch preserves ${JSON.stringify(eol)}`, () => {
  const old = ['{', '  "name": "one"', '}', ''].join(eol);
  const next = ['{', '  "name": "one",', '  "added": "café"', '}', ''].join(eol);
  assert.equal(JSON.parse(next).added, 'café');
  assert.deepEqual(check(old, next, 2, 1), []);
});
test('full EOL normalization and introduced mixed endings need review', () => {
  assert.match(check('one\r\ntwo\r\n', 'one\ntwo\n').join(), /line ending/);
  assert.match(check('one\r\ntwo\r\n', 'one\r\ntwo\n').join(), /mixed/);
  assert.match(check(null, 'one\r\ntwo\n').join(), /mixed/);
});
test('final newline added or removed is independent of EOL', () => {
  assert.match(check('one\n', 'one').join(), /final newline/);
  assert.match(check('one', 'one\n').join(), /final newline/);
});
test('pre-existing mixed EOL and invalid UTF-8 are not blamed on a small edit', () => {
  assert.deepEqual(check('one\r\ntwo\nthree\n', 'one\r\ntwo!\nthree\n'), []);
  assert.deepEqual(inspectBytes(Buffer.from([255, 10]), Buffer.from([255, 33, 10]), 1, 1), []);
  assert.match(check('one\r\ntwo\nthree\n', 'one\r\ntwo\r\nthree\n').join(), /mixed/);
});
test('BOM and detectable encoding changes require review; ASCII remains UTF-8', () => {
  assert.match(check('one\n', '\ufeffone\n').join(), /BOM/);
  assert.deepEqual(check('one\n', 'café\n'), []);
  assert.match(inspectBytes(b('one\n'), Buffer.from([255, 10])).join(), /encoding/);
  assert.match(inspectBytes(b('one\n'), Buffer.from('one\n', 'utf16le')).join(), /encoding/);
});
test('whole-file churn versus legitimate additions; large additions need review', () => {
  const old = 'old\n'.repeat(100);
  assert.match(check(old, 'new\n'.repeat(100), 100, 100).join(), /wholesale/);
  assert.deepEqual(check(old, old + 'new\n'.repeat(200), 200, 0), []);
  assert.match(check(null, 'new\n'.repeat(1000), 1000, 0).join(), /large change/);
  assert.deepEqual(check(null, 'new\n'.repeat(200), 200, 0), []);
  assert.deepEqual(check(old, null, 0, 100), []);
});
test('Git modes, untracked files, explicit ranges, read-only behavior and allowances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'madcolony-diff-'));
  const script = fileURLToPath(new URL('../tools/check-diff.mjs', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(dir, 'data.txt'), 'one\r\ntwo\r\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    const start = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'data.txt'), 'one\r\nthree\r\n');
    assert.equal(run().status, 0);
    git('add', '.');
    writeFileSync(join(dir, 'data.txt'), 'one\nthree\n');
    const before = readFileSync(join(dir, 'data.txt'));
    assert.equal(run('--staged').status, 0);
    assert.equal(run().status, 1);
    assert.deepEqual(readFileSync(join(dir, 'data.txt')), before);
    assert.equal(run('--allow', 'data.txt=Intentional EOL migration reviewed in fixture').status, 0);
    assert.equal(run('--allow', 'other.txt=Intentional EOL migration reviewed in fixture').status, 1);
    assert.equal(run('--allow', 'data.txt=short').status, 2);
    git('commit', '-qm', 'tiny edit');
    assert.equal(run('--base', start, '--head', 'HEAD').status, 0);
    git('add', '.'); git('commit', '-qm', 'normalize');
    assert.equal(run('--base', start, '--head', 'HEAD').status, 1);
    assert.equal(run('--base', 'missing-ref').status, 2);
    writeFileSync(join(dir, 'new data.txt'), 'x\n'.repeat(1000));
    assert.equal(run().status, 1);
    assert.equal(run('--staged').status, 0);
    rmSync(join(dir, 'new data.txt'));
    rmSync(join(dir, 'data.txt'));
    assert.equal(run().status, 0, 'working deletion');
    git('add', '-u');
    assert.equal(run('--staged').status, 0, 'staged deletion');
    git('commit', '-qm', 'delete');
    assert.equal(run('--base', start, '--head', 'HEAD').status, 0, 'committed deletion');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
