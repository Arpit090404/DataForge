const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/Notebook.tsx');
const code = esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', '@base-ui/react', '@tauri-apps/api/core', 'lucide-react'] }).outputFiles[0].text;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(code, filename);
const { SqlCodePanel, PythonCodePanel, PythonOutputView, codeExecutionForBlock } = compiled.exports;

const sql = 'SELECT Name FROM source';
const execution = { id: 'execution', dataset_id: 'dataset', operation_type: 'sql',
  parameters: JSON.stringify({ version: 1, code_block_id: 'code', sql }),
  status: 'succeeded', started_at: '2026-11-24T10:00:00Z', completed_at: '2026-11-24T10:00:00.100Z',
  source_fingerprint: 'fingerprint', duckdb_version: '1.4.5' };
assert.equal(codeExecutionForBlock([{ ...execution, operation_type: 'rows' }, execution], 'code'), execution);
assert.equal(codeExecutionForBlock([execution], 'other'), undefined);
assert.equal(codeExecutionForBlock([{ ...execution, parameters: '{bad' }], 'code'), undefined);

const props = { sqlText: sql, sources: [{ id: 'dataset', name: 'sample.csv', status: 'ready' }], sourceId: 'dataset',
  onSourceChange() {}, result: { columns: [{ name: 'Name', data_type: 'text' }], rows: [['Ada']], has_more: false },
  execution, error: undefined, running: false, disabled: false, canCancel: false, onRun() {}, onCancel() {} };
const html = renderToStaticMarkup(React.createElement(SqlCodePanel, props));
assert.match(html, /Run SQL/);
assert.match(html, /local.*privileges/);
assert.match(html, /not an OS sandbox/);
assert.match(html, /Ada/);
assert.match(html, /100 ms/);
assert.match(html, /fingerprint/);
assert.match(renderToStaticMarkup(React.createElement(SqlCodePanel, { ...props, sqlText: 'SELECT Value FROM source' })), /Code changed since run/);
assert.match(renderToStaticMarkup(React.createElement(SqlCodePanel, { ...props, running: true, canCancel: true })), /Cancel/);
assert.match(renderToStaticMarkup(React.createElement(SqlCodePanel, { ...props, result: undefined, error: 'Syntax error' })), /Syntax error/);
assert.match(renderToStaticMarkup(React.createElement(SqlCodePanel, { ...props, result: { ...props.result, restored: true } })), /Stored output from an earlier execution/);
console.log('Notebook SQL output and provenance rendering passed.');
const pythonHtml = renderToStaticMarkup(React.createElement(PythonCodePanel, {
  environments: [{ path: 'C:/python.exe', version: '3.12' }], selected: 'C:/python.exe', onSelect() {}, onBrowse() {},
  onRun() {}, onInterrupt() {}, onRestart() {}, running: false, disabled: false, code: 'print(1)',
  result: { status: 'succeeded', count: 2, duration_ms: 15, python: '3.12', outputs: [{ kind: 'stdout', text: 'hello' }, { kind: 'result', text: '7' }] },
}));
assert.match(pythonHtml, /Run Python/); assert.match(pythonHtml, /Restart kernel/);
assert.match(pythonHtml, /local.*privileges|full file and network privileges/); assert.match(pythonHtml, /hello/); assert.match(pythonHtml, /7/);
const restoredPython = renderToStaticMarkup(React.createElement(PythonCodePanel, {
  environments: [], selected: '', onSelect() {}, onBrowse() {}, onRun() {}, onInterrupt() {}, onRestart() {},
  running: false, disabled: false, code: 'print(2)',
  result: { status: 'succeeded', count: 1, duration_ms: 10, python: '3.12', recorded_code: 'print(1)', restored: true,
    outputs: [{ kind: 'stdout', text: '1' }] },
}));
assert.match(restoredPython, /Code changed since run/);
assert.match(restoredPython, /kernel state was not restored/);
console.log('Notebook Python controls and output rendering passed.');
const table = renderToStaticMarkup(React.createElement(PythonOutputView, { output: {
  kind: 'table', text: 'plain fallback', columns: ['name'], rows: [['<script>window.evil=true</script>']], truncated: true,
} }));
assert.match(table, /data-slot="table"/); assert.match(table, /Plain text/);
assert.match(table, /&lt;script&gt;/); assert.doesNotMatch(table, /<script>/);
const image = renderToStaticMarkup(React.createElement(PythonOutputView, { output: {
  kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=', text: 'chart',
} }));
assert.match(image, /src="data:image\/png;base64,iVBORw0KGgo=/);
const unsafe = renderToStaticMarkup(React.createElement(PythonOutputView, { output: {
  kind: 'image', mime: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=', text: '<img onerror=alert(1)>',
} }));
assert.doesNotMatch(unsafe, /<img/); assert.match(unsafe, /&lt;img/);
console.log('Notebook rich Python table, image, and unsafe payload rendering passed.');
