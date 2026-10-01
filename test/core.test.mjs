import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCSV, analyze, pythonVerifier, decimal, LIMITS } from '../core.mjs';

test('CSV preserves quoted separators, CRLF, embedded newlines and BOM', () => {
  const table = parseCSV('\uFEFFid,amount,note\r\n"one,1",0.10,"line one\r\nline two"\r\n"two""2",.20,"hello"\r\n');
  assert.deepEqual(table.records, [['one,1', '0.10', 'line one\r\nline two'], ['two"2', '.20', 'hello']]);
  assert.equal(analyze(table, 1, '0.30').verdict, 'matches');
});
test('exact decimal sum avoids float roundoff and supports cancellation and large integers', () => {
  assert.equal(analyze(parseCSV('v\n0.1\n0.2\n'), 0, '0.3').total, '0.3');
  assert.equal(analyze(parseCSV('v\n999999999999999999999999999999999999.9\n.1\n-1\n'), 0).total, '999999999999999999999999999999999999');
  assert.equal(analyze(parseCSV('v\n-0\n+.000\n'), 0, '-0.0').total, '0');
});
test('missing/invalid amounts block a total; repeated IDs do not invent an error verdict', () => {
  const result = analyze(parseCSV('id,v\na,1\na,\n,NaN\n'), 1, '1', 0);
  assert.equal(result.verdict, 'blocked'); assert.equal(result.total, null);
  assert.deepEqual(result.missing_amount_records, [3]);
  assert.deepEqual(result.invalid_amount_records, [4]);
  assert.deepEqual(result.duplicate_id_groups, [[2, 3]]);
  assert.deepEqual(result.empty_id_records, [4]);
  assert.equal(analyze(parseCSV('id,v\na,1\na,2\n'), 1, '3', 0).verdict, 'matches');
  const explicitEmpty = analyze(parseCSV('v\n1\n""\n\n'), 0, '1');
  assert.equal(explicitEmpty.records, 2); assert.equal(explicitEmpty.verdict, 'blocked');
  assert.deepEqual(explicitEmpty.missing_amount_records, [3]);
});
test('malformed, ragged and ambiguous CSV inputs are rejected', () => {
  for (const text of ['a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"unclosed', 'a\n"x"y', 'a\nx"y']) assert.throws(() => parseCSV(text));
  assert.throws(() => parseCSV('v\n' + '1\n'.repeat(LIMITS.rows + 1)), /20,000/);
  assert.throws(() => decimal('1e3')); assert.throws(() => decimal('1,000'));
  assert.throws(() => decimal('0.' + '1'.repeat(19)));
  assert.throws(() => decimal('1'.repeat(65)));
});
test('exported standard-library Python independently reproduces reports and refuses changed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runproof-test-'));
  try {
    for (const [input, expected, idColumn] of [
      ['id,amount\r\na,0.1\r\nb,0.2\r\nc,-0.05\r\n', '0.30', 0],
      ['\uFEFFid,v\r\n"a,b",1\r\n"line\r\ntwo",2\r\n', '3', 0],
      ['id,v\na,1\na,\n,NaN\n', '1', 0],
      ['id,v\na,999999999999999999999999999999999999.9\nb,.1\nc,-1\n', '', null],
      ['id,v\na,-0.0\nb,0.000\n', '-0', 0],
      ['id,v\na,1\nb,""\n\n', '1', 0],
    ]) {
      const bytes = Buffer.from(input); const table = parseCSV(input);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const verifier = pythonVerifier({ sha256, headers: table.headers, amountColumn: 1, idColumn, expected });
      writeFileSync(join(dir, 'verify.py'), verifier); writeFileSync(join(dir, 'input.csv'), bytes);
      const run = spawnSync('python', [join(dir, 'verify.py'), join(dir, 'input.csv')], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(JSON.parse(run.stdout).result, analyze(table, 1, expected, idColumn));
      writeFileSync(join(dir, 'input.csv'), bytes + 'changed');
      const changed = spawnSync('python', [join(dir, 'verify.py'), join(dir, 'input.csv')], { encoding: 'utf8' });
      assert.notEqual(changed.status, 0); assert.match(changed.stderr, /SHA-256 differs/);
    }
  } finally {
    const target = resolve(dir), parent = resolve(tmpdir()), child = relative(parent, target);
    if (!child || child.startsWith('..') || isAbsolute(child) || !child.startsWith('runproof-test-')) throw new Error('Refusing cleanup outside the named temporary test directory');
    rmSync(target, { recursive: true, force: true });
  }
});
