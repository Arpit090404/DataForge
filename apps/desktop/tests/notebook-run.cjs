const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const source = fs.readFileSync(path.resolve(__dirname, '../src/notebookRun.ts'), 'utf8');
const { code } = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' });
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { runCodeSequence } = mod.exports;
const cells = [{ id: 'sql' }, { id: 'python' }, { id: 'last' }];

async function run() {
  const order = [], states = {};
  await runCodeSequence(cells, async cell => { order.push(cell.id); return 'completed'; }, () => false,
    (id, state) => { states[id] = state; });
  assert.deepEqual(order, ['sql', 'python', 'last']);
  assert.deepEqual(states, { sql: 'completed', python: 'completed', last: 'completed' });

  const failures = [], failedStates = {};
  await runCodeSequence(cells, async cell => { failures.push(cell.id); return cell.id === 'python' ? 'failed' : 'completed'; }, () => false,
    (id, state) => { failedStates[id] = state; });
  assert.deepEqual(failures, ['sql', 'python']);
  assert.deepEqual(failedStates, { sql: 'completed', python: 'failed', last: null });

  let stopped = false;
  const cancelled = [];
  await runCodeSequence(cells, async cell => { cancelled.push(cell.id); stopped = true; return 'cancelled'; }, () => stopped,
    (id, state) => { if (state === 'queued') cancelled.push(`queued:${id}`); });
  assert.deepEqual(cancelled, ['queued:sql', 'queued:python', 'queued:last', 'sql']);

  const thrown = [];
  await runCodeSequence(cells, async () => { throw Error('kernel failed'); }, () => false,
    (id, state) => { if (state === 'failed' || state === null) thrown.push([id, state]); });
  assert.deepEqual(thrown, [['sql', 'failed'], ['python', null], ['last', null]]);
  console.log('Notebook mixed sequence, failure, cancellation, and cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
