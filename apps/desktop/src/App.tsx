import { Badge } from './components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from './components/ui/table';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Button, IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { ConfirmationDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Select } from './components/ui/select';
import NotebookWorkspace from './Notebook';
import {
  Activity, Archive, ArrowRight, Download,
  CircleAlert, Database, FilePlus2, FileSpreadsheet, FolderOpen,
  LayoutDashboard, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Plus, RefreshCw, Search, Table2, X,
} from 'lucide-react';

type Mode = 'Chat' | 'Notebook' | 'Dashboard';
type Status = 'ready' | 'missing' | 'changed';
type Project = { id: string; name: string; path: string; created_at: string };
type Dataset = { id: string; name: string; path: string; size_bytes: number; registered_at: string; fingerprint: string; status: Status };
type ColumnProfile = { name: string; data_type: 'text' | 'integer' | 'decimal' | 'boolean'; null_count: number; distinct_count: number; distinct_exact: boolean; min: number | null; max: number | null; mean: number | null; median: number | null };
type Inspection = { dataset: Dataset; columns: ColumnProfile[]; rows: (string | null)[][]; row_count: number | null; row_count_exact: boolean; preview_truncated: boolean; scanned_rows: number };
type ProjectState = { project: Project; datasets: Dataset[] };
type Comparison = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'contains' | 'is_null' | 'is_not_null';
type FilterExpr = { op: 'and' | 'or'; conditions: FilterExpr[] } | { column: string; op: Comparison; value?: string };
type SortSpec = { column: string; direction: 'asc' | 'desc'; nulls: 'first' | 'last' };
type Aggregation = { op: 'count' | 'sum' | 'average' | 'min' | 'max' | 'distinct_count'; column?: string; alias: string };
type AnalyticsRequest = { kind: 'rows' | 'group'; filters?: FilterExpr; sort?: SortSpec[]; group_by?: string[]; aggregations?: Aggregation[]; limit?: number; offset?: number };
type Execution = { id: string; dataset_id: string; operation_type: string; parameters: string; started_at: string; completed_at: string | null; status: string; result_row_count: number | null; error_summary: string | null; duckdb_version: string | null; source_fingerprint: string };
type AnalyticsResult = { execution: Execution; columns: { name: string; data_type: string }[]; rows: (string | null)[][]; total_rows: number | null; has_more: boolean };
type AnalysisSettings = { kind: AnalyticsRequest['kind']; filters: FilterGroup; sort: SortSpec[]; groupBy: string[]; aggregations: Aggregation[]; limit: number };
type DisplayedResult = { data: AnalyticsResult; request: AnalyticsRequest; settings: string; invalidated: boolean };

const SIDEBAR_WIDTH_DEFAULT = 248;
const SIDEBAR_WIDTH_MIN = 210;
const SIDEBAR_WIDTH_MAX = 340;
const SIDEBAR_WIDTH_KEY = 'dataforge:left-sidebar-width';
const INSPECTOR_MEDIA = '(min-width: 1101px)';

function subscribeInspectorWidth(onChange: () => void): () => void {
  const media = window.matchMedia(INSPECTOR_MEDIA);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function inspectorFits(): boolean { return window.matchMedia(INSPECTOR_MEDIA).matches; }

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value));
}

function storedSidebarWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? clampSidebarWidth(value) : SIDEBAR_WIDTH_DEFAULT;
  } catch { return SIDEBAR_WIDTH_DEFAULT; }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') {
    try { const parsed: unknown = JSON.parse(error); if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') return parsed.message; } catch { /* Tauri may return a plain string. */ }
    return error;
  }
  return 'The operation could not be completed. Please try again.';
}

function byteSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortNumber(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(5)).toString();
}

