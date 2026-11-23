export type ResultPage = { offset: number; limit: number };

export function savedResultPage(parameters: string): ResultPage {
  try {
    const request: unknown = JSON.parse(parameters);
    if (request && typeof request === 'object' && !Array.isArray(request)) {
      const { offset, limit } = request as Record<string, unknown>;
      if ((offset === undefined || Number.isInteger(offset) && (offset as number) >= 0 && (offset as number) <= 100_000) &&
          (limit === undefined || Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 200)) {
        return { offset: (offset ?? 0) as number, limit: (limit ?? 100) as number };
      }
    }
  } catch { /* The backend will report invalid saved parameters on replay. */ }
  return { offset: 0, limit: 100 };
}

export function previousResultPage(page: ResultPage): ResultPage | null {
  return page.offset > 0 ? { ...page, offset: Math.max(0, page.offset - page.limit) } : null;
}

export function nextResultPage(page: ResultPage, hasMore: boolean): ResultPage | null {
  return hasMore && page.offset + page.limit <= 100_000 ? { ...page, offset: page.offset + page.limit } : null;
}

export function resultRowRange(page: ResultPage, rowCount: number, hasMore: boolean): string {
  if (!rowCount) return page.offset ? `No rows at offset ${page.offset.toLocaleString()}` : 'No rows';
  const status = !hasMore ? 'final page' : nextResultPage(page, true) ? 'more available' : 'page limit reached';
  return `Rows ${(page.offset + 1).toLocaleString()}–${(page.offset + rowCount).toLocaleString()} · ${status}`;
}
