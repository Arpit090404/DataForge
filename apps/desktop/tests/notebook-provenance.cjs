const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const filename = path.resolve(__dirname, '../src/notebookProvenance.ts');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const helper = new Module(filename, module);
helper.filename = filename;
helper.paths = Module._nodeModulePaths(path.dirname(filename));
helper._compile(compiled, filename);
const { describeNotebookExecution, notebookExecutionLabel, registeredSourceName } = helper.exports;

const sources = [{ id: 'dataset-1', name: 'sales.csv' }];
const base = { id: 'a1b2c3d4-full', dataset_id: 'dataset-1', operation_type: 'rows', started_at: '2026-11-19T10:00:00Z' };
const run = value => ({ ...base, parameters: JSON.stringify({ kind: 'rows', filters: { column: 'city', op: 'eq', value }, sort: [], limit: 100, offset: 0 }) });
const paris = notebookExecutionLabel(run('Paris'), sources);
const rome = notebookExecutionLabel({ ...run('Rome'), id: 'e5f6a7b8-full' }, sources);
assert.match(paris, /Registered source: sales\.csv.*Filter and view rows.*Paris.*a1b2c3d4/);
assert.match(rome, /Rome/);
assert.notEqual(paris, rome);
assert.notEqual(paris, notebookExecutionLabel({ ...run('Paris'), id: 'e5f6a7b8-full' }, sources));
assert.equal(registeredSourceName(base, []), 'Source unavailable');
assert.match(notebookExecutionLabel(run('Paris'), []), /^Registered source: Source unavailable/);
assert.match(notebookExecutionLabel(run('Paris'), [{ id: 'dataset-1', name: 'renamed.csv' }]), /^Registered source: renamed\.csv/);

const group = describeNotebookExecution({ operation_type: 'group', parameters: JSON.stringify({ kind: 'group', filters: null, group_by: ['region'], aggregations: [{ op: 'sum', column: 'sales', alias: 'total' }], sort: [{ column: 'total', direction: 'desc' }], limit: 50 }) });
assert.equal(group.operation, 'Group and summarize');
assert.match(group.summary, /Group by "region".*Measures sum "sales" as "total".*Sort "total" desc.*50 rows\/page/);
assert.notEqual(group.summary, describeNotebookExecution({ operation_type: 'group', parameters: JSON.stringify({ kind: 'group', group_by: ['region'], aggregations: [{ op: 'sum', column: 'tax', alias: 'total' }], sort: [{ column: 'total', direction: 'desc' }], limit: 50 }) }).summary);
assert.equal(describeNotebookExecution({ operation_type: 'rows', parameters: '{broken' }).summary, 'Configuration unavailable');
assert.match(describeNotebookExecution({ operation_type: 'rows', parameters: JSON.stringify({ filters: { column: 'city', op: 'toString', value: 'Paris' } }) }).summary, /Filter unavailable/);
assert.ok(describeNotebookExecution({ operation_type: 'rows', parameters: JSON.stringify({ filters: { column: 'city', op: 'eq', value: 'x'.repeat(500) } }) }).summary.length <= 160);
console.log('Notebook provenance labels and fallbacks passed.');
