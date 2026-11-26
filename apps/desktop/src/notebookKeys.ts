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
  return ({ escape: 'command', enter: 'edit', arrowup: 'prev', arrowdown: 'next', a: 'above', b: 'below', d: 'delete' } as Record<string, string>)[key] ?? null;
}

export function decideDeletePress(armedId: string | null, selectedId: string, repeat: boolean): 'ignore' | 'arm' | 'delete' {
  if (repeat) return 'ignore';
  return armedId === selectedId ? 'delete' : 'arm';
}

export function editCodeIndent(text: string, start: number, end: number, key: 'Enter' | 'Tab', shift: boolean, language: 'python' | 'sql'): [string, number, number] {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (key === 'Enter') {
    const line = text.slice(lineStart, start);
    const base = line.match(/^[ \t]*/)?.[0] ?? '';
    const extra = language === 'python' ? /:\s*(?:#.*)?$/.test(line) : /(?:\(|\bCASE)\s*$/i.test(line);
    const inserted = `\n${base}${extra ? '  ' : ''}`;
    return [text.slice(0, start) + inserted + text.slice(end), start + inserted.length, start + inserted.length];
  }
  if (!shift && start === end) return [text.slice(0, start) + '  ' + text.slice(end), start + 2, start + 2];
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const changes: { at: number; remove: number; insert: string }[] = [];
  for (let at = lineStart; at <= last;) {
    const rest = text.slice(at);
    const remove = shift ? rest.startsWith('  ') ? 2 : rest.startsWith(' ') || rest.startsWith('\t') ? 1 : 0 : 0;
    if (remove || !shift) changes.push({ at, remove, insert: shift ? '' : '  ' });
    const next = text.indexOf('\n', at);
    if (next < 0 || next >= last) break;
    at = next + 1;
  }
  const move = (position: number) => {
    let delta = 0;
    for (const change of changes) {
      if (position < change.at) break;
      if (position < change.at + change.remove) return change.at + delta;
      delta += change.insert.length - change.remove;
    }
    return position + delta;
  };
  let result = text;
  for (const change of [...changes].reverse()) result = result.slice(0, change.at) + change.insert + result.slice(change.at + change.remove);
  return [result, move(start), move(end)];
}
