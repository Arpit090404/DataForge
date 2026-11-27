import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronUp, Table2 } from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { ConfirmationDialog } from './components/ui/dialog';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './components/ui/popover';
import { pythonReference, resultAccessName, sqlReference } from './notebookDataRefs';

type Column = { name: string; data_type: string };
type Dataset = { id: string; name: string };
export type SessionResult = { id: string; name: string | null; execution_id: string; created_at: string;
  available: boolean; stale: boolean; columns: Column[]; row_count: number | null; operation_type: string;
  provenance: { inputs?: unknown[]; result_inputs?: unknown[] } | null };

export function matchesResult(term: string, result: SessionResult): boolean {
  return !term || `${result.name ?? ''} ${result.id} ${result.columns.map(column => `${column.name} ${column.data_type}`).join(' ')}`.toLowerCase().includes(term.toLowerCase());
}

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') {
    try { const parsed: unknown = JSON.parse(error); if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') return parsed.message; } catch { /* Plain message. */ }
    return error;
  }
  return 'Session results could not be loaded.';
}

export function SessionResultItem({ item, selected, onSelect, onCopy, onRelease }: {
  item: SessionResult; selected: boolean; onSelect: () => void;
  onCopy: (language: 'SQL' | 'Python') => void; onRelease: () => void;
}) {
  return <div className="session-result-item">
    <button className="session-result-select" aria-pressed={selected} onClick={onSelect}>
      <span className="session-result-name">{item.name ?? `result_${item.id.replaceAll('-', '')}`}</span>
      <span className="session-result-meta">{item.row_count === null ? 'Rows unavailable' : `${item.row_count.toLocaleString()} complete rows`} · {item.columns.length ? `${item.columns.length} columns` : 'Schema unavailable'}</span>
    </button>
    <Badge status={!item.available ? 'missing' : item.stale ? 'changed' : 'ready'}>{!item.available ? 'Unavailable' : item.stale ? 'Stale' : 'Complete'}</Badge>
    {!!item.columns.length && <div className="session-result-types">{item.columns.map(column => `${column.name}: ${column.data_type}`).join(' · ')}</div>}
    {selected && <div className="session-result-details">
      <p>{item.available ? 'Complete saved table, available after reopening the project.' : 'Released or damaged result; unavailable as an analytical input.'}</p>
      {!!item.columns.length && <div className="session-result-schema">{item.columns.map(column => <div key={column.name}><span>{column.name}</span><small>{column.data_type}</small></div>)}</div>}
      <div className="session-result-actions"><Button variant="ghost" size="small" disabled={!item.available} onClick={() => onCopy('SQL')}>Copy SQL</Button><Button variant="ghost" size="small" disabled={!item.available} onClick={() => onCopy('Python')}>Copy Python</Button>{item.available && <Button variant="ghost" size="small" onClick={onRelease}>Release</Button>}</div>
      <details><summary>Provenance</summary><dl><div><dt>Result ID</dt><dd>{item.id}</dd></div><div><dt>Execution ID</dt><dd>{item.execution_id}</dd></div><div><dt>Produced by</dt><dd>{item.operation_type.toUpperCase()}</dd></div><div><dt>Created</dt><dd>{item.created_at}</dd></div></dl><pre>{JSON.stringify({ inputs: item.provenance?.inputs ?? [], result_inputs: item.provenance?.result_inputs ?? [] }, null, 2)}</pre></details>
    </div>}
  </div>;
}

export default function NotebookSessionResults({ projectId, datasets, revision, search, onReleased }: {
  projectId: string; datasets: Dataset[]; revision: number; search: string; onReleased: () => void;
}) {
  const [results, setResults] = useState<SessionResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    invoke<SessionResult[]>('explore_named_results').then(items => { if (current) { setResults(items); setError(''); } })
      .catch(failure => { if (current) setError(message(failure)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectId, revision, datasets]);

  async function copy(item: SessionResult, language: 'SQL' | 'Python') {
    const name = resultAccessName(item, datasets);
    const reference = language === 'SQL' ? sqlReference(name) : pythonReference('result', name);
    try { await navigator.clipboard.writeText(reference); setNotice(`Copied ${language}: ${reference}`); setError(''); }
    catch { setError('Could not copy the result reference.'); }
  }

  async function release() {
    const target = releaseTarget;
    setReleaseTarget(null);
    if (!target) return;
    try { await invoke('release_named_result', { id: target.id }); setNotice('Result released. Its name and stable handle are unavailable.'); setError(''); onReleased(); }
    catch (failure) { setError(message(failure)); }
  }

  const visible = results.filter(item => matchesResult(search.trim(), item));
  return <div className="session-results-rail">
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="small" className="session-results-trigger" aria-label={`Session Results, ${visible.length}`} />}>
        <Table2 aria-hidden="true"/><span>Session Results</span><span className="session-results-count">{visible.length}</span><ChevronUp aria-hidden="true"/>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="session-results-popup">
        <PopoverTitle className="session-results-title">Session Results</PopoverTitle>
        {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="session-results-notice" role="status">{notice}</p>}
        {loading ? <p className="session-results-empty" role="status">Loading results…</p> : visible.length ? visible.map(item =>
          <SessionResultItem key={item.id} item={item} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} onCopy={language => void copy(item, language)} onRelease={() => setReleaseTarget(item)}/>)
          : <p className="session-results-empty">{search ? 'No matching results.' : 'No named results yet.'}</p>}
      </PopoverContent>
    </Popover>
    <ConfirmationDialog open={releaseTarget !== null} title="Release named result?" description={`Release ${releaseTarget?.name ?? releaseTarget?.id ?? ''}? Its name and stable handle will stop resolving. Saved execution output remains until cleared; unused storage can then be cleaned up.`} confirmLabel="Release" destructive onCancel={() => setReleaseTarget(null)} onConfirm={() => void release()}/>
  </div>;
}