function ProjectDialog({ onClose, onCreate, busy }: { onClose: () => void; onCreate: (name: string, location: string) => Promise<void>; busy: boolean }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  async function pickFolder() {
    try {
      const result = await open({ directory: true, multiple: false, title: 'Choose parent folder for new project' });
      if (typeof result === 'string') setLocation(result);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !location) { setError('Enter a project name and choose a parent folder.'); return; }
    setError('');
    try { await onCreate(name.trim(), location); } catch (e) { setError(errorMessage(e)); }
  }
  return <Dialog open onOpenChange={next => { if (!next && !busy) onClose(); }} disablePointerDismissal>
    <DialogContent className="project-dialog" initialFocus={nameRef}>
    <DialogHeader><div><span className="eyebrow">NEW WORKSPACE</span><DialogTitle>Create project</DialogTitle></div><IconButton label="Close" onClick={onClose} disabled={busy}><X size={16} /></IconButton></DialogHeader>
    <DialogBody><DialogDescription>Choose where DataForge will keep this project's metadata. Your source files stay in their original locations.</DialogDescription></DialogBody>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="project-name">Project name</label>
      <Input ref={nameRef} id="project-name" maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Quarterly research" disabled={busy} />
      <label className="field-label" htmlFor="project-location">Parent folder</label>
      <div className="folder-field"><Input id="project-location" value={location} readOnly placeholder="Choose a folder" /><Button type="button" variant="secondary" onClick={pickFolder} disabled={busy}>Browse</Button></div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}
      <DialogFooter><Button type="button" variant="text" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{busy ? 'Creating…' : 'Create project'}<ArrowRight size={16}/></Button></DialogFooter>
    </form>
    </DialogContent>
  </Dialog>;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectedExecution, setInspectedExecution] = useState<Execution | null>(null);
  const [mode, setMode] = useState<Mode>('Chat');
  const [notebookDirty, setNotebookDirty] = useState(false);
  const [projectSession, setProjectSession] = useState(0);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (notebookDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [notebookDirty]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorCanShow = useSyncExternalStore(subscribeInspectorWidth, inspectorFits);
  const [notebookSidebarOpen, setNotebookSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarDrag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* Layout remains usable when storage is unavailable. */ }
  }, [sidebarWidth]);

  function onSidebarPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    sidebarDrag.current = { pointerId: event.pointerId, x: event.clientX, width: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSidebar(true);
  }

  function onSidebarPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = sidebarDrag.current;
    if (drag?.pointerId === event.pointerId) setSidebarWidth(clampSidebarWidth(drag.width + event.clientX - drag.x));
  }

  function onSidebarPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (sidebarDrag.current?.pointerId !== event.pointerId) return;
    sidebarDrag.current = null;
    setResizingSidebar(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onSidebarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 20 : 10;
    let width: number;
    if (event.key === 'ArrowLeft') width = sidebarWidth - step;
    else if (event.key === 'ArrowRight') width = sidebarWidth + step;
    else if (event.key === 'Home') width = SIDEBAR_WIDTH_MIN;
    else if (event.key === 'End') width = SIDEBAR_WIDTH_MAX;
    else return;
    event.preventDefault();
    setSidebarWidth(clampSidebarWidth(width));
  }
  const [showCreate, setShowCreate] = useState(false);
  const [pendingProject, setPendingProject] = useState<'new' | 'open' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSerial = useRef(0);
  const selected = datasets.find(item => item.id === selectedId) ?? null;

  function activate(state: ProjectState) {
    requestSerial.current += 1;
    setNotebookDirty(false);
    setProjectSession(value => value + 1);
    setProject(state.project);
    setDatasets(state.datasets);
    setSelectedId(null);
    setInspection(null);
    setInspectedExecution(null);
    setError(null);
    setMode('Chat');
  }

  async function createProject(name: string, location: string) {
    setBusy('Creating project'); setError(null);
    try { activate(await invoke<ProjectState>('create_project', { name, location })); setShowCreate(false); }
    finally { setBusy(null); }
  }

  async function openProject() {
    setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: 'Open a DataForge project folder' });
      if (typeof path !== 'string') return;
      setBusy('Opening project');
      activate(await invoke<ProjectState>('open_project', { path }));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  function requestProject(next: 'new' | 'open') {
    if (notebookDirty) setPendingProject(next);
    else if (next === 'new') setShowCreate(true);
    else void openProject();
  }

  function confirmProject() {
    const next = pendingProject;
    setPendingProject(null);
    if (next === 'new') setShowCreate(true);
    else if (next === 'open') void openProject();
  }

  async function refreshDatasets() {
    if (!project) return;
    setBusy('Checking sources'); setError(null);
    try {
      const next = await invoke<Dataset[]>('list_datasets');
      setDatasets(next);
      if (selectedId) {
        const item = next.find(dataset => dataset.id === selectedId);
        if (item?.status !== 'ready') { requestSerial.current += 1; setInspection(null); }
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function registerCsv() {
    if (!project) return;
    setError(null);
    try {
      const path = await open({ multiple: false, filters: [{ name: 'CSV files', extensions: ['csv'] }], title: 'Choose a CSV file' });
      if (typeof path !== 'string') return;
      setBusy('Registering source');
      const dataset = await invoke<Dataset>('register_csv', { path });
      const next = await invoke<Dataset[]>('list_datasets');
      setDatasets(next);
      await selectDataset(dataset.id);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function selectDataset(id: string) {
    const serial = ++requestSerial.current;
    if (mode === 'Notebook') setMode('Chat');
    setSelectedId(id); setInspection(null); setInspectedExecution(null); setError(null);
    setBusy('Reading CSV');
    try {
      const result = await invoke<Inspection>('inspect_csv', { datasetId: id, limit: 100 });
      if (serial === requestSerial.current) {
        setInspection(result);
        setDatasets(previous => previous.map(item => item.id === id ? result.dataset : item));
      }
    } catch (e) {
      if (serial === requestSerial.current) {
        setError(errorMessage(e));
        try { setDatasets(await invoke<Dataset[]>('list_datasets')); } catch { /* The first error is more useful. */ }
      }
    } finally { if (serial === requestSerial.current) setBusy(null); }
  }

  function selectMode(next: Mode) {
    requestSerial.current += 1;
    setSelectedId(null); setInspection(null); setMode(next); setError(null); setBusy(null);
  }

  const notebookMode = !!project && mode === 'Notebook' && !selected;
  const inspectorVisible = inspectorOpen && inspectorCanShow && !notebookMode;

  return <div className={`app-shell${notebookMode ? ' notebook-mode' : ''}${resizingSidebar ? ' resizing-sidebar' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <header className="topbar">
      <div className="top-identity"><div className="brand"><div className="brand-mark"><span/><span/><span/><span/></div><span>DataForge</span></div><div className="top-project"><span className="project-indicator"/><span className="top-project-name" title={project?.name ?? 'No project open'}>{project?.name ?? 'No project open'}</span></div></div>
      <div className="mode-switch" role="group" aria-label="Workspace mode">{(['Chat','Notebook','Dashboard'] as Mode[]).map(item => <button key={item} aria-pressed={!selected && mode === item} className={!selected && mode === item ? 'active' : ''} onClick={() => selectMode(item)}>{item}</button>)}</div>
      <div className="top-actions">
        <IconButton label="New project" onClick={() => requestProject('new')}><Plus size={16}/></IconButton>
        <IconButton label="Open project" onClick={() => requestProject('open')}><FolderOpen size={16}/></IconButton>
        <span className="top-separator" aria-hidden="true"/>
        {notebookMode
          ? <IconButton label={notebookSidebarOpen ? 'Hide project sidebar' : 'Show project sidebar'} aria-pressed={notebookSidebarOpen} onClick={() => setNotebookSidebarOpen(open => !open)}>{notebookSidebarOpen ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}</IconButton>
          : <IconButton label={!inspectorCanShow ? 'Inspector unavailable at this window width' : inspectorVisible ? 'Hide inspector' : 'Show inspector'} aria-pressed={inspectorVisible} disabled={!inspectorCanShow} onClick={() => setInspectorOpen(open => !open)}>{inspectorVisible ? <PanelRightClose size={16}/> : <PanelRightOpen size={16}/>}</IconButton>}
      </div>
    </header>
    <div className={`body-grid ${inspectorVisible ? '' : 'inspector-hidden'}${notebookMode && !notebookSidebarOpen ? ' sidebar-hidden' : ''}`}>
      {(!notebookMode || notebookSidebarOpen) && <aside className="left-sidebar" aria-label="Workspace navigation">
        <div className="threads-section" aria-hidden={notebookMode} inert={notebookMode}>
          <div className="section-heading"><span>THREADS</span><IconButton label="Threads are not available yet" onClick={() => {}} disabled title="Agent investigations are not available in this version"><Plus size={16}/></IconButton></div>
          <div className="section-empty"><MessageSquare size={16}/><span>No threads yet</span><small>Agent investigations are coming later.</small></div>
        </div>
        <div className="sources-section">
          <div className="section-heading"><span>SOURCES</span><div className="section-actions"><IconButton label="Refresh source status" onClick={refreshDatasets} disabled={!project || !!busy}><RefreshCw size={14}/></IconButton><IconButton label="Register CSV source" onClick={registerCsv} disabled={!project || !!busy}><Plus size={16}/></IconButton></div></div>
          {project ? datasets.length ? <div className="source-list">
            {datasets.map(item => <button key={item.id} className={`source-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => selectDataset(item.id)}>
              <FileSpreadsheet size={16}/><span className="source-copy"><span className="source-name" title={item.name}>{item.name}</span><span className="source-meta">CSV · {byteSize(item.size_bytes)}</span></span><span className={`status-dot ${item.status}`} aria-hidden="true"/>{item.status !== 'ready' && <span className="source-status">{item.status}</span>}</button>)}
          </div> : <div className="sources-empty"><Database size={20}/><span>No sources registered</span><small>Add a CSV file to inspect it.</small></div> : <div className="sources-empty"><Database size={20}/><span>No project open</span><small>Create or open a project first.</small></div>}
          <div className="sources-footer"><button className="add-source" onClick={registerCsv} disabled={!project || !!busy}><FilePlus2 size={16}/> Add CSV source</button></div>
        </div>
        <div className="sidebar-footer"><span className="local-dot"/> Local workspace <span className="version">v0.1</span></div>
        <div className="sidebar-resize-handle" role="separator" aria-label="Resize left sidebar" aria-orientation="vertical" aria-valuemin={SIDEBAR_WIDTH_MIN} aria-valuemax={SIDEBAR_WIDTH_MAX} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} pixels`} tabIndex={0} onPointerDown={onSidebarPointerDown} onPointerMove={onSidebarPointerMove} onPointerUp={onSidebarPointerEnd} onPointerCancel={onSidebarPointerEnd} onLostPointerCapture={onSidebarPointerEnd} onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)} onKeyDown={onSidebarKeyDown}/>
      </aside>}

      <main className="main-workspace">
        {error && <div className="error-banner" role="alert"><CircleAlert size={16}/><span>{error}</span><IconButton label="Dismiss error" onClick={() => setError(null)}><X size={16}/></IconButton></div>}
        <div className="workspace-content">
          {!project ? <div className="welcome-state"><div className="welcome-icon"><Table2 size={28}/></div><h1>Start with a project.</h1><p>Create a local workspace for your data sources and analysis history. You can add a CSV after the project opens.</p><div className="welcome-actions"><Button variant="primary" onClick={() => requestProject('new')}><Plus size={16}/> Create project</Button><Button variant="secondary" onClick={() => requestProject('open')}><FolderOpen size={16}/> Open project</Button></div></div>
          : selected ? <><DatasetWorkspace dataset={selected} inspection={inspection} busy={busy} onRefresh={() => selectDataset(selected.id)} />{inspection && <AnalyticsPanel key={selected.id} dataset={selected} columns={inspection.columns} onSelectExecution={setInspectedExecution} />}</>
          : mode !== 'Notebook' ? <ModeEmpty mode={mode} onAddSource={registerCsv} hasSources={datasets.length > 0} /> : null}
          {project && <div className="notebook-surface" hidden={!!selected || mode !== 'Notebook'}><NotebookWorkspace key={projectSession} active={!selected && mode === 'Notebook'} projectId={project.id} projectName={project.name} sources={datasets} onDirtyChange={setNotebookDirty} /></div>}
        </div>
        {!notebookMode && <div className="composer"><div className="composer-box"><div className="composer-heading"><MessageSquare size={14}/> Agent workspace unavailable</div><div className="composer-row"><span>Connect an agent in a later release to investigate with chat.</span><button disabled aria-label="Send unavailable"><ArrowRight size={16}/></button></div></div><div className="composer-note">No data is sent to an AI provider in this version.</div></div>}
      </main>

      {inspectorVisible && <aside className="inspector" aria-label="Context inspector"><div className="inspector-header"><span>INSPECTOR</span></div>{selected ? <DatasetInspector dataset={selected} inspection={inspection} execution={inspectedExecution?.dataset_id === selected.id ? inspectedExecution : null}/> : <div className="inspector-empty"><div className="inspector-empty-icon"><Search size={20}/></div><strong>Nothing selected</strong><p>Select a source to see its details and column profile.</p></div>}</aside>}
    </div>
    {showCreate && <ProjectDialog onClose={() => setShowCreate(false)} onCreate={createProject} busy={!!busy}/>}
    <ConfirmationDialog open={pendingProject !== null} title="Discard unsaved notebook edits?" description={`Your unsaved notebook edits will be lost if you ${pendingProject === 'new' ? 'create' : 'open'} another project.`} confirmLabel="Discard edits" destructive onCancel={() => setPendingProject(null)} onConfirm={confirmProject}/>
  </div>;
}

function ModeEmpty({ mode, onAddSource, hasSources }: { mode: Mode; onAddSource: () => void; hasSources: boolean }) {
  if (!hasSources) return <div className="mode-empty"><div className="mode-empty-icon"><Database size={28}/></div><h1>Add your first data source.</h1><p>Choose a CSV file to see its preview and column profile. Then you can run an analysis.</p><Button variant="primary" onClick={onAddSource}><FilePlus2 size={16}/> Add CSV source</Button></div>;
  const icon = mode === 'Chat' ? <MessageSquare size={28}/> : mode === 'Notebook' ? <Archive size={28}/> : <LayoutDashboard size={28}/>;
  const heading = mode === 'Chat' ? 'Select a source to continue.' : mode === 'Notebook' ? 'No notebook entries yet.' : 'No dashboard yet.';
  const copy = mode === 'Chat' ? 'Agent conversations are not available in this version.' : mode === 'Notebook' ? 'Analysis executions will appear here when analytical operations are available.' : 'Charts and findings will appear here when dashboard tools are available.';
  return <div className="mode-empty"><div className="mode-empty-icon">{icon}</div><span className="eyebrow">{mode.toUpperCase()} WORKSPACE</span><h1>{heading}</h1><p>{copy}</p></div>;
}

function DatasetWorkspace({ dataset, inspection, busy, onRefresh }: { dataset: Dataset; inspection: Inspection | null; busy: string | null; onRefresh: () => void }) {
  return <div className="dataset-workspace"><div className="dataset-title-row"><div><span className="eyebrow">REGISTERED SOURCE / CSV</span><h1>{dataset.name}</h1><div className="dataset-subtitle"><Badge status={dataset.status}>{dataset.status === 'ready' ? 'Ready' : dataset.status === 'changed' ? 'Changed' : 'Missing'}</Badge><span>{byteSize(dataset.size_bytes)}</span><span>Read-only source</span></div></div><Button variant="secondary" size="small" onClick={onRefresh} disabled={!!busy}><RefreshCw size={14}/> Check source</Button></div>
    {dataset.status !== 'ready' ? <div className="source-warning"><CircleAlert size={20}/><div><strong>{dataset.status === 'missing' ? 'Source file is missing' : 'Source file has changed'}</strong><p>{dataset.status === 'missing' ? 'DataForge cannot find the original CSV at its registered location.' : 'The file no longer matches the registered fingerprint. Its preview is paused; DataForge will not silently refresh it.'}</p></div></div>
    : busy === 'Reading CSV' && !inspection ? <div className="loading-state"><Activity size={20}/> Reading a bounded preview and profiling columns…</div>
    : inspection ? <><section className="data-section"><div className="content-section-heading"><div><h2>Data preview</h2><p>First {inspection.rows.length} rows{inspection.row_count_exact && inspection.row_count !== null ? ` of ${inspection.row_count.toLocaleString()}` : ` · at least ${inspection.scanned_rows.toLocaleString()} scanned`}</p></div><span className="section-tag">{inspection.preview_truncated ? 'TRUNCATED PREVIEW' : 'COMPLETE PREVIEW'}</span></div>{inspection.columns.length ? <div className="table-scroll"><Table><TableHeader><TableRow><TableHead className="row-number">#</TableHead>{inspection.columns.map((column, index) => <TableHead key={`${column.name}-${index}`}><span>{column.name || '(unnamed)'}</span><small>{column.data_type}</small></TableHead>)}</TableRow></TableHeader><TableBody>{inspection.rows.map((row, rowIndex) => <TableRow key={rowIndex}><TableCell className="row-number">{rowIndex + 1}</TableCell>{row.map((value, colIndex) => <TableCell key={colIndex} title={value ?? 'null'}>{value === null || value === '' ? <span className="null-value">{value === null ? 'null' : 'empty'}</span> : value}</TableCell>)}</TableRow>)}</TableBody></Table>{inspection.rows.length === 0 && <TableEmpty>This CSV has column headers but no data rows.</TableEmpty>}</div> : <TableEmpty>This CSV is empty.</TableEmpty>}</section><section className="data-section profile-section"><div className="content-section-heading"><div><h2>Column profile</h2><p>{inspection.row_count_exact ? 'Counts cover the entire file.' : `Statistics cover ${inspection.scanned_rows.toLocaleString()} scanned rows.`}</p></div><span className="section-tag">{inspection.row_count_exact ? 'EXACT' : 'PARTIAL'}</span></div><div className="profile-grid">{inspection.columns.map((column, index) => <div className="profile-row" key={`${column.name}-${index}`}><div className="profile-name"><span className="profile-field-icon"><Table2 size={14}/></span><strong>{column.name || '(unnamed)'}</strong><small>{column.data_type}</small></div><div className="profile-metric"><span>Nulls</span><strong>{column.null_count.toLocaleString()}</strong></div><div className="profile-metric"><span>Distinct{column.distinct_exact ? '' : ' ≥'}</span><strong>{column.distinct_count.toLocaleString()}</strong></div><div className="profile-metric"><span>Min</span><strong>{shortNumber(column.min)}</strong></div><div className="profile-metric"><span>Max</span><strong>{shortNumber(column.max)}</strong></div><div className="profile-metric"><span>Mean</span><strong>{shortNumber(column.mean)}</strong></div><div className="profile-metric"><span>Median</span><strong>{shortNumber(column.median)}</strong></div></div>)}</div></section></>
    : <div className="loading-state">Select “Check source” to inspect this CSV.</div>}
  </div>;
}

function DatasetInspector({ dataset, inspection, execution }: { dataset: Dataset; inspection: Inspection | null; execution: Execution | null }) {
  return <div className="inspector-body"><div className="inspector-source-icon"><FileSpreadsheet size={20}/></div><h2>{dataset.name}</h2><Badge status={dataset.status}>{dataset.status === 'ready' ? 'Ready' : dataset.status === 'changed' ? 'Changed' : 'Missing'}</Badge><div className="inspector-divider"/><div className="inspector-group"><span className="group-label">SOURCE DETAILS</span><dl><div><dt>Format</dt><dd>CSV</dd></div><div><dt>Size</dt><dd>{byteSize(dataset.size_bytes)}</dd></div><div><dt>Registered</dt><dd>{new Date(dataset.registered_at).toLocaleString()}</dd></div><div><dt>Fingerprint</dt><dd className="mono" title={dataset.fingerprint}>{dataset.fingerprint.slice(0, 14)}…</dd></div></dl><div className="path-block" title={dataset.path}>{dataset.path}</div></div><div className="inspector-divider"/><div className="inspector-group"><span className="group-label">COLUMNS {inspection ? `· ${inspection.columns.length}` : ''}</span>{inspection ? <div className="inspector-columns">{inspection.columns.map((column, index) => <div key={`${column.name}-${index}`}><span>{column.name || '(unnamed)'}</span><small>{column.data_type}</small></div>)}</div> : <p className="inspector-hint">{dataset.status === 'ready' ? 'Column details will appear after inspection.' : 'Source must be available and unchanged for inspection.'}</p>}</div>{execution && <><div className="inspector-divider"/><div className="inspector-group"><span className="group-label">SELECTED EXECUTION</span><dl><div><dt>Status</dt><dd>{execution.status}</dd></div><div><dt>Rows returned</dt><dd>{execution.result_row_count ?? '—'}</dd></div><div><dt>Engine</dt><dd>{execution.duckdb_version ? `DuckDB ${execution.duckdb_version}` : '—'}</dd></div><div><dt>Started</dt><dd>{new Date(execution.started_at).toLocaleString()}</dd></div></dl></div></>}</div>;
}

type FilterGroup = { op: 'and' | 'or'; conditions: FilterExpr[] };
function isGroup(expr: FilterExpr): expr is FilterGroup { return 'conditions' in expr; }
export function analysisSettingsKey(settings: AnalysisSettings): string { return JSON.stringify(settings); }
export function isAnalysisResultStale(result: Pick<DisplayedResult, 'settings' | 'invalidated'> | null, settings: string): boolean {
  return !result || result.invalidated || result.settings !== settings;
}
export function canExportAnalysisResult(result: Pick<DisplayedResult, 'settings' | 'invalidated'> | null, settings: string, loading: boolean): boolean {
  return !!result && !loading && !isAnalysisResultStale(result, settings);
}
export function describeFilter(expr: FilterExpr): string {
  if (isGroup(expr)) return `(${expr.conditions.map(describeFilter).join(` ${expr.op.toUpperCase()} `)})`;
  const comparison: Record<Comparison, string> = { eq: '=', ne: '≠', gt: '>', lt: '<', ge: '≥', le: '≤', contains: 'contains', is_null: 'is null', is_not_null: 'is not null' };
  return `${JSON.stringify(expr.column)} ${comparison[expr.op]}${expr.op === 'is_null' || expr.op === 'is_not_null' ? '' : ` ${JSON.stringify(expr.value ?? '')}`}`;
}
export function describeAggregation(item: Aggregation): string {
  const operation: Record<Aggregation['op'], string> = { count: 'Count rows', sum: 'Sum', average: 'Average', min: 'Minimum', max: 'Maximum', distinct_count: 'Distinct count' };
  return `${operation[item.op]}${item.op === 'count' ? '' : ` of ${JSON.stringify(item.column ?? '')}`} as ${JSON.stringify(item.alias)}`;
}
function cleaned(group: FilterGroup): FilterExpr | undefined {
  const conditions = group.conditions.flatMap(item => {
    if (isGroup(item)) { const nested = cleaned(item); return nested ? [nested] : []; }
    return item.op === 'is_null' || item.op === 'is_not_null' || item.value?.length ? [item] : [];
  });
  return conditions.length ? { op: group.op, conditions } : undefined;
}
function incompleteFilter(group: FilterGroup): boolean {
  return group.conditions.some(item => isGroup(item) ? incompleteFilter(item) :
    item.op !== 'is_null' && item.op !== 'is_not_null' && !item.value?.length);
}
export function describeAnalysisOperation({ kind, filters, sort, groupBy, aggregations, limit }: AnalysisSettings): string {
  return `${kind === 'group' ? `Group ${groupBy.length ? `by ${groupBy.length} ${groupBy.length === 1 ? 'column' : 'columns'}` : 'all rows'} · ${aggregations.length} ${aggregations.length === 1 ? 'measure' : 'measures'}` : 'View rows'} · ${incompleteFilter(filters) ? 'Incomplete filter' : cleaned(filters) ? 'Filtered' : 'No filters'} · ${sort.length ? `Sort by ${sort.length} ${sort.length === 1 ? 'column' : 'columns'}` : 'No sort'} · ${limit} rows/page`;
}

export function describeExecution(execution: Execution): { operation: string; configuration: [string, string][]; duration: string } {
  const operation = execution.operation_type === 'group' ? 'Group and summarize' : execution.operation_type === 'rows' ? 'Filter and view rows' : `Operation: ${execution.operation_type}`;
  const configuration: [string, string][] = [];
  try {
    const request: unknown = JSON.parse(execution.parameters);
    if (request && typeof request === 'object' && !Array.isArray(request)) {
      const params = request as Record<string, unknown>;
      if (params.filters === null) configuration.push(['Filters', 'None']);
      else if (params.filters && typeof params.filters === 'object') configuration.push(['Filters', describeFilter(params.filters as FilterExpr)]);
      if (execution.operation_type === 'group') {
        if (Array.isArray(params.group_by) && params.group_by.every(value => typeof value === 'string')) configuration.push(['Group by', params.group_by.length ? params.group_by.map(value => JSON.stringify(value)).join(', ') : 'All rows together']);
        if (Array.isArray(params.aggregations) && params.aggregations.every(value => value && typeof value === 'object' && typeof value.op === 'string' && typeof value.alias === 'string')) configuration.push(['Measures', params.aggregations.length ? (params.aggregations as Aggregation[]).map(describeAggregation).join('; ') : 'None']);
      }
      if (Array.isArray(params.sort) && params.sort.every(value => value && typeof value.column === 'string' && (value.direction === 'asc' || value.direction === 'desc') && (value.nulls === 'first' || value.nulls === 'last'))) configuration.push(['Sort', params.sort.length ? (params.sort as SortSpec[]).map(item => `${JSON.stringify(item.column)} ${item.direction === 'asc' ? 'ascending' : 'descending'}, nulls ${item.nulls}`).join('; ') : 'Unspecified']);
      if (typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0) configuration.push(['Page size', `${params.limit} rows`]);
      if (typeof params.offset === 'number' && Number.isInteger(params.offset) && params.offset >= 0) configuration.push(['Offset', `${params.offset} rows`]);
    }
  } catch { /* Original parameters remain available below. */ }
  const elapsed = execution.completed_at ? Date.parse(execution.completed_at) - Date.parse(execution.started_at) : NaN;
  return { operation, configuration, duration: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s` : '—' };
}

