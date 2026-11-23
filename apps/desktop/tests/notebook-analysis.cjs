const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const filename = path.resolve(__dirname, '../src/notebookAnalysis.ts');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const helper = new Module(filename, module);
helper.filename = filename;
helper.paths = Module._nodeModulePaths(path.dirname(filename));
helper._compile(compiled, filename);
const { defaultConfiguration, configurationFromExecution, buildNotebookRequest } = helper.exports;
const columns = [{ name: 'region', data_type: 'text' }, { name: 'sales', data_type: 'decimal' }];

const rows = { ...defaultConfiguration(), filters: [{ column: 'region', op: 'eq', value: 'East' }], sort: [{ column: 'sales', direction: 'desc', nulls: 'last' }] };
assert.deepEqual(buildNotebookRequest(rows, columns), { kind: 'rows', limit: 100, offset: 0, filters: { op: 'and', conditions: rows.filters }, sort: rows.sort });
const grouped = { ...defaultConfiguration(), kind: 'group', groupBy: ['region'], aggregations: [{ op: 'sum', column: 'sales', alias: 'total_sales' }, { op: 'count', alias: 'row_count' }], sort: [{ column: 'total_sales', direction: 'desc', nulls: 'last' }], limit: 50 };
const request = buildNotebookRequest(grouped, columns);
assert.deepEqual(request.group_by, ['region']);
assert.deepEqual(request.aggregations, [{ op: 'sum', column: 'sales', alias: 'total_sales' }, { op: 'count', alias: 'row_count' }]);
assert.deepEqual(configurationFromExecution(JSON.stringify(request)), grouped);
assert.equal(configurationFromExecution(JSON.stringify({ ...request, filters: { op: 'and', conditions: [{ op: 'or', conditions: [] }] } })), null);
assert.equal(configurationFromExecution(JSON.stringify({ ...request, sort: [null] })), null);
assert.throws(() => buildNotebookRequest({ ...grouped, aggregations: [{ op: 'sum', column: 'region', alias: 'bad' }] }, columns), /numeric/);
assert.throws(() => buildNotebookRequest({ ...rows, filters: [{ column: 'region', op: 'eq', value: '' }] }, columns), /filter/);
assert.throws(() => buildNotebookRequest({ ...rows, limit: 201 }, columns), /1–200/);
console.log('Notebook typed analysis request and edit checks passed.');
