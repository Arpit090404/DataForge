import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from './components/ui/table';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { ConfirmationDialog } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './components/ui/popover';
import { Select } from './components/ui/select';
import { Textarea } from './components/ui/textarea';
import { Markdown } from './Markdown';
import { decideDeletePress, decideNotebookKey, indentCode } from './notebookKeys';
import { filterNotebooks, sortNotebooks } from './notebookHome';
import { BookOpen, Plus, Search } from 'lucide-react';

type Execution = { id: string; dataset_id: string; operation_type: string; parameters: string; started_at: string; completed_at: string | null; status: string; result_row_count: number | null; error_summary: string | null; duckdb_version: string | null; source_fingerprint: string };
type Result = { execution: Execution; columns: { name: string; data_type: string }[]; rows: (string | null)[][]; total_rows: number | null; has_more: boolean };
type Block = { id: string; notebook_id: string; position: number; kind: 'markdown' | 'code' | 'result'; content: string; language: 'python' | 'sql' | null; execution_id: string | null; created_at: string; updated_at: string };
type Notebook = { id: string; title: string; created_at: string; updated_at: string; blocks: Block[] };
type Summary = { id: string; title: string; updated_at: string; block_count: number };

function InsertionSlot({ disabled, insert }: { disabled: boolean; insert: (kind: 'code' | 'markdown') => void }) {
  return <div className="notebook-insertion"><div className="notebook-insertion-actions"><button type="button" disabled={disabled} onClick={() => insert('code')}>+ Code</button><button type="button" disabled={disabled} onClick={() => insert('markdown')}>+ Text</button></div></div>;
}

function message(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') { try { return message(JSON.parse(error)); } catch { return error; } }
  return 'The notebook operation could not be completed.';
}

function ResultBlock({ executionId, execution: historyExecution }: { executionId: string; execution?: Execution }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!attempt) return;
    let current = true;
    setResult(null); setError('');
    invoke<Result>('get_execution_result', { executionId }).then(value => { if (current) setResult(value); }).catch(e => { if (current) setError(message(e)); });
    return () => { current = false; };
  }, [executionId, attempt]);
  const execution = result?.execution ?? historyExecution;
  return <div className="notebook-output">
    <div className="notebook-result-meta"><strong>{execution?.operation_type === 'group' ? 'Group and summarize' : 'Filter and view rows'}</strong><span>{execution?.dataset_id ?? 'Source unavailable'} · {execution?.status ?? 'Saved execution'} · {execution?.result_row_count ?? '—'} rows</span>{execution && <small>{new Date(execution.started_at).toLocaleString()} · {execution.duckdb_version ? `DuckDB ${execution.duckdb_version}` : 'Engine unavailable'}</small>}</div>
    {!attempt || error ? <div className="notebook-unavailable">{error && <p role="status">Result unavailable: {error}</p>}<Button size="small" onClick={() => setAttempt(value => value + 1)}>{error ? 'Retry result' : 'Load result'}</Button></div>
      : !result ? <p className="notebook-muted">Loading saved execution…</p>
        : <><div className="table-scroll"><Table><TableHeader><TableRow>{result.columns.map((column, i) => <TableHead key={i}><span>{column.name}</span><small>{column.data_type}</small></TableHead>)}</TableRow></TableHeader><TableBody>{result.rows.map((row, i) => <TableRow key={i}>{row.map((value, j) => <TableCell key={j}>{value ?? <span className="null-value">null</span>}</TableCell>)}</TableRow>)}</TableBody></Table>{!result.rows.length && <TableEmpty>No rows matched this operation.</TableEmpty>}</div><p className="notebook-muted">Showing {result.rows.length} rows{result.has_more ? ' · more rows available in the original operation' : ''}. Loaded from the pinned representation.</p></>}
    <details><summary>Execution details</summary><small>Execution ID: {executionId}{execution && <> · Fingerprint: {execution.source_fingerprint}</>}</small>{execution && <pre>{execution.parameters}</pre>}</details>
  </div>;
}

