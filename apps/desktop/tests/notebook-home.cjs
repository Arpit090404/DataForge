const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const filename = path.resolve(__dirname, '../src/notebookHome.ts');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const homeModule = new Module(filename, module);
homeModule.filename = filename;
homeModule.paths = Module._nodeModulePaths(path.dirname(filename));
homeModule._compile(compiled, filename);
const { filterNotebooks, sortNotebooks } = homeModule.exports;

const notebooks = [
  { id: 'a', title: 'Revenue Notes', block_count: 3, updated_at: '2026-11-15' },
  { id: 'b', title: 'Sales Analysis', block_count: 8, updated_at: '2026-11-17' },
  { id: 'c', title: 'revenue checks', block_count: 1, updated_at: '2026-11-16' },
];
assert.deepEqual(filterNotebooks(notebooks, ''), notebooks);
assert.deepEqual(filterNotebooks(notebooks, '  REVENUE  ').map(note => note.id), ['a', 'c']);
assert.deepEqual(filterNotebooks(notebooks, 'missing'), []);
assert.equal(filterNotebooks(notebooks, 'sales')[0], notebooks[1]);
assert.deepEqual(sortNotebooks(notebooks, 'modified').map(note => note.id), ['b', 'c', 'a']);
assert.deepEqual(sortNotebooks(notebooks, 'name').map(note => note.id), ['c', 'a', 'b']);
assert.equal(notebooks[0].id, 'a');
console.log('Notebook Home search and sort checks passed.');
