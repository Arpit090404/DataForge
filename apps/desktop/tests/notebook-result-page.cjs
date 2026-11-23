const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const filename = path.resolve(__dirname, '../src/notebookResultPage.ts');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const helper = new Module(filename, module);
helper.filename = filename;
helper.paths = Module._nodeModulePaths(path.dirname(filename));
helper._compile(compiled, filename);
const { savedResultPage, previousResultPage, nextResultPage, resultRowRange } = helper.exports;

assert.deepEqual(savedResultPage(JSON.stringify({ kind: 'rows', offset: 25, limit: 25 })), { offset: 25, limit: 25 });
assert.deepEqual(savedResultPage(JSON.stringify({ kind: 'group' })), { offset: 0, limit: 100 });
assert.deepEqual(savedResultPage('{broken'), { offset: 0, limit: 100 });
assert.deepEqual(savedResultPage(JSON.stringify({ offset: -1, limit: 300 })), { offset: 0, limit: 100 });
assert.deepEqual(previousResultPage({ offset: 25, limit: 50 }), { offset: 0, limit: 50 });
assert.equal(previousResultPage({ offset: 0, limit: 50 }), null);
assert.deepEqual(nextResultPage({ offset: 50, limit: 50 }, true), { offset: 100, limit: 50 });
assert.equal(nextResultPage({ offset: 50, limit: 50 }, false), null);
assert.equal(nextResultPage({ offset: 100_000, limit: 50 }, true), null);
assert.equal(resultRowRange({ offset: 50, limit: 50 }, 17, false), 'Rows 51–67 · final page');
assert.equal(resultRowRange({ offset: 0, limit: 25 }, 25, true), 'Rows 1–25 · more available');
assert.equal(resultRowRange({ offset: 0, limit: 25 }, 0, false), 'No rows');
assert.equal(resultRowRange({ offset: 25, limit: 25 }, 0, false), 'No rows at offset 25');
assert.equal(resultRowRange({ offset: 100_000, limit: 25 }, 25, true), `Rows ${(100_001).toLocaleString()}–${(100_025).toLocaleString()} · page limit reached`);
console.log('Notebook result pagination checks passed.');
