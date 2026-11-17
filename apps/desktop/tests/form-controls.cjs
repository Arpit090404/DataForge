const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    }).outputText,
    filename,
  );
}

const ui = path.resolve(__dirname, '../src/components/ui');
const { Input } = require(path.join(ui, 'input.tsx'));
const { Textarea } = require(path.join(ui, 'textarea.tsx'));
const { Select } = require(path.join(ui, 'select.tsx'));
const h = React.createElement;

const input = renderToStaticMarkup(h(Input, { defaultValue: 'draft', required: true, 'aria-invalid': true, 'aria-describedby': 'name-error' }));
assert.match(input, /<input\b[^>]*value="draft"/);
assert.match(input, /required=""/);
assert.match(input, /aria-invalid="true"/);
assert.match(input, /aria-describedby="name-error"/);
assert.match(renderToStaticMarkup(h(Input, { value: 'chosen', readOnly: true, disabled: true })), /<input\b[^>]*value="chosen"[^>]*\/>/);

const textarea = renderToStaticMarkup(h(Textarea, { defaultValue: 'first\nsecond', rows: 3, readOnly: true, 'aria-label': 'Cell editor' }));
assert.match(textarea, /<textarea\b[^>]*rows="3"[^>]*readonly=""/i);
assert.match(textarea, />first\nsecond<\/textarea>/);
assert.match(renderToStaticMarkup(h(Textarea, { value: 'edited', readOnly: true })), />edited<\/textarea>/);

const select = renderToStaticMarkup(h(Select, { defaultValue: 'sql', 'aria-label': 'Language' },
  h('option', { value: 'python' }, 'Python'), h('option', { value: 'sql' }, 'SQL'), h('option', { value: 'disabled', disabled: true }, 'Unavailable')));
assert.match(select, /<select\b[^>]*aria-label="Language"/);
assert.match(select, /<option value="sql" selected="">SQL<\/option>/);
assert.match(select, /<option value="disabled" disabled="">Unavailable<\/option>/);
assert.match(renderToStaticMarkup(h(Select, { value: 'python', onChange: () => {} },
  h('option', { value: 'python' }, 'Python'), h('option', { value: 'sql' }, 'SQL'))), /<option value="python" selected="">Python<\/option>/);
console.log('Form control prop and accessibility checks passed.');
