type Execution = { dataset_id: string; operation_type: string; parameters: string };
type Source = { id: string; name: string };

export function registeredSourceName(execution: Pick<Execution, 'dataset_id'>, sources: Source[]): string {
  return sources.find(source => source.id === execution.dataset_id)?.name || 'Source unavailable';
}

function filterText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const filter = value as Record<string, unknown>;
  if (filter.op === 'and' || filter.op === 'or') {
    if (!Array.isArray(filter.conditions)) return null;
    const parts = filter.conditions.map(filterText);
    return parts.length && parts.every(Boolean) ? `(${parts.join(` ${filter.op.toUpperCase()} `)})` : null;
  }
  if (typeof filter.column !== 'string') return null;
  const comparison: Record<string, string> = { eq: '=', ne: '≠', gt: '>', lt: '<', ge: '≥', le: '≤', contains: 'contains', is_null: 'is null', is_not_null: 'is not null' };
  if (typeof filter.op !== 'string' || !Object.hasOwn(comparison, filter.op)) return null;
  const symbol = comparison[filter.op];
  if (filter.op === 'is_null' || filter.op === 'is_not_null') return `${JSON.stringify(filter.column)} ${symbol}`;
  return typeof filter.value === 'string' ? `${JSON.stringify(filter.column)} ${symbol} ${JSON.stringify(filter.value)}` : null;
}

export function describeNotebookExecution(execution: Pick<Execution, 'operation_type' | 'parameters'>): { operation: string; summary: string } {
  const operation = execution.operation_type === 'group' ? 'Group and summarize' : execution.operation_type === 'rows' ? 'Filter and view rows' : `Operation: ${execution.operation_type}`;
  try {
    const params: unknown = JSON.parse(execution.parameters);
    if (!params || typeof params !== 'object' || Array.isArray(params)) return { operation, summary: 'Configuration unavailable' };
    const request = params as Record<string, unknown>;
    const parts: string[] = [];
    if (request.filters) parts.push(`Filter ${filterText(request.filters) ?? 'unavailable'}`);
    if (execution.operation_type === 'group' && Array.isArray(request.group_by) && request.group_by.every(value => typeof value === 'string')) parts.push(request.group_by.length ? `Group by ${request.group_by.map(value => JSON.stringify(value)).join(', ')}` : 'Group all rows');
    if (execution.operation_type === 'group' && Array.isArray(request.aggregations) && request.aggregations.every(value => value && typeof value === 'object' && typeof value.op === 'string' && typeof value.alias === 'string')) parts.push(`Measures ${(request.aggregations as { op: string; column?: string; alias: string }[]).map(value => `${value.op}${typeof value.column === 'string' ? ` ${JSON.stringify(value.column)}` : ''} as ${JSON.stringify(value.alias)}`).join(', ')}`);
    if (Array.isArray(request.sort) && request.sort.every(value => value && typeof value === 'object' && typeof value.column === 'string' && typeof value.direction === 'string')) parts.push(request.sort.length ? `Sort ${request.sort.map(value => `${JSON.stringify(value.column)} ${value.direction}`).join(', ')}` : 'No sort');
    if (typeof request.limit === 'number' && Number.isInteger(request.limit)) parts.push(`${request.limit} rows/page`);
    if (typeof request.offset === 'number' && Number.isInteger(request.offset) && request.offset > 0) parts.push(`Offset ${request.offset}`);
    const summary = parts.join(' · ') || 'Configuration unavailable';
    return { operation, summary: summary.length > 160 ? `${summary.slice(0, 157)}…` : summary };
  } catch { return { operation, summary: 'Configuration unavailable' }; }
}

export function notebookExecutionLabel(execution: Execution & { id: string; started_at: string }, sources: Source[]): string {
  const { operation, summary } = describeNotebookExecution(execution);
  const concise = summary.length > 90 ? `${summary.slice(0, 87)}…` : summary;
  return `Registered source: ${registeredSourceName(execution, sources)} · ${operation} · ${concise} · ${new Date(execution.started_at).toLocaleString()} · ${execution.id.slice(0, 8)}`;
}
