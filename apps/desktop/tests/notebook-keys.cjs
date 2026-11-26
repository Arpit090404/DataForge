const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const filename = path.resolve(__dirname, '../src/notebookKeys.ts');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const keyModule = new Module(filename, module);
keyModule.filename = filename;
keyModule.paths = Module._nodeModulePaths(path.dirname(filename));
keyModule._compile(compiled, filename);
const { decideNotebookKey, decideDeletePress, editCodeIndent } = keyModule.exports;
const key = (name, flags = {}, editing = false, interactive = false) => decideNotebookKey({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...flags }, editing, interactive);

for (const [name, expected] of Object.entries({ Escape: 'command', Enter: 'edit', ArrowUp: 'prev', ArrowDown: 'next', A: 'above', b: 'below', d: 'delete' })) {
  assert.equal(key(name), expected, name);
}
assert.equal(key('M'), null);
assert.equal(key('Enter', { shiftKey: true }), 'save-next');
assert.equal(key('Enter', { ctrlKey: true }), 'save');
assert.equal(key('s', { ctrlKey: true }), 'save-notebook');
assert.equal(key('Escape', {}, true, true), 'command');
assert.equal(key('Enter', { shiftKey: true }, true, true), 'save-next');
assert.equal(key('Enter', { ctrlKey: true }, true, true), 'save');
assert.equal(key('s', { ctrlKey: true }, true, true), 'save-notebook');
for (const name of ['a', 'd', 'ArrowDown', 'Enter']) {
  assert.equal(key(name, {}, true, true), null, `editing ${name}`);
  assert.equal(key(name, {}, false, true), null, `interactive ${name}`);
}
assert.equal(key('s', { ctrlKey: true }, false, true), null);
assert.equal(key('a', { altKey: true }), null);
assert.equal(key('a', { metaKey: true }), null);
assert.equal(key('a', { shiftKey: true }), null);
assert.equal(key('d', { ctrlKey: true }), null);
assert.equal(decideDeletePress(null, 'one', false), 'arm');
assert.equal(decideDeletePress('one', 'one', true), 'ignore');
assert.equal(decideDeletePress('one', 'two', false), 'arm');
assert.equal(decideDeletePress('one', 'one', false), 'delete');
assert.deepEqual(editCodeIndent('print(1)', 0, 0, 'Tab', false, 'python'), ['  print(1)', 2, 2]);
assert.deepEqual(editCodeIndent('if x:', 5, 5, 'Enter', false, 'python'), ['if x:\n  ', 8, 8]);
assert.deepEqual(editCodeIndent('  value', 7, 7, 'Enter', false, 'python'), ['  value\n  ', 10, 10]);
assert.deepEqual(editCodeIndent('SELECT (', 8, 8, 'Enter', false, 'sql'), ['SELECT (\n  ', 11, 11]);
assert.deepEqual(editCodeIndent('a\nb', 0, 3, 'Tab', false, 'python'), ['  a\n  b', 2, 7]);
assert.deepEqual(editCodeIndent('  a\n  b', 2, 7, 'Tab', true, 'python'), ['a\nb', 0, 3]);
assert.deepEqual(editCodeIndent('a\nb', 0, 2, 'Tab', false, 'python'), ['  a\nb', 2, 4]);
console.log('Notebook keyboard decision checks passed.');
