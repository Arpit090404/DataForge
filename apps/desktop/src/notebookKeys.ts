type NotebookKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function decideNotebookKey(event: NotebookKey, editing: boolean, interactive: boolean): string | null {
  const key = event.key.toLowerCase();
  if (editing && key === 'escape') return 'command';
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) {
    if (key === 's' && (!interactive || editing)) return 'save-notebook';
    if (key === 'enter' && (!interactive || editing)) return 'save';
    return null;
  }
  if (event.shiftKey) return key === 'enter' && (!interactive || editing) ? 'save-next' : null;
  if (interactive) return null;
  if (editing) return null;
  return ({ escape: 'command', enter: 'edit', arrowup: 'prev', arrowdown: 'next', a: 'above', b: 'below', d: 'delete', m: 'markdown' } as Record<string, string>)[key] ?? null;
}

export function decideDeletePress(armedId: string | null, selectedId: string, repeat: boolean): 'ignore' | 'arm' | 'delete' {
  if (repeat) return 'ignore';
  return armedId === selectedId ? 'delete' : 'arm';
}