export default function NotebookWorkspace({ active, onDirtyChange, projectName }: { active: boolean; onDirtyChange: (dirty: boolean) => void; projectName?: string }) {
  const [notebooks, setNotebooks] = useState<Summary[]>([]);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [languages, setLanguages] = useState<Record<string, 'python' | 'sql'>>({});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'modified' | 'name'>('modified');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [executionId, setExecutionId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'notebook' | 'cell'; id: string; title?: string } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cursor = useRef<Record<string, [number, number]>>({});
  const dirty = Object.keys(drafts).length > 0 || Object.keys(languages).length > 0 || (!!notebook && title !== notebook.title) || (!!renamingId && renameTitle !== notebooks.find(item => item.id === renamingId)?.title);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (active && editingId) { editorRef.current?.focus(); const [start, end] = cursor.current[editingId] ?? [0, 0]; editorRef.current?.setSelectionRange(start, end); } }, [active, editingId]);
  useEffect(() => { if (renamingId) requestAnimationFrame(() => renameInputRef.current?.focus()); }, [renamingId]);
  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); }, []);
  async function refresh() { setNotebooks(await invoke<Summary[]>('list_notebooks')); }
  async function saveHomeRename() {
    if (!renamingId) return;
    if (renameTitle !== notebooks.find(item => item.id === renamingId)?.title) {
      await invoke('rename_notebook', { id: renamingId, title: renameTitle });
      await refresh();
    }
    setRenamingId(null);
  }
  useEffect(() => {
    if (!active) return;
    let current = true;
    Promise.all([invoke<Summary[]>('list_notebooks'), invoke<Execution[]>('list_executions')]).then(([notes, runs]) => { if (current) { setNotebooks(notes); setExecutions(runs.filter(run => run.status === 'succeeded')); } }).catch(e => { if (current) setError(message(e)); });
    return () => { current = false; };
  }, [active]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function load(id: string) { const next = await invoke<Notebook>('get_notebook', { id }); setNotebook(next); setTitle(next.title); setSelectedId(next.blocks[0]?.id ?? null); setEditingId(null); if (next.blocks[0]) focusCell(next.blocks[0].id); }
  async function reload(id = notebook?.id) { if (id) { setNotebook(await invoke<Notebook>('get_notebook', { id })); await refresh(); } }
  function select(id: string) { setSelectedId(id); if (editingId && editingId !== id) setEditingId(null); clearDelete(); }
  function focusCell(id: string) { requestAnimationFrame(() => cellRefs.current[id]?.focus()); }
  function commandMode() { if (editingId && editorRef.current) cursor.current[editingId] = [editorRef.current.selectionStart, editorRef.current.selectionEnd]; setEditingId(null); if (selectedId) focusCell(selectedId); }
  function clearDelete() { if (deleteTimer.current) clearTimeout(deleteTimer.current); deleteTimer.current = null; setDeleteArmed(null); }
  async function saveCell(id: string) {
    const block = notebook?.blocks.find(item => item.id === id);
    if (!block || block.kind === 'result') return;
    const draft = drafts[id] ?? block.content;
    const language = block.kind === 'code' ? languages[id] ?? block.language : null;
    if (draft === block.content && language === block.language) return;
    await invoke('update_block', { id, content: draft, language });
    await reload();
    setDrafts(current => { const next = { ...current }; if (next[id] === draft) delete next[id]; return next; });
    setLanguages(current => { const next = { ...current }; if (next[id] === language) delete next[id]; return next; });
  }
  async function saveNotebook() {
    if (!notebook) return;
    for (const block of notebook.blocks) await saveCell(block.id);
    if (title !== notebook.title) { const next = await invoke<Notebook>('rename_notebook', { id: notebook.id, title }); setNotebook(next); setTitle(next.title); await refresh(); }
  }
  async function insert(kind: 'markdown' | 'code', relativeTo?: string, placement?: 'before' | 'after') {
    if (!notebook) return;
    const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind, content: '', language: kind === 'code' ? 'python' : null, executionId: null, relativeTo, placement });
    await reload(); setSelectedId(block.id); setEditingId(block.id);
  }
  async function remove(id: string) {
    const index = notebook?.blocks.findIndex(block => block.id === id) ?? -1;
    const nextId = notebook?.blocks[index + 1]?.id ?? notebook?.blocks[index - 1]?.id ?? null;
    await invoke('delete_block', { id });
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setLanguages(current => { const next = { ...current }; delete next[id]; return next; });
    setSelectedId(nextId); setEditingId(null); clearDelete(); await reload(); if (nextId) focusCell(nextId);
  }
  async function move(id: string, direction: 'up' | 'down') { await invoke('move_block', { id, direction }); await reload(); setSelectedId(id); focusCell(id); }
  function armDelete(id: string, repeat: boolean) {
    const decision = decideDeletePress(deleteArmed, id, repeat);
    if (decision === 'ignore') return;
    if (decision === 'delete') { clearDelete(); void action(() => remove(id)); return; }
    clearDelete(); setDeleteArmed(id); deleteTimer.current = setTimeout(() => setDeleteArmed(null), 1500);
  }
  function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    if (target.kind === 'cell') void action(() => remove(target.id));
    else void action(async () => { await saveHomeRename(); await invoke('delete_notebook', { id: target.id }); await refresh(); });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active || !notebook || busy) return;
    const target = event.target as HTMLElement;
    if (target.id === 'notebook-title' && event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void action(saveNotebook); return; }
    const interactive = !!target.closest('button,input,select,textarea,summary,a,[contenteditable="true"]');
    const command = decideNotebookKey(event, target === editorRef.current, interactive);
    if (!command) return;
    event.preventDefault();
    if (command !== 'delete') clearDelete();
    const index = notebook.blocks.findIndex(block => block.id === selectedId);
    const selected = notebook.blocks[index];
    if (command === 'command') { commandMode(); return; }
    if (command === 'save-notebook') { void action(saveNotebook); return; }
    if (command === 'save') { if (selectedId) void action(() => saveCell(selectedId)); return; }
    if (command === 'save-next') {
      void action(async () => { if (editingId) cursor.current[editingId] = [editorRef.current?.selectionStart ?? 0, editorRef.current?.selectionEnd ?? 0]; if (selectedId) await saveCell(selectedId); setEditingId(null); const next = notebook.blocks[index + 1]?.id; if (next) { setSelectedId(next); focusCell(next); } else if (selectedId) focusCell(selectedId); }); return;
    }
    if (!selected) return;
    if (command === 'edit') { if (selected.kind !== 'result') setEditingId(selected.id); return; }
    if (command === 'markdown') return;
    if (command === 'prev' || command === 'next') { const next = notebook.blocks[index + (command === 'prev' ? -1 : 1)]; if (next) { select(next.id); focusCell(next.id); } return; }
    if (command === 'above' || command === 'below') { void action(() => insert('markdown', selected.id, command === 'above' ? 'before' : 'after')); return; }
    if (command === 'delete') armDelete(selected.id, event.repeat);
  }
  function onCellClick(event: MouseEvent<HTMLElement>, id: string) { select(id); if (!(event.target as HTMLElement).closest('button,input,select,textarea,summary,a')) { setEditingId(null); focusCell(id); } }
  const succeeded = executions.find(item => item.id === executionId);
  const visibleNotebooks = sortNotebooks(filterNotebooks(notebooks, search), sort);
  return <div className={`notebook-workspace ${notebook ? 'notebook-editor' : 'notebook-home'}`} onKeyDown={onKeyDown}>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {!notebook ? <>
      <div className="notebook-heading"><div><span className="notebook-heading-icon"><BookOpen size={20}/></span><span className="eyebrow">{projectName ?? 'Current project'}</span><h1>Notebooks</h1><p>Keep notes, code, and saved analytical results together.</p></div><Button variant="primary" disabled={busy} onClick={() => void action(async () => { await saveHomeRename(); const next = await invoke<Notebook>('create_notebook', { title: 'Untitled Notebook' }); setNotebook(next); setTitle(next.title); setSelectedId(null); setEditingId(null); await refresh(); })}><Plus size={16}/> New Notebook</Button></div>
      <div className="notebook-home-controls"><label className="notebook-search"><Search size={16}/><span className="sr-only">Search notebooks</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notebooks" /></label><label className="notebook-sort">Sort by <Select value={sort} onChange={event => setSort(event.target.value as 'modified' | 'name')}><option value="modified">Last modified</option><option value="name">Name</option></Select></label></div>
      <div className="notebook-home-list"><div className="notebook-home-columns"><span>Name</span><span>Modified</span><span>Cells</span><span className="sr-only">Actions</span></div>{visibleNotebooks.map(item => <div className="notebook-home-row" key={item.id}>
        {renamingId === item.id ? <form onSubmit={event => { event.preventDefault(); void action(saveHomeRename); }}><Input ref={renameInputRef} aria-label="Notebook title" maxLength={120} autoFocus value={renameTitle} onChange={event => setRenameTitle(event.target.value)}/><Button size="small" disabled={busy}>Save</Button><Button size="small" type="button" disabled={busy} onClick={() => setRenamingId(null)}>Cancel</Button></form>
          : <><button className="notebook-home-open" disabled={busy} onClick={() => void action(async () => { await saveHomeRename(); await load(item.id); })}><BookOpen size={16}/><strong>{item.title}</strong></button><span className="notebook-home-date">{new Date(item.updated_at).toLocaleString()}</span><span className="notebook-home-count">{item.block_count}</span></>}
        <DropdownMenu><DropdownMenuTrigger className="notebook-menu-trigger notebook-cell-menu" aria-label={`Actions for ${item.title}`}>⋯</DropdownMenuTrigger><DropdownMenuContent>
          <DropdownMenuItem disabled={busy || renamingId === item.id} onClick={() => void action(async () => { await saveHomeRename(); setRenamingId(item.id); setRenameTitle(item.title); })}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive disabled={busy} onClick={() => setPendingDelete({ kind: 'notebook', id: item.id, title: item.title })}>Delete</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>)}{!visibleNotebooks.length && <div className="notebook-home-empty"><BookOpen size={28}/><h2>{notebooks.length ? 'No matching notebooks' : 'Your notebooks start here'}</h2><p>{notebooks.length ? 'Try a different search.' : 'Write text and code, then add saved analytical results as your investigation grows.'}</p>{!notebooks.length && <Button variant="primary" disabled={busy} onClick={() => void action(async () => { const next = await invoke<Notebook>('create_notebook', { title: 'Untitled Notebook' }); setNotebook(next); setTitle(next.title); await refresh(); })}>Create Notebook</Button>}</div>}</div>
    </> : <>
      <div className="notebook-editor-toolbar"><button className="notebook-back" disabled={busy} onClick={() => void action(async () => { await saveNotebook(); setNotebook(null); setSelectedId(null); setEditingId(null); await refresh(); })}>← Notebooks</button><div className="notebook-title"><label htmlFor="notebook-title" className="sr-only">Notebook title</label><Input id="notebook-title" maxLength={120} disabled={busy} value={title} onChange={e => setTitle(e.target.value)}/><span className="notebook-save-status" role="status">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span></div><div className="notebook-toolbar-actions"><span className="notebook-runtime" title="Code execution is not available">No runtime</span><DropdownMenu><DropdownMenuTrigger className="notebook-menu-trigger notebook-new-menu">+ Cell</DropdownMenuTrigger><DropdownMenuContent className="min-w-[115px]"><DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code'))}>Code</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown'))}>Text</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button disabled={busy || !dirty} onClick={() => void action(saveNotebook)}>Save</Button><Popover><PopoverTrigger className="notebook-help-trigger">Shortcuts</PopoverTrigger><PopoverContent><PopoverTitle className="sr-only">Shortcuts</PopoverTitle><div>Esc command · Enter edit · ↑ ↓ select · A/B insert Text above/below · D D delete · Shift+Enter save and next · Ctrl+Enter save · M Markdown · Ctrl+S save notebook</div></PopoverContent></Popover></div></div>
      <div className="notebook-blocks">{notebook.blocks.map((block, index) => {
        const draft = drafts[block.id] ?? block.content; const language = languages[block.id] ?? block.language;
        const changed = draft !== block.content || language !== block.language; const selected = selectedId === block.id; const editing = editingId === block.id;
        const label = block.kind === 'markdown' ? 'Text' : block.kind === 'code' ? 'Code' : 'Result';
        return <Fragment key={block.id}><InsertionSlot disabled={busy} insert={kind => void action(() => insert(kind, block.id, 'before'))}/><section ref={element => { cellRefs.current[block.id] = element; }} tabIndex={selected ? 0 : -1} aria-label={`${label} cell ${index + 1}`} className={`notebook-block${selected ? ' selected' : ''}${editing ? ' editing' : ''}`} onClick={event => onCellClick(event, block.id)}>
          <div className="notebook-block-toolbar"><span>{label} <small>{index + 1}</small>{changed && <em>Unsaved</em>}{deleteArmed === block.id && <em>Press D again to delete</em>}</span>{block.kind === 'code' && <Select aria-label={`Language for code cell ${index + 1}`} value={language ?? 'python'} disabled={busy} onChange={event => { const value = event.target.value as 'python' | 'sql'; setLanguages(current => { const next = { ...current }; if (value === block.language) delete next[block.id]; else next[block.id] = value; return next; }); }}><option value="python">Python</option><option value="sql">SQL</option></Select>}
            <DropdownMenu><DropdownMenuTrigger className="notebook-menu-trigger notebook-cell-menu" aria-label={`Actions for cell ${index + 1}`} onClick={() => select(block.id)}>⋯</DropdownMenuTrigger><DropdownMenuContent>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code', block.id, 'before'))}>Insert Code above</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown', block.id, 'before'))}>Insert Text above</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code', block.id, 'after'))}>Insert Code below</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown', block.id, 'after'))}>Insert Text below</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy || index === 0} onClick={() => void action(() => move(block.id, 'up'))}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={busy || index === notebook.blocks.length - 1} onClick={() => void action(() => move(block.id, 'down'))}>Move down</DropdownMenuItem>
              {block.kind !== 'result' && <DropdownMenuItem onClick={() => { setSelectedId(block.id); editing ? commandMode() : setEditingId(block.id); }}>{editing ? 'Preview' : 'Edit'}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive disabled={busy} onClick={() => setPendingDelete({ kind: 'cell', id: block.id })}>Delete</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu></div>
          {block.kind === 'result' ? block.execution_id ? <ResultBlock executionId={block.execution_id} execution={executions.find(item => item.id === block.execution_id)}/> : <p>Execution reference unavailable.</p>
            : editing ? <div className={block.kind === 'code' ? 'notebook-code-frame' : 'notebook-text-frame'}>{block.kind === 'code' && <span className="notebook-code-prompt" aria-label="Code not run">[ ]</span>}<Textarea ref={editorRef} rows={Math.max(3, draft.split('\n').length + 1)} className={block.kind === 'code' ? 'notebook-code-editor' : ''} aria-label={`${label} cell ${index + 1} editor`} value={draft} readOnly={busy} spellCheck={block.kind === 'markdown'} onKeyDown={event => { if (block.kind !== 'code' || event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return; event.preventDefault(); const [value, start, end] = indentCode(draft, event.currentTarget.selectionStart, event.currentTarget.selectionEnd); setDrafts(current => ({ ...current, [block.id]: value })); cursor.current[block.id] = [start, end]; requestAnimationFrame(() => editorRef.current?.setSelectionRange(start, end)); }} onSelect={event => { cursor.current[block.id] = [event.currentTarget.selectionStart, event.currentTarget.selectionEnd]; }} onChange={event => { const value = event.target.value; setDrafts(current => { const next = { ...current }; if (value === block.content) delete next[block.id]; else next[block.id] = value; return next; }); }}/>{block.kind === 'code' && <div className="notebook-code-output">No output · execution unavailable</div>}</div>
              : block.kind === 'markdown' ? <div className="notebook-preview" onDoubleClick={() => setEditingId(block.id)}><Markdown text={draft}/></div>
                : <div className="notebook-code-preview" onDoubleClick={() => setEditingId(block.id)}><div className="notebook-code-source"><span className="notebook-code-prompt" aria-label="Code not run">[ ]</span><pre>{draft || 'Press Enter to write code.'}</pre></div><div className="notebook-code-output">No output · execution unavailable</div></div>}
        </section></Fragment>;
      })}<InsertionSlot disabled={busy} insert={kind => void action(() => insert(kind, notebook.blocks.at(-1)?.id, notebook.blocks.length ? 'after' : undefined))}/>{!notebook.blocks.length && <div className="notebook-empty-hint"><p>Add a cell to begin this notebook.</p><div><Button disabled={busy} onClick={() => void action(() => insert('code'))}>+ Code</Button><Button disabled={busy} onClick={() => void action(() => insert('markdown'))}>+ Text</Button></div></div>}</div>
      {!!executions.length && <div className="notebook-add"><label htmlFor="execution-select">Saved execution</label><Select id="execution-select" value={executionId} onChange={e => setExecutionId(e.target.value)}><option value="">Choose an execution</option>{executions.map(item => <option key={item.id} value={item.id}>{new Date(item.started_at).toLocaleString()} · {item.operation_type} · {item.id.slice(0, 8)}</option>)}</Select><Button disabled={busy || !succeeded} onClick={() => void action(async () => { const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind: 'result', content: '', executionId }); await reload(); setSelectedId(block.id); focusCell(block.id); })}>Add result</Button></div>}
    </>}
    <ConfirmationDialog open={pendingDelete !== null} title={pendingDelete?.kind === 'notebook' ? 'Delete notebook?' : 'Delete cell?'} description={pendingDelete?.kind === 'notebook' ? `Delete “${pendingDelete.title}” and all its cells? This cannot be undone.` : 'Delete this cell? This cannot be undone.'} confirmLabel="Delete" destructive onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete}/>
  </div>;
}