export function executionStatus(status: string): string {
  return ({ succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', running: 'Running', queued: 'Queued', awaiting_approval: 'Awaiting approval' } as Record<string, string>)[status] ?? status;
}

function FilterEditor({ group, onChange, columns, depth = 0 }: { group: FilterGroup; onChange: (next: FilterGroup) => void; columns: string[]; depth?: number }) {
  const replace = (index: number, item: FilterExpr) => onChange({ ...group, conditions: group.conditions.map((value, i) => i === index ? item : value) });
  const remove = (index: number) => onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) });
  return <div className={`filter-group depth-${depth}`}>
    <div className="filter-group-heading"><span>Match</span><Select aria-label="Filter group combination" value={group.op} onChange={e => onChange({ ...group, op: e.target.value as 'and' | 'or' })}><option value="and">all (AND)</option><option value="or">any (OR)</option></Select><span>conditions</span></div>
    {group.conditions.map((item, index) => isGroup(item)
      ? <div className="nested-filter" key={index}><FilterEditor group={item} columns={columns} depth={depth + 1} onChange={next => replace(index, next)} /><IconButton label="Remove filter group" onClick={() => remove(index)}><X size={14}/></IconButton></div>
      : <div className="filter-rule" key={index}>
        <Select aria-label={`Filter ${index + 1} column`} value={item.column} onChange={e => replace(index, { ...item, column: e.target.value })}>{columns.map((name, i) => <option key={i} value={name}>{name || '(unnamed)'}</option>)}</Select>
        <Select aria-label={`Filter ${index + 1} comparison`} value={item.op} onChange={e => replace(index, { ...item, op: e.target.value as Comparison })}>{[['eq','='],['ne','≠'],['gt','>'],['lt','<'],['ge','≥'],['le','≤'],['contains','contains'],['is_null','is null'],['is_not_null','is not null']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select>
        {item.op !== 'is_null' && item.op !== 'is_not_null' && <Input aria-label={`Filter ${index + 1} value`} value={item.value ?? ''} onChange={e => replace(index, { ...item, value: e.target.value })} placeholder="Value" />}
        <IconButton label={`Remove filter ${index + 1}`} onClick={() => remove(index)}><X size={14}/></IconButton>
      </div>)}
    <div className="rule-actions"><Button variant="secondary" size="small" type="button" onClick={() => onChange({ ...group, conditions: [...group.conditions, { column: columns[0], op: 'eq', value: '' }] })}><Plus size={14}/> Condition</Button>{depth < 2 && <Button variant="secondary" size="small" type="button" onClick={() => onChange({ ...group, conditions: [...group.conditions, { op: 'or', conditions: [] }] })}><Plus size={14}/> Group</Button>}</div>
  </div>;
}

function AnalyticsPanel({ dataset, columns, onSelectExecution }: { dataset: Dataset; columns: ColumnProfile[]; onSelectExecution: (execution: Execution | null) => void }) {
  const names = columns.map(column => column.name);
  const [kind, setKind] = useState<'rows' | 'group'>('rows');
  const [filters, setFilters] = useState<FilterGroup>({ op: 'and', conditions: [] });
  const [sort, setSort] = useState<SortSpec[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregations, setAggregations] = useState<Aggregation[]>([{ op: 'count', alias: 'count_rows' }]);
  const [limit, setLimit] = useState(100);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [errorField, setErrorField] = useState<'filters' | 'sort' | 'aggregations' | 'limit' | null>(null);
  const [displayed, setDisplayed] = useState<DisplayedResult | null>(null);
  const [history, setHistory] = useState<Execution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  useEffect(() => onSelectExecution(selectedExecution), [selectedExecution, onSelectExecution]);
  const [loading, setLoading] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sortNames = kind === 'rows' ? names : [...groupBy, ...aggregations.map(item => item.alias)];
  const settings = analysisSettingsKey({ kind, filters, sort, groupBy, aggregations, limit });
  const result = displayed?.data;
  const lastRequest = displayed?.request;
  const stale = !!displayed && isAnalysisResultStale(displayed, settings);
  const canExport = canExportAnalysisResult(displayed, settings, loading);
  const operationSummary = describeAnalysisOperation({ kind, filters, sort, groupBy, aggregations, limit });
  const selectedDescription = selectedExecution && describeExecution(selectedExecution);
  const exportState = useRef({ canExport, executionId: result?.execution.id });
  exportState.current = { canExport, executionId: result?.execution.id };

  useEffect(() => { invoke<Execution[]>('list_executions').then(setHistory).catch(e => setError(errorMessage(e))); }, [dataset.id]);
  useEffect(() => {
    if (!loading) return;
    let current = true;
    async function poll() {
      try { const id = await invoke<string | null>('active_execution'); if (current) setActiveExecutionId(id); }
      catch { /* Execution result carries the useful error. */ }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 300);
    return () => { current = false; window.clearInterval(timer); setActiveExecutionId(null); };
  }, [loading]);

  async function execute(request: AnalyticsRequest, requestSettings: string) {
    setDisplayed(current => current && { ...current, invalidated: true });
    setLoading(true); setError(''); setNotice('');
    try {
      const next = await invoke<AnalyticsResult>('run_analytics', { datasetId: dataset.id, request });
      setDisplayed({ data: next, request, settings: requestSettings, invalidated: false }); setSelectedExecution(next.execution);
      setHistory(await invoke<Execution[]>('list_executions'));
    } catch (e) {
      setError(errorMessage(e));
      try { setHistory(await invoke<Execution[]>('list_executions')); } catch { /* Keep the operation error. */ }
    } finally { setLoading(false); setActiveExecutionId(null); }
  }

  async function cancel() {
    if (!activeExecutionId) return;
    try { await invoke('cancel_execution', { executionId: activeExecutionId }); setNotice('Cancellation requested.'); }
    catch (e) { setError(errorMessage(e)); }
  }

  function run() {
    setDisplayed(current => current && { ...current, invalidated: true });
    setNotice('');
    setErrorField(null);
    if (incompleteFilter(filters)) { setAdvancedOpen(true); setErrorField('filters'); setError('Enter a value for each filter condition, or remove the unfinished condition.'); return; }
    if (sort.some(item => !sortNames.includes(item.column))) { setAdvancedOpen(true); setErrorField('sort'); setError('A sort column is no longer in the result. Update or remove it.'); return; }
    const validSort = sort.filter(item => sortNames.includes(item.column));
    if (kind === 'group' && aggregations.some(item => !item.alias.trim() || (item.op !== 'count' && !item.column))) {
      setErrorField('aggregations'); setError('Each aggregation needs a name and a column, except count rows.'); return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) { setAdvancedOpen(true); setErrorField('limit'); setError('Choose a page size from 1 to 200.'); return; }
    const request: AnalyticsRequest = { kind, limit, offset: 0 };
    const validFilters = cleaned(filters);
    if (validFilters) request.filters = validFilters;
    if (validSort.length) request.sort = validSort;
    if (kind === 'group') { request.group_by = groupBy; request.aggregations = aggregations; }
    void execute(request, settings);
  }

  async function exportPage() {
    if (!result || !canExport) return;
    setError(''); setNotice('');
    try {
      const path = await save({ defaultPath: `${dataset.name.replace(/\.csv$/i, '')}-result.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }], title: 'Export current result page' });
      if (typeof path !== 'string') return;
      if (!exportState.current.canExport || exportState.current.executionId !== result.execution.id) {
        setError('The result changed while choosing a file. Run the operation again before exporting.'); return;
      }
      await invoke('export_result', { path, columns: result.columns.map(column => column.name), rows: result.rows });
      setNotice(`Saved ${result.rows.length} rows from the current page.`);
    } catch (e) { setError(errorMessage(e)); }
  }

  return <section className="analytics-panel" aria-label="Analytical operations">
    <div className="analytics-title"><div><span className="eyebrow">LOCAL ANALYTICS</span><h2>Explore this dataset</h2><p>Run bounded, application-defined operations on the registered CSV. No SQL or code entry.</p></div></div>
    <div className="analytics-builder">
      <div className="analytics-field-row"><label>Operation<Select value={kind} onChange={e => { setKind(e.target.value as 'rows' | 'group'); setSort([]); setError(''); setErrorField(null); }}><option value="rows">Filter and view rows</option><option value="group">Group and summarize</option></Select></label></div>
      {kind === 'group' && <><div className="analytics-subheading">Group by <span>Choose one or more columns</span></div><div className="group-chips">{names.map((name, index) => <label key={index}><input type="checkbox" checked={groupBy.includes(name)} onChange={e => setGroupBy(e.target.checked ? [...groupBy, name] : groupBy.filter(value => value !== name))}/>{name || '(unnamed)'}</label>)}</div><div className="analytics-subheading">Aggregations <span>At least one measure</span></div><div className="builder-list">{aggregations.map((item, index) => <div className="builder-row" key={index}><Select aria-label={`Aggregation ${index + 1} function`} value={item.op} onChange={e => setAggregations(current => current.map((value, i) => i === index ? { ...value, op: e.target.value as Aggregation['op'], column: e.target.value === 'count' ? undefined : (value.column ?? names[0]) } : value))}>{[['count','Count rows'],['sum','Sum'],['average','Average'],['min','Minimum'],['max','Maximum'],['distinct_count','Distinct count']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select>{item.op !== 'count' && <Select aria-label={`Aggregation ${index + 1} column`} value={item.column ?? ''} onChange={e => setAggregations(current => current.map((value, i) => i === index ? { ...value, column: e.target.value } : value))}>{names.map((name, i) => <option key={i} value={name}>{name || '(unnamed)'}</option>)}</Select>}<Input aria-label={`Aggregation ${index + 1} result name`} value={item.alias} onChange={e => setAggregations(current => current.map((value, i) => i === index ? { ...value, alias: e.target.value } : value))} placeholder="Result name"/>{aggregations.length > 1 && <IconButton label={`Remove aggregation ${index + 1}`} onClick={() => setAggregations(current => current.filter((_, i) => i !== index))}><X size={14}/></IconButton>}</div>)}</div><Button variant="secondary" size="small" onClick={() => setAggregations(current => [...current, { op: 'count', alias: `count_${current.length + 1}` }])}><Plus size={14}/> Add aggregation</Button></>}
      {errorField === 'aggregations' && error && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}
      <details className="analytics-advanced" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}><summary>More options <span>{errorField && errorField !== 'aggregations' ? 'Needs attention · ' : ''}{cleaned(filters) ? 'Filters · ' : ''}{sort.length ? 'Sorting · ' : ''}Page size</span></summary>
        <div className="analytics-subheading">Filters <span>Optional · nested AND / OR groups</span></div>
        <FilterEditor group={filters} onChange={setFilters} columns={names} />
        {errorField === 'filters' && error && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}
        <div className="analytics-subheading">Sort order <span>Multiple columns supported</span></div><div className="builder-list">{sort.map((item, index) => <div className="builder-row" key={index}><Select aria-label={`Sort ${index + 1} column`} value={item.column} onChange={e => setSort(current => current.map((value, i) => i === index ? { ...value, column: e.target.value } : value))}>{sortNames.map((name, i) => <option key={i} value={name}>{name || '(unnamed)'}</option>)}</Select><Select aria-label={`Sort ${index + 1} direction`} value={item.direction} onChange={e => setSort(current => current.map((value, i) => i === index ? { ...value, direction: e.target.value as SortSpec['direction'] } : value))}><option value="asc">Ascending</option><option value="desc">Descending</option></Select><Select aria-label={`Sort ${index + 1} null placement`} value={item.nulls} onChange={e => setSort(current => current.map((value, i) => i === index ? { ...value, nulls: e.target.value as SortSpec['nulls'] } : value))}><option value="last">Nulls last</option><option value="first">Nulls first</option></Select><IconButton label={`Remove sort ${index + 1}`} onClick={() => setSort(current => current.filter((_, i) => i !== index))}><X size={14}/></IconButton></div>)}</div><Button variant="secondary" size="small" onClick={() => sortNames.length && setSort(current => [...current, { column: sortNames[0], direction: 'asc', nulls: 'last' }])} disabled={!sortNames.length}><Plus size={14}/> Add sort column</Button>
        {errorField === 'sort' && error && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}
        <div className="analytics-field-row analytics-page-size"><label>Rows per page<Input type="number" min={1} max={200} value={limit} aria-invalid={errorField === 'limit'} onChange={e => setLimit(Number(e.target.value))}/></label></div>
        {errorField === 'limit' && error && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}
      </details>
      <div className="analytics-run"><span>{operationSummary}</span><div className="analytics-run-actions">{loading && <Button variant="secondary" onClick={cancel} disabled={!activeExecutionId}>Cancel</Button>}<Button variant="primary" onClick={run} loading={loading}>{loading ? 'Running…' : 'Run operation'}<ArrowRight size={16}/></Button></div></div>
      {error && !errorField && <div className="inline-error" role="alert"><CircleAlert size={16}/>{error}</div>}{notice && <div className="inline-success" role="status">{notice}</div>}
    </div>
    {result && lastRequest && displayed && <div className="analytics-results">
      <div className="content-section-heading"><div><h2>Result</h2><p>{result.total_rows === null ? `${result.rows.length} rows on this page` : `${result.total_rows.toLocaleString()} matching rows · ${result.rows.length} on this page`}</p></div><Button variant="secondary" size="small" onClick={exportPage} disabled={!canExport}><Download size={14}/> Export current page</Button></div>
      {stale && <div className="result-stale" role="status"><CircleAlert size={16}/><span>{loading ? 'Previous result. A new operation is running; export is unavailable.' : displayed.invalidated ? 'Previous result. The latest attempt did not complete; run the operation again before exporting.' : 'Previous result. Settings changed; run the operation again before exporting.'}</span></div>}
      <div className="result-configuration"><strong>Configuration for this result</strong><dl>
        <div><dt>Operation</dt><dd>{lastRequest.kind === 'group' ? 'Group and summarize' : 'Filter and view rows'}</dd></div>
        <div><dt>Filters</dt><dd>{lastRequest.filters ? describeFilter(lastRequest.filters) : 'None'}</dd></div>
        {lastRequest.kind === 'group' && <><div><dt>Group by</dt><dd>{lastRequest.group_by?.length ? lastRequest.group_by.map(name => JSON.stringify(name)).join(', ') : 'All rows together'}</dd></div><div><dt>Measures</dt><dd>{lastRequest.aggregations?.map(describeAggregation).join('; ') || 'None'}</dd></div></>}
        <div><dt>Sort</dt><dd>{lastRequest.sort?.length ? lastRequest.sort.map(item => `${JSON.stringify(item.column)} ${item.direction === 'asc' ? 'ascending' : 'descending'}, nulls ${item.nulls}`).join('; ') : 'Unspecified'}</dd></div>
        <div><dt>Page</dt><dd>Starts at row {(lastRequest.offset ?? 0) + 1}; up to {lastRequest.limit ?? 100} rows</dd></div>
      </dl></div>
      <div className="table-scroll"><Table><TableHeader><TableRow>{result.columns.map((column, i) => <TableHead key={i}><span>{column.name}</span><small>{column.data_type}</small></TableHead>)}</TableRow></TableHeader><TableBody>{result.rows.map((row, i) => <TableRow key={i}>{row.map((value, j) => <TableCell key={j} title={value ?? 'null'}>{value === null ? <span className="null-value">null</span> : value}</TableCell>)}</TableRow>)}</TableBody></Table>{!result.rows.length && <TableEmpty>No rows matched this operation.</TableEmpty>}</div>
      <div className="result-pagination"><span>Offset {lastRequest.offset ?? 0}</span><Button variant="secondary" size="small" disabled={loading || !lastRequest.offset} onClick={() => void execute({ ...lastRequest, offset: Math.max(0, (lastRequest.offset ?? 0) - (lastRequest.limit ?? 100)) }, displayed.settings)}>Previous</Button><Button variant="secondary" size="small" disabled={loading || !result.has_more} onClick={() => void execute({ ...lastRequest, offset: (lastRequest.offset ?? 0) + (lastRequest.limit ?? 100) }, displayed.settings)}>Next</Button></div>
    </div>}
    <div className="analytics-history">
      <div className="content-section-heading"><div><h2>Execution history</h2><p>Saved in this project. Earlier result pages are not stored.</p></div></div>
      {history.filter(item => item.dataset_id === dataset.id).length
        ? <div className="history-list">{history.filter(item => item.dataset_id === dataset.id).map(item => {
          const description = describeExecution(item);
          return <button key={item.id} className={selectedExecution?.id === item.id ? 'selected' : ''} onClick={() => setSelectedExecution(item)} aria-pressed={selectedExecution?.id === item.id}>
            <span className="history-operation"><strong>{description.operation}</strong><span>{description.configuration.map(([label, value]) => `${label}: ${value}`).join(' · ') || 'Configuration unavailable'}</span></span>
            <small><span className={`execution-status status-${item.status}`}>{executionStatus(item.status)}</span> · {new Date(item.started_at).toLocaleString()} · {description.duration}</small>
          </button>;
        })}</div>
        : <TableEmpty>No analytical operations have been run for this source.</TableEmpty>}
      {selectedExecution && selectedDescription && <div className="execution-details">
        <div className="analytics-subheading">Execution details</div>
        <dl className="execution-summary">
          <div><dt>Operation</dt><dd>{selectedDescription.operation}</dd></div>
          {selectedDescription.configuration.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          <div><dt>Status</dt><dd className={`execution-status status-${selectedExecution.status}`}>{executionStatus(selectedExecution.status)}</dd></div>
          <div><dt>Duration</dt><dd>{selectedDescription.duration}</dd></div>
          {selectedExecution.result_row_count !== null && <div><dt>Rows returned</dt><dd>{selectedExecution.result_row_count}</dd></div>}
        </dl>
        {selectedExecution.error_summary && <p className="inline-error">{selectedExecution.error_summary}</p>}
        <details className="execution-technical"><summary>Technical details</summary>
          <dl>
            <div><dt>Execution ID</dt><dd className="mono">{selectedExecution.id}</dd></div>
            <div><dt>Engine</dt><dd>{selectedExecution.duckdb_version ? `DuckDB ${selectedExecution.duckdb_version}` : '—'}</dd></div>
            <div><dt>Source fingerprint</dt><dd className="mono">{selectedExecution.source_fingerprint}</dd></div>
            <div><dt>Started</dt><dd>{new Date(selectedExecution.started_at).toLocaleString()}</dd></div>
            <div><dt>Completed</dt><dd>{selectedExecution.completed_at ? new Date(selectedExecution.completed_at).toLocaleString() : '—'}</dd></div>
          </dl>
          <div className="execution-parameters-label">Original parameters</div><pre>{selectedExecution.parameters}</pre>
        </details>
      </div>}
    </div>
  </section>;
}
