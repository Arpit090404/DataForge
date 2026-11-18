const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const { analysisSettingsKey, isAnalysisResultStale, canExportAnalysisResult, describeFilter, describeAggregation, describeAnalysisOperation, describeExecution, executionStatus } = require(path.resolve(__dirname, '../src/App.tsx'));
const base = {
  kind: 'rows', filters: { op: 'and', conditions: [{ column: 'city', op: 'eq', value: 'Paris' }] },
  sort: [{ column: 'sales', direction: 'desc', nulls: 'last' }], groupBy: [],
  aggregations: [{ op: 'count', alias: 'count_rows' }], limit: 100,
};
const settings = analysisSettingsKey(base);
const result = { settings, invalidated: false };
assert.equal(isAnalysisResultStale(result, settings), false);
assert.equal(canExportAnalysisResult(result, settings, false), true);
assert.equal(canExportAnalysisResult(result, settings, true), false);
assert.equal(canExportAnalysisResult(null, settings, false), false);

for (const changed of [
  { kind: 'group' },
  { filters: { op: 'and', conditions: [{ column: 'city', op: 'eq', value: 'Rome' }] } },
  { sort: [{ column: 'sales', direction: 'asc', nulls: 'last' }] },
  { groupBy: ['city'] },
  { aggregations: [{ op: 'sum', column: 'sales', alias: 'total' }] },
  { limit: 50 },
]) {
  const edited = analysisSettingsKey({ ...base, ...changed });
  assert.equal(isAnalysisResultStale(result, edited), true);
  assert.equal(canExportAnalysisResult(result, edited, false), false);
  assert.equal(canExportAnalysisResult({ settings: edited, invalidated: false }, edited, false), true);
}

// An unsuccessful rerun must keep an older result stale even after the form is restored.
const failedRerun = { settings, invalidated: true };
assert.equal(isAnalysisResultStale(failedRerun, settings), true);
assert.equal(canExportAnalysisResult(failedRerun, settings, false), false);
assert.equal(describeFilter({ op: 'and', conditions: [
  { column: 'city', op: 'eq', value: 'Paris' },
  { op: 'or', conditions: [{ column: 'sales', op: 'gt', value: '10' }, { column: 'sales', op: 'is_null' }] },
] }), '("city" = "Paris" AND ("sales" > "10" OR "sales" is null))');
assert.equal(describeAggregation({ op: 'sum', column: 'sales', alias: 'total' }), 'Sum of "sales" as "total"');
assert.equal(describeAnalysisOperation(base), 'View rows · Filtered · Sort by 1 column · 100 rows/page');
assert.equal(describeAnalysisOperation({ ...base, kind: 'group', groupBy: ['city', 'region'], aggregations: [{ op: 'count', alias: 'count_rows' }] }), 'Group by 2 columns · 1 measure · Filtered · Sort by 1 column · 100 rows/page');
assert.match(describeAnalysisOperation({ ...base, filters: { op: 'or', conditions: [{ column: 'city', op: 'eq', value: '' }] } }), /Incomplete filter/);
const execution = { operation_type: 'group', started_at: '2026-11-19T10:00:00Z', completed_at: '2026-11-19T10:00:01.250Z', parameters: JSON.stringify({ kind: 'group', filters: base.filters, group_by: ['city'], aggregations: [{ op: 'sum', column: 'sales', alias: 'total' }], sort: base.sort, limit: 50, offset: 50 }) };
assert.deepEqual(describeExecution(execution), { operation: 'Group and summarize', duration: '1.3 s', configuration: [
  ['Filters', '("city" = "Paris")'], ['Group by', '"city"'], ['Measures', 'Sum of "sales" as "total"'],
  ['Sort', '"sales" descending, nulls last'], ['Page size', '50 rows'], ['Offset', '50 rows'],
] });
assert.deepEqual(describeExecution({ ...execution, operation_type: 'rows', completed_at: null, parameters: '{}' }), { operation: 'Filter and view rows', configuration: [], duration: '—' });
assert.deepEqual(describeExecution({ ...execution, operation_type: 'future', parameters: '{broken' }), { operation: 'Operation: future', configuration: [], duration: '1.3 s' });
for (const [status, label] of [['succeeded', 'Succeeded'], ['failed', 'Failed'], ['cancelled', 'Cancelled'], ['interrupted', 'Interrupted'], ['running', 'Running'], ['queued', 'Queued']]) assert.equal(executionStatus(status), label);
console.log('Analysis result freshness, export guard, and summary checks passed.');
