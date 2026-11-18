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

const { analysisSettingsKey, isAnalysisResultStale, canExportAnalysisResult, describeFilter, describeAggregation } = require(path.resolve(__dirname, '../src/App.tsx'));
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
console.log('Analysis result freshness, export guard, and summary checks passed.');
