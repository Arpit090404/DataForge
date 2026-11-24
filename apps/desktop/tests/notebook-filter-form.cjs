const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/NotebookAnalysisForm.tsx');
const code = esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom', '@base-ui/react'] }).outputFiles[0].text;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(code, filename);
const { NotebookAnalysisForm } = compiled.exports;
const filters = { op: 'and', conditions: [{ column: 'region', op: 'eq', value: 'East' }, { op: 'or', conditions: [{ column: 'sales', op: 'ge', value: '100' }] }] };
const html = renderToStaticMarkup(React.createElement(NotebookAnalysisForm, {
  sources: [{ id: 'source', name: 'Source', status: 'ready' }], sourceId: 'source', onSourceChange() {},
  columns: [{ name: 'region', data_type: 'text' }, { name: 'sales', data_type: 'decimal' }], schemaLoading: false, schemaError: '',
  config: { kind: 'rows', filters, sort: [], groupBy: [], aggregations: [{ op: 'count', alias: 'row_count' }], limit: 100 },
  onConfigChange() {}, targetResultId: 'result', onNewResult() {}, running: false, canCancel: false, notice: '', error: '', onRun() {}, onCancel() {},
}));
assert.match(html, /Filters group 2 combination/);
assert.match(html, /Filters group 2 filter 1 value/);
assert.match(html, /value="100"/);
assert.match(html, /Remove Filters group 2/);
assert.match(html, /Rerun in cell/);
console.log('Nested Notebook filter form render checks passed.');
