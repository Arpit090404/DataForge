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

const { datasetAccessName, resultAccessName, sqlReference, pythonReference } = load('notebookDataRefs.ts');
const dataset = { id: '11111111-1111-1111-1111-111111111111', name: 'orders.csv', status: 'ready', registered_at: '2026-11-27', fingerprint: 'sha256' };
assert.equal(datasetAccessName(dataset, [dataset]), 'orders.csv');
assert.equal(datasetAccessName(dataset, [dataset, { ...dataset, id: '22222222-2222-2222-2222-222222222222' }]), 'dataset_11111111111111111111111111111111');
assert.equal(sqlReference('a"b.csv'), '"a""b.csv"');
assert.equal(pythonReference('dataset', 'a"b.csv'), 'dataforge.dataset("a\\"b.csv")');

const { default: NotebookDataExplorer, ExplorerResultItem, matchesExplorer, partitionResults } = load('NotebookDataExplorer.tsx');
const result = { id: '33333333-3333-3333-3333-333333333333', name: 'totals', execution_id: 'execution', created_at: '2026-11-27',
  available: true, stale: false, columns: [{ name: 'amount', data_type: 'decimal' }], row_count: 2,
  operation_type: 'python', notebook_id: 'current', provenance: { inputs: [{ kind: 'dataset', id: dataset.id }] } };
const previous = { ...result, id: '44444444-4444-4444-4444-444444444444', name: null, stale: true };
const unavailable = { ...previous, id: '55555555-5555-5555-5555-555555555555', available: false, row_count: null, columns: [] };
assert.equal(resultAccessName(previous), 'result_44444444444444444444444444444444');
assert.equal(resultAccessName(result, [{ id: 'another', name: 'TOTALS' }]), 'result_33333333333333333333333333333333');
assert.equal(matchesExplorer('DECIMAL', 'totals', result.id, result.columns), true);
assert.equal(matchesExplorer('missing', 'totals', result.id, result.columns), false);
const grouped = partitionResults([result, previous, unavailable], 'current', '');
assert.deepEqual(grouped.session.map(item => item.id), [result.id]);
assert.deepEqual(grouped.persisted.map(item => item.id), [previous.id, unavailable.id]);
assert.equal(partitionResults([result], null, '').session.length, 0);

const shell = renderToStaticMarkup(React.createElement(NotebookDataExplorer, { projectId: 'project', notebookId: 'current', datasets: [dataset], revision: 0, onRefreshSources: async () => {}, onReleased() {} }));
assert.match(shell, /Registered Datasets/);
assert.match(shell, /Session Results/);
assert.match(shell, /Persisted Named Results/);
assert.match(shell, /Search Data Explorer/);
assert.match(shell, /orders\.csv/);
assert.match(shell, /Rows unknown/);
const rendered = renderToStaticMarkup(React.createElement(ExplorerResultItem, { item: result, selected: true, onSelect() {}, onCopy() {}, onRelease() {} }));
assert.match(rendered, /totals/); assert.match(rendered, /2 complete rows/); assert.match(rendered, /amount: decimal/);
assert.match(rendered, /Copy SQL/); assert.match(rendered, /Copy Python/); assert.match(rendered, /Release/);
assert.match(rendered, /Execution ID/); assert.match(rendered, /dataset/);
assert.doesNotMatch(rendered, /truncated|sampled/i);
const unavailableMarkup = renderToStaticMarkup(React.createElement(ExplorerResultItem, { item: unavailable, selected: true, onSelect() {}, onCopy() {}, onRelease() {} }));
assert.match(unavailableMarkup, /Unavailable/); assert.match(unavailableMarkup, /Rows unavailable/);
assert.match(unavailableMarkup, /disabled/); assert.doesNotMatch(unavailableMarkup, />Release</);
const styles = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');
assert.match(styles, /\.notebook-mode \.body-grid\.sidebar-hidden\.inspector-hidden\{grid-template-columns:minmax\(0,1fr\)\}/);
assert.match(styles, /\.explorer-body\{[^}]*overflow-y:auto/);

