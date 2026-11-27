const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file) {
  const filename = path.resolve(__dirname, `../src/${file}`);
  const code = esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react-dom', '@base-ui/react', '@tauri-apps/api/core', 'lucide-react'] }).outputFiles[0].text;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(code, filename);
  return compiled.exports;
}

const { resultAccessName, sqlReference, pythonReference } = load('notebookDataRefs.ts');
const { default: NotebookSessionResults, SessionResultItem, matchesResult } = load('NotebookSessionResults.tsx');
const result = { id: '33333333-3333-3333-3333-333333333333', name: 'totals', execution_id: 'execution', created_at: '2026-11-27',
  available: true, stale: false, columns: [{ name: 'amount', data_type: 'decimal' }], row_count: 2,
  operation_type: 'python', provenance: { inputs: [{ kind: 'dataset', id: 'dataset' }] } };
const unavailable = { ...result, id: '55555555-5555-5555-5555-555555555555', name: null, available: false, stale: true, row_count: null, columns: [] };
assert.equal(matchesResult('DECIMAL', result), true);
assert.equal(matchesResult('missing', result), false);
assert.equal(matchesResult('5555', unavailable), true);
assert.equal(resultAccessName(result, [{ id: 'other', name: 'TOTALS' }]), 'result_33333333333333333333333333333333');
assert.equal(sqlReference('totals'), '"totals"');
assert.equal(pythonReference('result', 'totals'), 'dataforge.result("totals")');

const shell = renderToStaticMarkup(React.createElement(NotebookSessionResults, { projectId: 'project', datasets: [], revision: 0, search: '', onReleased() {} }));
assert.match(shell, /Session Results/);
assert.doesNotMatch(shell, /Registered Datasets|Persisted Named Results/);
const rendered = renderToStaticMarkup(React.createElement(SessionResultItem, { item: result, selected: true, onSelect() {}, onCopy() {}, onRelease() {} }));
assert.match(rendered, /2 complete rows/);
assert.match(rendered, /amount: decimal/);
assert.match(rendered, /Copy SQL/);
assert.match(rendered, /Copy Python/);
assert.match(rendered, /Release/);
assert.match(rendered, /Execution ID/);
assert.doesNotMatch(rendered, /truncated|sampled/i);
const unavailableMarkup = renderToStaticMarkup(React.createElement(SessionResultItem, { item: unavailable, selected: true, onSelect() {}, onCopy() {}, onRelease() {} }));
assert.match(unavailableMarkup, /Unavailable/);
assert.match(unavailableMarkup, /Rows unavailable/);
assert.match(unavailableMarkup, /disabled/);
assert.doesNotMatch(unavailableMarkup, />Release</);

const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
const styles = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');
assert.match(app, /\{notebookMode && project && <NotebookSessionResults/);
assert.match(app, /\{mode !== 'Notebook' && <IconButton label=\{!inspectorCanShow/);
assert.doesNotMatch(app, /sources-footer|NotebookDataExplorer/);
assert.match(app, /Search sources and session results/);
assert.match(styles, /\.notebook-mode \.body-grid\{grid-template-columns:var\(--sidebar-width\) minmax\(0,1fr\)\}/);
assert.match(styles, /\.session-results-popup\{[^}]*max-height:/);
console.log('Notebook session results, search, and left-rail layout checks passed.');
