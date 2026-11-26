export type CodeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export async function runCodeSequence<T extends { id: string }>(
  cells: T[], execute: (cell: T) => Promise<'completed' | 'failed' | 'cancelled'>,
  stopped: () => boolean, update: (id: string, status: CodeRunStatus | null) => void,
): Promise<void> {
  cells.forEach(cell => update(cell.id, 'queued'));
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (stopped()) { cells.slice(index).forEach(item => update(item.id, null)); return; }
    update(cell.id, 'running');
    let status: 'completed' | 'failed' | 'cancelled';
    try { status = await execute(cell); }
    catch { status = 'failed'; }
    update(cell.id, status);
    if (status !== 'completed' || stopped()) {
      cells.slice(index + 1).forEach(item => update(item.id, null));
      return;
    }
  }
}
