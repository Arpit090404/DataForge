export type Column = { name: string; data_type: string };
export type Filter = { column: string; op: 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'contains' | 'is_null' | 'is_not_null'; value?: string };
export type Sort = { column: string; direction: 'asc' | 'desc'; nulls: 'first' | 'last' };
export type Aggregation = { op: 'count' | 'sum' | 'average' | 'min' | 'max' | 'distinct_count'; column?: string; alias: string };
export type Configuration = { kind: 'rows' | 'group'; filters: Filter[]; combination: 'and' | 'or'; sort: Sort[]; groupBy: string[]; aggregations: Aggregation[]; limit: number };

export function defaultConfiguration(): Configuration {
  return { kind: 'rows', filters: [], combination: 'and', sort: [], groupBy: [], aggregations: [{ op: 'count', alias: 'row_count' }], limit: 100 };
}

export function configurationFromExecution(parameters: string): Configuration | null {
  try {
    const request = JSON.parse(parameters);
    if (!request || !['rows', 'group'].includes(request.kind)) return null;
    const filters = request.filters ? request.filters.conditions : [];
    if (request.filters && (!['and', 'or'].includes(request.filters.op) || !Array.isArray(filters) || filters.some((item: unknown) => !item || typeof item !== 'object' || 'conditions' in item))) return null;
    if ((filters ?? []).some((item: Filter) => typeof item.column !== 'string' || !['eq', 'ne', 'gt', 'lt', 'ge', 'le', 'contains', 'is_null', 'is_not_null'].includes(item.op) || (!['is_null', 'is_not_null'].includes(item.op) && typeof item.value !== 'string'))) return null;
    if (request.sort != null && (!Array.isArray(request.sort) || request.sort.some((item: Sort) => !item || typeof item.column !== 'string' || !['asc', 'desc'].includes(item.direction) || !['first', 'last'].includes(item.nulls)))) return null;
    if (request.group_by != null && (!Array.isArray(request.group_by) || request.group_by.some((name: unknown) => typeof name !== 'string'))) return null;
    if (request.aggregations != null && (!Array.isArray(request.aggregations) || request.aggregations.some((item: Aggregation) => !item || !['count', 'sum', 'average', 'min', 'max', 'distinct_count'].includes(item.op) || typeof item.alias !== 'string' || (item.op !== 'count' && typeof item.column !== 'string')))) return null;
    if (request.limit != null && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 200)) return null;
    return {
      kind: request.kind,
      filters: filters ?? [],
      combination: request.filters?.op ?? 'and',
      sort: Array.isArray(request.sort) ? request.sort : [],
      groupBy: Array.isArray(request.group_by) ? request.group_by : [],
      aggregations: Array.isArray(request.aggregations) && request.aggregations.length ? request.aggregations : [{ op: 'count', alias: 'row_count' }],
      limit: request.limit ?? 100,
    };
  } catch { return null; }
}

export function buildNotebookRequest(config: Configuration, columns: Column[]) {
  const names = columns.map(column => column.name);
  const output = config.kind === 'rows' ? names : [...config.groupBy, ...config.aggregations.map(item => item.alias)];
  if (!names.length) throw new Error('Choose a ready source with columns.');
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 200) throw new Error('Choose 1–200 rows per page.');
  if (config.filters.length > 12 || config.filters.some(item => !names.includes(item.column) || !['eq', 'ne', 'gt', 'lt', 'ge', 'le', 'contains', 'is_null', 'is_not_null'].includes(item.op) || (!['is_null', 'is_not_null'].includes(item.op) && !item.value?.length))) throw new Error('Complete each filter or remove it.');
  if (config.groupBy.length > 3 || new Set(config.groupBy).size !== config.groupBy.length || config.groupBy.some(name => !names.includes(name))) throw new Error('Choose up to three different group columns.');
  if (config.kind === 'group' && (!config.aggregations.length || config.aggregations.length > 6 || config.aggregations.some(item => !/^[a-zA-Z0-9_]{1,40}$/.test(item.alias) || (item.op !== 'count' && !names.includes(item.column ?? '')) || (['sum', 'average'].includes(item.op) && !columns.some(column => column.name === item.column && ['integer', 'decimal'].includes(column.data_type)))) || new Set(config.aggregations.map(item => item.alias.toLowerCase())).size !== config.aggregations.length || config.aggregations.some(item => config.groupBy.some(name => name.toLowerCase() === item.alias.toLowerCase())))) throw new Error('Check measure names and columns. Sum and average need numeric columns.');
  if (config.sort.length > 3 || config.sort.some(item => !output.includes(item.column))) throw new Error('Choose up to three sort columns in the result.');
  return {
    kind: config.kind,
    limit: config.limit,
    offset: 0,
    ...(config.filters.length ? { filters: { op: config.combination, conditions: config.filters.map(item => ['is_null', 'is_not_null'].includes(item.op) ? { column: item.column, op: item.op } : item) } } : {}),
    ...(config.sort.length ? { sort: config.sort } : {}),
    ...(config.kind === 'group' ? { group_by: config.groupBy, aggregations: config.aggregations.map(item => item.op === 'count' ? { op: item.op, alias: item.alias } : item) } : {}),
  };
}
