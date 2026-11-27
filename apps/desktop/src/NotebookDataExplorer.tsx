import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { ConfirmationDialog } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { datasetAccessName, pythonReference, resultAccessName, sqlReference } from './notebookDataRefs';

type Column = { name: string; data_type: string };
type Dataset = { id: string; name: string; status: 'ready' | 'changed' | 'missing'; fingerprint: string; registered_at: string };
type Inspection = { columns: Column[]; row_count: number | null; row_count_exact: boolean; scanned_rows: number };
export type ExplorerResult = { id: string; name: string | null; execution_id: string; created_at: string;
  available: boolean; stale: boolean; columns: Column[]; row_count: number | null; operation_type: string; notebook_id: string | null;
  provenance: { inputs?: unknown[]; result_inputs?: unknown[] } | null };
type Selection = { kind: 'dataset' | 'result'; id: string } | null;

export function matchesExplorer(term: string, name: string, id: string, columns: Column[]): boolean {
  return !term || `${name} ${id} ${columns.map(column => `${column.name} ${column.data_type}`).join(' ')}`.toLowerCase().includes(term.toLowerCase());
}

export function partitionResults(results: ExplorerResult[], notebookId: string | null, term: string) {
  const visible=results.filter(item => matchesExplorer(term,item.name ?? resultAccessName(item),item.id,item.columns));
  const session=visible.filter(item => !!(item.available && item.name && notebookId && item.notebook_id === notebookId));
  return { visible, session, persisted: visible.filter(item => !session.includes(item)) };
}

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') {
    try { const parsed: unknown = JSON.parse(error); if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') return parsed.message; } catch { /* Plain message. */ }
    return error;
  }
  return 'The Data Explorer could not complete this action.';
}

export function ExplorerResultItem({ item, selected, onSelect, onCopy, onRelease }: {
  item: ExplorerResult; selected: boolean; onSelect: () => void;
  onCopy: (language: 'SQL' | 'Python') => void; onRelease: () => void;
}) {
  return <div className="explorer-item">
    <button className="explorer-item-select" aria-pressed={selected} onClick={onSelect}>
      <span className="explorer-item-title">{item.name ?? `result_${item.id.replaceAll('-', '')}`}</span>
      <span className="explorer-item-meta">{item.row_count === null ? 'Rows unavailable' : `${item.row_count.toLocaleString()} complete rows`} · {item.columns.length ? `${item.columns.length} columns` : 'Schema unavailable'}</span>
    </button>
    <Badge status={!item.available ? 'missing' : item.stale ? 'changed' : 'ready'}>{!item.available ? 'Unavailable' : item.stale ? 'Stale' : 'Complete'}</Badge>
    {!!item.columns.length && <div className="explorer-item-types">{item.columns.map(column => `${column.name}: ${column.data_type}`).join(' · ')}</div>}
    {selected && <div className="explorer-item-details">
      <p>{item.available ? 'Complete saved table. Available after reopening the project.' : 'Released or damaged result. It cannot be used as an analytical input.'}</p>
      {!!item.columns.length && <div className="explorer-schema">{item.columns.map(column => <div key={column.name}><span>{column.name}</span><small>{column.data_type}</small></div>)}</div>}
      <div className="explorer-references"><Button variant="ghost" size="small" disabled={!item.available} onClick={() => onCopy('SQL')}>Copy SQL</Button><Button variant="ghost" size="small" disabled={!item.available} onClick={() => onCopy('Python')}>Copy Python</Button>{item.available && <Button variant="ghost" size="small" onClick={onRelease}>Release</Button>}</div>
      <details><summary>Provenance</summary><dl><div><dt>Result ID</dt><dd>{item.id}</dd></div><div><dt>Execution ID</dt><dd>{item.execution_id}</dd></div><div><dt>Produced by</dt><dd>{item.operation_type.toUpperCase()}</dd></div><div><dt>Created</dt><dd>{item.created_at}</dd></div></dl><pre>{JSON.stringify({ inputs:item.provenance?.inputs ?? [], result_inputs:item.provenance?.result_inputs ?? [] },null,2)}</pre></details>
    </div>}
  </div>;
}

