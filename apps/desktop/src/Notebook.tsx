import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Markdown } from './Markdown';

type Execution = { id: string; dataset_id: string; operation_type: string; parameters: string; started_at: string; completed_at: string | null; status: string; result_row_count: number | null; error_summary: string | null; duckdb_version: string | null; source_fingerprint: string };
type Result = { execution: Execution; columns: { name: string; data_type: string }[]; rows: (string | null)[][]; total_rows: number | null; has_more: boolean };
type Block = { id: string; notebook_id: string; position: number; kind: 'markdown' | 'result'; content: string; execution_id: string | null; created_at: string; updated_at: string };
type Notebook = { id: string; title: string; created_at: string; updated_at: string; blocks: Block[] };
type Summary = { id: string; title: string; block_count: number };

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
  if (!attempt || error) return <div className="notebook-unavailable"><strong>{error ? 'Result unavailable' : 'Saved execution'}</strong>{historyExecution && <p>{historyExecution.operation_type} · {new Date(historyExecution.started_at).toLocaleString()} · {historyExecution.status} · {historyExecution.result_row_count ?? '—'} rows</p>}{error && <p role="status">{error}</p>}<small>Execution ID: {executionId}</small> <Button size="small" onClick={() => setAttempt(value => value + 1)}>{error ? 'Retry' : 'Load saved result'}</Button></div>;
  if (!result) return <p className="notebook-muted">Loading saved execution…</p>;
  const execution = result.execution;
  return <div><div className="notebook-result-meta"><strong>{execution.operation_type === 'group' ? 'Group and summarize' : 'Filter and view rows'}</strong><span>{new Date(execution.started_at).toLocaleString()} · {execution.status} · {execution.result_row_count ?? '—'} rows · {execution.duckdb_version ? `DuckDB ${execution.duckdb_version}` : 'Engine unavailable'}</span><span>Source: {execution.dataset_id} · Fingerprint: {execution.source_fingerprint}</span><details><summary>Execution parameters</summary><pre>{execution.parameters}</pre></details></div><div className="table-scroll"><table className="data-table"><thead><tr>{result.columns.map((column, i) => <th key={i}><span>{column.name}</span><small>{column.data_type}</small></th>)}</tr></thead><tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value ?? <span className="null-value">null</span>}</td>)}</tr>)}</tbody></table>{!result.rows.length && <div className="table-empty">No rows matched this operation.</div>}</div><p className="notebook-muted">Showing {result.rows.length} rows{result.has_more ? ' · more rows available in the original operation' : ''}.</p></div>;
}

