import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Activity, Archive, ArrowRight, ChevronDown,
  ChevronRight, CircleAlert, Database, FilePlus2, FileSpreadsheet, FolderOpen,
  LayoutDashboard, MessageSquare, PanelRightClose, PanelRightOpen,
  Plus, RefreshCw, Search, Table2, X,
} from 'lucide-react';

type Mode = 'Chat' | 'Notebook' | 'Dashboard';
type Status = 'ready' | 'missing' | 'changed';
type Project = { id: string; name: string; path: string; created_at: string };
type Dataset = { id: string; name: string; path: string; size_bytes: number; registered_at: string; fingerprint: string; status: Status };
type ColumnProfile = { name: string; data_type: 'text' | 'integer' | 'decimal' | 'boolean'; null_count: number; distinct_count: number; distinct_exact: boolean; min: number | null; max: number | null; mean: number | null };
type Inspection = { dataset: Dataset; columns: ColumnProfile[]; rows: (string | null)[][]; row_count: number | null; row_count_exact: boolean; preview_truncated: boolean; scanned_rows: number };
type ProjectState = { project: Project; datasets: Dataset[] };

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

function IconButton({ label, onClick, children, disabled, title }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return <Button variant="icon" aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled}>{children}</Button>;
}

function ProjectDialog({ onClose, onCreate, busy }: { onClose: () => void; onCreate: (name: string, location: string) => Promise<void>; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
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
  return <dialog ref={ref} className="project-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">NEW WORKSPACE</span><h2>Create project</h2></div><IconButton label="Close" onClick={onClose} disabled={busy}><X size={16} /></IconButton></div>
    <p className="dialog-copy">Choose where DataForge will keep this project's metadata. Your source files stay in their original locations.</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="project-name">Project name</label>
      <Input id="project-name" autoFocus maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Quarterly research" disabled={busy} />
      <label className="field-label" htmlFor="project-location">Parent folder</label>
      <div className="folder-field"><Input id="project-location" value={location} readOnly placeholder="Choose a folder" /><Button type="button" variant="secondary" onClick={pickFolder} disabled={busy}>Browse</Button></div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={15}/>{error}</div>}
      <div className="dialog-actions"><Button type="button" variant="text" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}<ArrowRight size={15}/></Button></div>
    </form>
  </dialog>;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [mode, setMode] = useState<Mode>('Chat');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSerial = useRef(0);
  const selected = datasets.find(item => item.id === selectedId) ?? null;

  function activate(state: ProjectState) {
    requestSerial.current += 1;
    setProject(state.project);
    setDatasets(state.datasets);
    setSelectedId(null);
    setInspection(null);
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
    setSelectedId(id); setInspection(null); setError(null);
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span/><span/><span/><span/></div><span>DataForge</span><span className="brand-divider"/><span className="app-kind">WORKSPACE</span></div>
      <div className="top-center"><span className="project-indicator"/><span className="top-project-name">{project?.name ?? 'No project open'}</span>{project && <ChevronDown size={13} className="muted-icon"/>}</div>
      <div className="top-actions"><button className="top-link" onClick={() => setShowCreate(true)}>New project</button><button className="top-link" onClick={openProject}>Open project</button><span className="top-separator"/><IconButton label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</IconButton></div>
    </header>
    <div className={`body-grid ${inspectorOpen ? '' : 'inspector-hidden'}`}>
      <aside className="left-sidebar" aria-label="Workspace navigation">
        <div className="threads-section">
          <div className="section-heading"><span>THREADS</span><IconButton label="Threads are not available yet" onClick={() => {}} disabled title="Agent investigations are not available in this version"><Plus size={15}/></IconButton></div>
          <div className="section-empty"><MessageSquare size={17}/><span>No threads yet</span><small>Agent investigations are coming later.</small></div>
        </div>
        <div className="sources-section">
          <div className="section-heading"><span>SOURCES</span><div className="section-actions"><IconButton label="Refresh source status" onClick={refreshDatasets} disabled={!project || !!busy}><RefreshCw size={14}/></IconButton><IconButton label="Register CSV source" onClick={registerCsv} disabled={!project || !!busy}><Plus size={16}/></IconButton></div></div>
          {project ? datasets.length ? <div className="source-list">
            {datasets.map(item => <button key={item.id} className={`source-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => selectDataset(item.id)}>
              <FileSpreadsheet size={16}/><span className="source-copy"><span className="source-name" title={item.name}>{item.name}</span><span className="source-meta">CSV · {byteSize(item.size_bytes)}</span></span><span className={`status-dot ${item.status}`} aria-hidden="true"/>{item.status !== 'ready' && <span className="source-status">{item.status}</span>}</button>)}
          </div> : <div className="sources-empty"><Database size={18}/><span>No sources registered</span><small>Add a CSV file to inspect it.</small></div> : <div className="sources-empty"><Database size={18}/><span>No project open</span><small>Create or open a project first.</small></div>}
          <div className="sources-footer"><button className="add-source" onClick={registerCsv} disabled={!project || !!busy}><FilePlus2 size={15}/> Add CSV source</button></div>
        </div>
        <div className="sidebar-footer"><span className="local-dot"/> Local workspace <span className="version">v0.1</span></div>
      </aside>

      <main className="main-workspace">
        <div className="workspace-toolbar"><div className="crumbs">{project ? <><span>{project.name}</span><ChevronRight size={13}/><strong>{selected ? selected.name : mode}</strong></> : <strong>Welcome</strong>}</div><div className="mode-switch" role="group" aria-label="Workspace mode">{(['Chat','Notebook','Dashboard'] as Mode[]).map(item => <button key={item} aria-pressed={!selected && mode === item} className={!selected && mode === item ? 'active' : ''} onClick={() => selectMode(item)}>{item}</button>)}</div><div className="toolbar-end"><span className="local-label"><span/> LOCAL</span><IconButton label="Inspector options" onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? <PanelRightClose size={16}/> : <PanelRightOpen size={16}/>}</IconButton></div></div>
        {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><IconButton label="Dismiss error" onClick={() => setError(null)}><X size={15}/></IconButton></div>}
        <div className="workspace-content">
          {!project ? <div className="welcome-state"><div className="welcome-icon"><Table2 size={29}/></div><span className="eyebrow">LOCAL DATA WORKSPACE</span><h1>Start with a project.</h1><p>Create a space for your sources and analysis, or reopen one you already have. Everything in this slice runs locally.</p><div className="welcome-actions"><Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={16}/> Create project</Button><Button variant="secondary" onClick={openProject}><FolderOpen size={16}/> Open existing</Button></div><div className="welcome-note"><span>01 &nbsp; Create a project</span><span>02 &nbsp; Register a CSV</span><span>03 &nbsp; Inspect your data</span></div></div>
          : selected ? <DatasetWorkspace dataset={selected} inspection={inspection} busy={busy} onRefresh={() => selectDataset(selected.id)} />
          : <ModeEmpty mode={mode} onAddSource={registerCsv} hasSources={datasets.length > 0} />}
        </div>
        <div className="composer"><div className="composer-box"><div className="composer-heading"><MessageSquare size={14}/> Agent workspace unavailable</div><div className="composer-row"><span>Connect an agent in a later release to investigate with chat.</span><button disabled aria-label="Send unavailable"><ArrowRight size={16}/></button></div></div><div className="composer-note">No data is sent to an AI provider in this version.</div></div>
      </main>

      {inspectorOpen && <aside className="inspector" aria-label="Context inspector"><div className="inspector-header"><span>INSPECTOR</span><IconButton label="Hide inspector" onClick={() => setInspectorOpen(false)}><X size={15}/></IconButton></div>{selected ? <DatasetInspector dataset={selected} inspection={inspection}/> : <div className="inspector-empty"><div className="inspector-empty-icon"><Search size={19}/></div><strong>Nothing selected</strong><p>Select a source to see its details and column profile.</p></div>}</aside>}
    </div>
    {showCreate && <ProjectDialog onClose={() => setShowCreate(false)} onCreate={createProject} busy={!!busy}/>}
  </div>;
}

function ModeEmpty({ mode, onAddSource, hasSources }: { mode: Mode; onAddSource: () => void; hasSources: boolean }) {
  const icon = mode === 'Chat' ? <MessageSquare size={29}/> : mode === 'Notebook' ? <Archive size={29}/> : <LayoutDashboard size={29}/>;
  const heading = mode === 'Chat' ? 'Your investigation starts here.' : mode === 'Notebook' ? 'No notebook entries yet.' : 'No dashboard yet.';
  const copy = mode === 'Chat' ? 'Register a CSV source to inspect its structure and profile. Agent conversations are not available in this version.' : mode === 'Notebook' ? 'Analysis executions will appear here when analytical operations are available.' : 'Charts and findings will appear here when dashboard tools are available.';
  return <div className="mode-empty"><div className="mode-empty-icon">{icon}</div><span className="eyebrow">{mode.toUpperCase()} WORKSPACE</span><h1>{heading}</h1><p>{copy}</p>{!hasSources && <button className="secondary-button" onClick={onAddSource}><Plus size={16}/> Add a CSV source</button>}</div>;
}

function DatasetWorkspace({ dataset, inspection, busy, onRefresh }: { dataset: Dataset; inspection: Inspection | null; busy: string | null; onRefresh: () => void }) {
  return <div className="dataset-workspace"><div className="dataset-title-row"><div><span className="eyebrow">REGISTERED SOURCE / CSV</span><h1>{dataset.name}</h1><div className="dataset-subtitle"><span className={`status-pill ${dataset.status}`}>{dataset.status === 'ready' ? 'Ready' : dataset.status === 'changed' ? 'Changed' : 'Missing'}</span><span>{byteSize(dataset.size_bytes)}</span><span>Read-only source</span></div></div><button className="secondary-button small" onClick={onRefresh} disabled={!!busy}><RefreshCw size={14}/> Check source</button></div>
    {dataset.status !== 'ready' ? <div className="source-warning"><CircleAlert size={20}/><div><strong>{dataset.status === 'missing' ? 'Source file is missing' : 'Source file has changed'}</strong><p>{dataset.status === 'missing' ? 'DataForge cannot find the original CSV at its registered location.' : 'The file no longer matches the registered fingerprint. Its preview is paused; DataForge will not silently refresh it.'}</p></div></div>
    : busy === 'Reading CSV' && !inspection ? <div className="loading-state"><Activity size={20}/> Reading a bounded preview and profiling columns…</div>
    : inspection ? <><section className="data-section"><div className="content-section-heading"><div><h2>Data preview</h2><p>First {inspection.rows.length} rows{inspection.row_count_exact && inspection.row_count !== null ? ` of ${inspection.row_count.toLocaleString()}` : ` · at least ${inspection.scanned_rows.toLocaleString()} scanned`}</p></div><span className="section-tag">{inspection.preview_truncated ? 'TRUNCATED PREVIEW' : 'COMPLETE PREVIEW'}</span></div>{inspection.columns.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th className="row-number">#</th>{inspection.columns.map((column, index) => <th key={`${column.name}-${index}`}><span>{column.name || '(unnamed)'}</span><small>{column.data_type}</small></th>)}</tr></thead><tbody>{inspection.rows.map((row, rowIndex) => <tr key={rowIndex}><td className="row-number">{rowIndex + 1}</td>{row.map((value, colIndex) => <td key={colIndex} title={value ?? 'null'}>{value === null || value === '' ? <span className="null-value">{value === null ? 'null' : 'empty'}</span> : value}</td>)}</tr>)}</tbody></table>{inspection.rows.length === 0 && <div className="table-empty">This CSV has column headers but no data rows.</div>}</div> : <div className="table-empty">This CSV is empty.</div>}</section><section className="data-section profile-section"><div className="content-section-heading"><div><h2>Column profile</h2><p>{inspection.row_count_exact ? 'Counts cover the entire file.' : `Statistics cover ${inspection.scanned_rows.toLocaleString()} scanned rows.`}</p></div><span className="section-tag">{inspection.row_count_exact ? 'EXACT' : 'PARTIAL'}</span></div><div className="profile-grid">{inspection.columns.map((column, index) => <div className="profile-row" key={`${column.name}-${index}`}><div className="profile-name"><span className="profile-field-icon"><Table2 size={13}/></span><strong>{column.name || '(unnamed)'}</strong><small>{column.data_type}</small></div><div className="profile-metric"><span>Nulls</span><strong>{column.null_count.toLocaleString()}</strong></div><div className="profile-metric"><span>Distinct{column.distinct_exact ? '' : ' ≥'}</span><strong>{column.distinct_count.toLocaleString()}</strong></div><div className="profile-metric"><span>Min</span><strong>{shortNumber(column.min)}</strong></div><div className="profile-metric"><span>Max</span><strong>{shortNumber(column.max)}</strong></div><div className="profile-metric"><span>Mean</span><strong>{shortNumber(column.mean)}</strong></div></div>)}</div></section></>
    : <div className="loading-state">Select “Check source” to inspect this CSV.</div>}
  </div>;
}

function DatasetInspector({ dataset, inspection }: { dataset: Dataset; inspection: Inspection | null }) {
  return <div className="inspector-body"><div className="inspector-source-icon"><FileSpreadsheet size={21}/></div><h2>{dataset.name}</h2><span className={`status-pill ${dataset.status}`}>{dataset.status === 'ready' ? 'Ready' : dataset.status === 'changed' ? 'Changed' : 'Missing'}</span><div className="inspector-divider"/><div className="inspector-group"><span className="group-label">SOURCE DETAILS</span><dl><div><dt>Format</dt><dd>CSV</dd></div><div><dt>Size</dt><dd>{byteSize(dataset.size_bytes)}</dd></div><div><dt>Registered</dt><dd>{new Date(dataset.registered_at).toLocaleString()}</dd></div><div><dt>Fingerprint</dt><dd className="mono" title={dataset.fingerprint}>{dataset.fingerprint.slice(0, 14)}…</dd></div></dl><div className="path-block" title={dataset.path}>{dataset.path}</div></div><div className="inspector-divider"/><div className="inspector-group"><span className="group-label">COLUMNS {inspection ? `· ${inspection.columns.length}` : ''}</span>{inspection ? <div className="inspector-columns">{inspection.columns.map((column, index) => <div key={`${column.name}-${index}`}><span>{column.name || '(unnamed)'}</span><small>{column.data_type}</small></div>)}</div> : <p className="inspector-hint">{dataset.status === 'ready' ? 'Column details will appear after inspection.' : 'Source must be available and unchanged for inspection.'}</p>}</div></div>;
}