export default function NotebookDataExplorer({ projectId, notebookId, datasets, revision, onRefreshSources, onReleased }: {
  projectId: string; notebookId: string | null; datasets: Dataset[]; revision: number; onRefreshSources: () => Promise<void>; onReleased: () => void;
}) {
  const [results, setResults] = useState<ExplorerResult[]>([]);
  const [inspections, setInspections] = useState<Record<string, Inspection>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<ExplorerResult | null>(null);
  const [expanded, setExpanded] = useState({ datasets: true, session: true, persisted: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    invoke<ExplorerResult[]>('explore_named_results').then(items => { if (current) { setResults(items); setError(''); } })
      .catch(failure => { if (current) setError(message(failure)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectId, revision, datasets]);

  async function refresh() {
    setRefreshing(true); setError('');
    try {
      await onRefreshSources();
      setInspections({});
      setResults(await invoke<ExplorerResult[]>('explore_named_results'));
    } catch (failure) { setError(message(failure)); }
    finally { setRefreshing(false); }
  }

  async function chooseDataset(id: string) {
    setSelection({ kind: 'dataset', id }); setNotice(''); setError('');
    const dataset=datasets.find(item => item.id === id);
    if (dataset?.status !== 'ready' || inspections[id]) return;
    setInspecting(id);
    try { const inspected=await invoke<Inspection>('inspect_csv', { datasetId: id, limit: 1 }); setInspections(current => ({ ...current, [id]: inspected })); }
    catch (failure) { setError(message(failure)); }
    finally { setInspecting(null); }
  }

  async function copy(kind: 'dataset' | 'result', name: string, language: 'SQL' | 'Python') {
    const reference=language === 'SQL' ? sqlReference(name) : pythonReference(kind,name);
    try { await navigator.clipboard.writeText(reference); setNotice(`Copied ${language} reference: ${reference}`); setError(''); }
    catch { setError('Could not copy the reference. Select the visible name instead.'); }
  }

  async function release() {
    const target=releaseTarget; setReleaseTarget(null);
    if (!target) return;
    try {
      await invoke('release_named_result',{ id: target.id });
      setNotice('Result released. Its stable handle is now unavailable.'); setError(''); onReleased();
    } catch (failure) { setError(message(failure)); }
  }

  const term=search.trim().toLowerCase();
  const visibleDatasets=datasets.filter(item => matchesExplorer(term,item.name,item.id,inspections[item.id]?.columns ?? []));
  const { visible:visibleResults, session, persisted }=partitionResults(results,notebookId,term);
  const selectedDataset=selection?.kind === 'dataset' ? datasets.find(item => item.id === selection.id) : undefined;
  const selectedResult=selection?.kind === 'result' ? results.find(item => item.id === selection.id) : undefined;

  function datasetRow(item: Dataset) {
    const inspection=item.status === 'ready' ? inspections[item.id] : undefined;
    const name=datasetAccessName(item,datasets,results);
    return <div className="explorer-item" key={item.id}>
      <button className="explorer-item-select" aria-pressed={selection?.kind === 'dataset' && selection.id === item.id} onClick={() => void chooseDataset(item.id)}>
        <span className="explorer-item-title">{item.name}</span>
        <span className="explorer-item-meta">{inspection ? `${inspection.row_count_exact && inspection.row_count !== null ? inspection.row_count.toLocaleString() + ' rows' : `At least ${inspection.scanned_rows.toLocaleString()} scanned`}` : 'Rows unknown'} · {inspection ? `${inspection.columns.length} columns` : 'Inspect for schema'}</span>
      </button>
      <Badge status={item.status}>{item.status}</Badge>
      {inspection && <div className="explorer-item-types">{inspection.columns.map(column => `${column.name}: ${column.data_type}`).join(' · ')}</div>}
      {selection?.kind === 'dataset' && selection.id === item.id && <div className="explorer-item-details">
        {item.status !== 'ready' ? <p>Source {item.status}. Its schema cannot be refreshed until the source is ready.</p>
          : inspecting === item.id ? <p role="status">Inspecting schema…</p>
            : inspection ? <><div className="explorer-schema">{inspection.columns.map(column => <div key={column.name}><span>{column.name}</span><small>{column.data_type}</small></div>)}</div><p>{inspection.row_count_exact && inspection.row_count !== null ? `${inspection.row_count.toLocaleString()} rows` : `Row count unknown; ${inspection.scanned_rows.toLocaleString()} rows scanned`}</p></> : <p>Schema unavailable.</p>}
        <div className="explorer-references"><Button variant="ghost" size="small" disabled={item.status !== 'ready'} onClick={() => void copy('dataset',name,'SQL')}>Copy SQL</Button><Button variant="ghost" size="small" disabled={item.status !== 'ready'} onClick={() => void copy('dataset',name,'Python')}>Copy Python</Button></div>
        <details><summary>Provenance</summary><dl><div><dt>Dataset ID</dt><dd>{item.id}</dd></div><div><dt>Registered</dt><dd>{item.registered_at}</dd></div><div><dt>Source fingerprint</dt><dd>{item.fingerprint}</dd></div></dl></details>
      </div>}
    </div>;
  }

  return <div className="explorer-body">
    <div className="explorer-controls"><Input aria-label="Search Data Explorer" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search data and results"/><Button variant="ghost" size="small" disabled={refreshing} loading={refreshing} onClick={() => void refresh()}>Refresh</Button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="explorer-notice" role="status">{notice}</p>}
    {loading && <p className="explorer-muted" role="status">Loading results…</p>}
    <details className="explorer-section" open={expanded.datasets} onToggle={event => setExpanded(current => ({ ...current, datasets: event.currentTarget.open }))}><summary>Registered Datasets <span>{visibleDatasets.length}</span></summary>{visibleDatasets.length ? visibleDatasets.map(datasetRow) : <p className="explorer-muted">{term ? 'No matching datasets.' : 'No datasets registered.'}</p>}</details>
    <details className="explorer-section" open={expanded.session} onToggle={event => setExpanded(current => ({ ...current, session: event.currentTarget.open }))}><summary>Session Results <span>{session.length}</span></summary>{session.length ? session.map(item => <ExplorerResultItem key={item.id} item={item} selected={selection?.kind === 'result' && selection.id === item.id} onSelect={() => { setSelection({ kind: 'result', id: item.id }); setNotice(''); }} onCopy={language => void copy('result',resultAccessName(item,datasets),language)} onRelease={() => setReleaseTarget(item)}/>) : <p className="explorer-muted">{term ? 'No matching session results.' : 'No named results from this notebook.'}</p>}</details>
    <details className="explorer-section" open={expanded.persisted} onToggle={event => setExpanded(current => ({ ...current, persisted: event.currentTarget.open }))}><summary>Persisted Named Results <span>{persisted.length}</span></summary>{persisted.length ? persisted.map(item => <ExplorerResultItem key={item.id} item={item} selected={selection?.kind === 'result' && selection.id === item.id} onSelect={() => { setSelection({ kind: 'result', id: item.id }); setNotice(''); }} onCopy={language => void copy('result',resultAccessName(item,datasets),language)} onRelease={() => setReleaseTarget(item)}/>) : <p className="explorer-muted">{term ? 'No matching historical results.' : 'No historical results.'}</p>}</details>
    {selectedDataset && !visibleDatasets.some(item => item.id === selectedDataset.id) && <span className="sr-only">Selected dataset is filtered from view.</span>}
    {selectedResult && !visibleResults.some(item => item.id === selectedResult.id) && <span className="sr-only">Selected result is filtered from view.</span>}
    <ConfirmationDialog open={releaseTarget !== null} title="Release named result?" description={`Release ${releaseTarget?.name ?? releaseTarget?.id ?? ''}? Its name and stable handle will stop resolving. Saved execution output remains until cleared; unused storage can then be cleaned up.`} confirmLabel="Release" destructive onCancel={() => setReleaseTarget(null)} onConfirm={() => void release()}/>
  </div>;
}