// React may run a functional state update after the toggle event has finished.
// At that point its synthetic currentTarget has been cleared to null.
const explorerPath = path.resolve(__dirname, '../src/NotebookDataExplorer.tsx');
const interactiveCode = esbuild.buildSync({ entryPoints: [explorerPath], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react/jsx-runtime', '@tauri-apps/api/core', './components/ui/*'] }).outputFiles[0].text;
const pendingUpdates = [];
const fakeReact = { useEffect() {}, useState(initial) {
  let value = typeof initial === 'function' ? initial() : initial;
  return [value, update => pendingUpdates.push(() => { value = typeof update === 'function' ? update(value) : update; })];
} };
const fakeJsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const interactiveModule = new Module(explorerPath, module);
interactiveModule.filename = explorerPath;
interactiveModule.paths = Module._nodeModulePaths(path.dirname(explorerPath));
interactiveModule.require = function(request) {
  if (request === 'react') return fakeReact;
  if (request === 'react/jsx-runtime') return fakeJsx;
  if (request.startsWith('./components/ui/')) return { Badge() {}, Button() {}, ConfirmationDialog() {}, Input() {} };
  return Module.prototype.require.call(this, request);
};
interactiveModule._compile(interactiveCode, explorerPath);
const tree = interactiveModule.exports.default({ projectId: 'project', notebookId: null, datasets: [dataset], revision: 0, onRefreshSources: async () => {}, onReleased() {} });
function sections(node) {
  if (Array.isArray(node)) return node.flatMap(sections);
  if (!node || typeof node !== 'object') return [];
  return [node, ...sections(node.props?.children)];
}
const disclosureSections = sections(tree).filter(node => node.type === 'details' && node.props.className === 'explorer-section');
assert.equal(disclosureSections.length, 3);
for (const section of disclosureSections) {
  const event = { currentTarget: { open: false } };
  section.props.onToggle(event);
  event.currentTarget = null;
}
assert.doesNotThrow(() => pendingUpdates.forEach(update => update()), 'Section state updates must not read an expired event.currentTarget');

if (process.env.DATAFORGE_EXPLORER_HTML) {
  const asset = fs.readdirSync(path.resolve(__dirname, '../dist/assets')).find(name => name.endsWith('.css'));
  const css = fs.readFileSync(path.resolve(__dirname, '../dist/assets', asset), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"><div class="app-shell notebook-mode" style="--sidebar-width:248px"><header class="topbar"><div class="top-identity"><strong>DataForge</strong></div><div class="mode-switch"><button>Chat</button><button class="active">Notebook</button><button>Dashboard</button></div><div class="top-actions">Notebook inspector</div></header><div class="body-grid"><aside class="left-sidebar"><div class="section-heading">SOURCES</div><div class="source-list"><div class="source-item">orders.csv</div></div></aside><main class="main-workspace"><div class="workspace-content"><div class="notebook-surface"><div class="notebook-workspace notebook-editor"><header class="notebook-editor-toolbar"><h1>Quarterly research</h1></header><div class="notebook-blocks"><section class="notebook-block"><div class="notebook-code-preview"><div class="notebook-code-source"><pre>SELECT * FROM orders.csv</pre></div></div></section></div></div></div></div></main><aside class="inspector" aria-label="Notebook Data Explorer"><div class="inspector-header"><span>DATA EXPLORER</span></div><div class="explorer-body"><div class="explorer-controls"><input class="ui-input" placeholder="Search data and results"><button class="ui-button">Refresh</button></div><details class="explorer-section" open><summary>Registered Datasets <span>1</span></summary><div class="explorer-item"><button class="explorer-item-select"><span class="explorer-item-title">orders.csv</span><span class="explorer-item-meta">2 rows · 2 columns</span></button><span class="badge">Ready</span><div class="explorer-item-types">ID: integer · Amount: decimal</div></div></details><details class="explorer-section" open><summary>Session Results <span>1</span></summary>${rendered}</details><details class="explorer-section" open><summary>Persisted Named Results <span>1</span></summary>${unavailableMarkup}</details></div></aside></div></div></div></body></html>`;
  fs.writeFileSync(process.env.DATAFORGE_EXPLORER_HTML, html);
}
console.log('Notebook Data Explorer references, grouping, and rendered states passed.');
