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
const { filterNotebooks } = homeModule.exports;

const notebooks = [
  { id: 'a', title: 'Revenue Notes', block_count: 3 },
  { id: 'b', title: 'Sales Analysis', block_count: 8 },
  { id: 'c', title: 'revenue checks', block_count: 1 },
];
assert.deepEqual(filterNotebooks(notebooks, ''), notebooks);
assert.deepEqual(filterNotebooks(notebooks, '  REVENUE  ').map(note => note.id), ['a', 'c']);
assert.deepEqual(filterNotebooks(notebooks, 'missing'), []);
assert.equal(filterNotebooks(notebooks, 'sales')[0], notebooks[1]);
console.log('Notebook Home search checks passed.');