export default function NotebookWorkspace({ active, onDirtyChange }: { active: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const [notebooks, setNotebooks] = useState<Summary[]>([]);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [executionId, setExecutionId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty = Object.keys(drafts).length > 0 || (!!notebook && title !== notebook.title);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function refresh() { setNotebooks(await invoke<Summary[]>('list_notebooks')); }
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
  async function load(id: string) { const next = await invoke<Notebook>('get_notebook', { id }); setNotebook(next); setTitle(next.title); }
  async function reload() { if (notebook) { setNotebook(await invoke<Notebook>('get_notebook', { id: notebook.id })); await refresh(); } }
  const succeeded = executions.find(item => item.id === executionId);
  return <div className="notebook-workspace">
    <div className="notebook-heading"><div><span className="eyebrow">INVESTIGATION</span><h1>Notebooks</h1><p>Keep notes and link results from this project.</p></div><Button variant="primary" disabled={busy} onClick={() => { if (notebook && title !== notebook.title && !window.confirm('Discard the unsaved notebook title?')) return; void action(async () => { const next = await invoke<Notebook>('create_notebook', { title: 'Untitled notebook' }); setNotebook(next); setTitle(next.title); await refresh(); }); }}>New notebook</Button></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="notebook-picker"><label htmlFor="notebook-select">Notebook</label><select id="notebook-select" value={notebook?.id ?? ''} disabled={busy} onChange={e => { if (notebook && title !== notebook.title && !window.confirm('Discard the unsaved notebook title?')) return; if (e.target.value) void action(() => load(e.target.value)); else setNotebook(null); }}><option value="">Choose a notebook</option>{notebooks.map(item => <option key={item.id} value={item.id}>{item.title} ({item.block_count})</option>)}</select></div>
    {!notebook ? <div className="table-empty">Create or choose a notebook to get started.</div> : <>
      <div className="notebook-title"><label htmlFor="notebook-title">Title</label><Input id="notebook-title" maxLength={120} disabled={busy} value={title} onChange={e => setTitle(e.target.value)}/><Button disabled={busy || title.trim() === notebook.title} onClick={() => void action(async () => { const next = await invoke<Notebook>('rename_notebook', { id: notebook.id, title }); setNotebook(next); setTitle(next.title); await refresh(); })}>Rename</Button><Button disabled={busy} onClick={() => { if (window.confirm(`Delete “${notebook.title}” and all its blocks?`)) void action(async () => { await invoke('delete_notebook', { id: notebook.id }); setDrafts(current => { const next = { ...current }; notebook.blocks.forEach(block => delete next[block.id]); return next; }); setNotebook(null); await refresh(); }); }}>Delete notebook</Button></div>
      <div className="notebook-blocks">{notebook.blocks.map((block, index) => {
        const draft = drafts[block.id] ?? block.content; const changed = draft !== block.content;
        return <section className="notebook-block" key={block.id}><div className="notebook-block-toolbar"><strong>{block.kind === 'markdown' ? 'Markdown' : 'Saved result'}</strong><div><Button size="small" disabled={busy || index === 0} onClick={() => void action(async () => { await invoke('move_block', { id: block.id, direction: 'up' }); await reload(); })}>Move up</Button><Button size="small" disabled={busy || index === notebook.blocks.length - 1} onClick={() => void action(async () => { await invoke('move_block', { id: block.id, direction: 'down' }); await reload(); })}>Move down</Button><Button size="small" disabled={busy} onClick={() => { if (window.confirm('Delete this block?')) void action(async () => { await invoke('delete_block', { id: block.id }); setDrafts(current => { const next = { ...current }; delete next[block.id]; return next; }); await reload(); }); }}>Delete</Button></div></div>
          {block.kind === 'markdown' ? <><div className="notebook-block-actions"><Button size="small" aria-pressed={!!editing[block.id]} onClick={() => setEditing(current => ({ ...current, [block.id]: !current[block.id] }))}>{editing[block.id] ? 'Preview' : 'Edit'}</Button><Button size="small" disabled={busy || !changed} onClick={() => void action(async () => { await invoke('update_block', { id: block.id, content: draft }); await reload(); setDrafts(current => { const next = { ...current }; delete next[block.id]; return next; }); setEditing(current => ({ ...current, [block.id]: false })); })}>Save{changed ? ' changes' : 'd'}</Button>{changed && <span>Unsaved changes</span>}</div>{editing[block.id] ? <textarea aria-label={`Markdown block ${index + 1}`} value={draft} disabled={busy} onChange={e => setDrafts(current => { const next = { ...current }; if (e.target.value === block.content) delete next[block.id]; else next[block.id] = e.target.value; return next; })}/> : <Markdown text={draft}/>}</> : block.execution_id ? <ResultBlock executionId={block.execution_id} execution={executions.find(item => item.id === block.execution_id)}/> : <p>Execution reference unavailable.</p>}
        </section>;
      })}</div>
      <div className="notebook-add"><Button disabled={busy} onClick={() => void action(async () => { const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind: 'markdown', content: '', executionId: null }); await reload(); setEditing(current => ({ ...current, [block.id]: true })); })}>Add Markdown</Button><label htmlFor="execution-select">Saved execution</label><select id="execution-select" value={executionId} onChange={e => setExecutionId(e.target.value)}><option value="">Choose an execution</option>{executions.map(item => <option key={item.id} value={item.id}>{new Date(item.started_at).toLocaleString()} · {item.operation_type} · {item.id.slice(0, 8)}</option>)}</select><Button disabled={busy || !succeeded} onClick={() => void action(async () => { await invoke('add_block', { notebookId: notebook.id, kind: 'result', content: '', executionId }); await reload(); })}>Add result</Button></div>
    </>}
  </div>;
}


