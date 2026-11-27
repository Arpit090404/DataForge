import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from './components/ui/table';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, IconButton } from './components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { ConfirmationDialog } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './components/ui/popover';
import { Select } from './components/ui/select';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
import { Markdown } from './Markdown';
import { decideDeletePress, decideNotebookKey, editCodeIndent } from './notebookKeys';
import { runCodeSequence } from './notebookRun';
import type { CodeRunStatus } from './notebookRun';
import { filterNotebooks, sortNotebooks } from './notebookHome';
import { describeNotebookExecution, notebookExecutionLabel, registeredSourceName } from './notebookProvenance';
import { NotebookAnalysisForm } from './NotebookAnalysisForm';
import { buildNotebookRequest, configurationFromExecution, defaultConfiguration } from './notebookAnalysis';
import type { Column, Configuration } from './notebookAnalysis';
import { nextResultPage, previousResultPage, resultRowRange, savedResultPage } from './notebookResultPage';
import { datasetAccessName } from './notebookDataRefs';
import type { ResultPage } from './notebookResultPage';
import { BookOpen, Check, CircleX, Clock3, Ellipsis, LoaderCircle, Play, Plus, Search, Square } from 'lucide-react';

type Execution = { id: string; dataset_id: string; operation_type: string; parameters: string; started_at: string; completed_at: string | null; status: string; result_row_count: number | null; error_summary: string | null; duckdb_version: string | null; source_fingerprint: string };
type Result = { execution: Execution; columns: { name: string; data_type: string }[]; rows: (string | null)[][]; total_rows: number | null; has_more: boolean; restored?: boolean };
type Block = { id: string; notebook_id: string; position: number; kind: 'markdown' | 'code' | 'result'; content: string; language: 'python' | 'sql' | null; execution_id: string | null; created_at: string; updated_at: string };
type Notebook = { id: string; title: string; created_at: string; updated_at: string; blocks: Block[] };
type Summary = { id: string; title: string; updated_at: string; block_count: number };
type Source = { id: string; name: string; status: string };
type PythonEnvironment = { path: string; version: string };
type PythonRuntime = { status: 'stopped' | 'idle' | 'running' | 'unavailable'; python: string | null; environment: string | null };
type PythonOutput = { kind: string; text: string; mime?: string; data?: string; columns?: string[]; rows?: string[][]; truncated?: boolean };
type PythonResult = { execution_id: string; status: string; count: number | null; outputs: PythonOutput[]; duration_ms: number; python: string; restored?: boolean; recorded_code?: string };
type SavedCodeOutput = { block_id: string; execution_id: string; kind: 'sql' | 'python'; code: string; status: string; value: unknown };
type OutputUsage = { total_bytes: number; reclaimable_bytes: number; reclaimable_blobs: number };
const numericColumnType = /^(?:integer|decimal)$/;

export function codeExecutionForBlock(executions: Execution[], blockId: string): Execution | undefined {
  return executions.find(execution => {
    if (execution.operation_type !== 'sql') return false;
    try { return JSON.parse(execution.parameters).code_block_id === blockId; } catch { return false; }
  });
}

export function SqlCodePanel({ sqlText, sources, result, execution, error, running, disabled, canCancel, resultName, onResultNameChange, onRun, onCancel }: {
  sqlText: string; sources: Source[];
  result?: Result; execution?: Execution; error?: string; running: boolean; disabled: boolean; canCancel: boolean;
  resultName?: string; onResultNameChange?: (name: string) => void;
  onRun: () => void; onCancel: () => void;
}) {
  const ready = sources.filter(source => source.status === 'ready');
  const recorded = (() => { try { return JSON.parse(execution?.parameters ?? '{}') as { sql?: string; result_name?: string; inputs?: { dataset_id: string; source_fingerprint: string; representation_id?: string }[]; result_inputs?: { result_id: string; execution_id: string }[] }; } catch { return {}; } })();
  const recordedSql = recorded.sql;
  const boundInputs = Array.isArray(recorded.inputs) ? recorded.inputs : [];
  const duration = execution?.completed_at ? Date.parse(execution.completed_at) - Date.parse(execution.started_at) : NaN;
  return <div className="notebook-sql-panel">
    <div className="notebook-sql-controls"><label>Result name <Input value={resultName ?? ''} placeholder="Auto: stable cell name" disabled={running || disabled} onChange={event => onResultNameChange?.(event.target.value)}/></label></div>
    <div className="notebook-sql-controls"><Button type="button" variant="secondary" size="small" loading={running} disabled={disabled || !sqlText.trim()} onClick={onRun}>{running ? 'RunningÃ¢â‚¬Â¦' : 'Run SQL'}</Button>{running && <Button type="button" variant="ghost" size="small" disabled={!canCancel} onClick={onCancel}>Cancel</Button>}</div>
    <p className="notebook-sql-disclosure">Runs locally with your account's privileges. DuckDB read-only settings are not an OS sandbox. Query registered datasets and published results by name. Complete outputs up to 200 rows are published; larger outputs remain previews.</p>
    <details className="notebook-muted"><summary>Available datasets ({ready.length})</summary>{ready.map(source => <div key={source.id}>{source.name}: <code>{`"${datasetAccessName(source, sources).replaceAll('"', '""')}"`}</code></div>)}</details>
    {running && <p role="status">Running SQLÃ¢â‚¬Â¦</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {execution && <p className="notebook-muted">Latest run: {execution.status} Ã‚Â· {Number.isFinite(duration) && duration >= 0 ? `${duration} ms` : 'duration unavailable'} Ã‚Â· {boundInputs.length > 1 ? boundInputs.length + ' datasets' : sources.find(source => source.id === execution.dataset_id)?.name ?? 'Source unavailable'}{recordedSql !== sqlText ? ' Ã‚Â· Code changed since run' : ''}</p>}
    {result && !result.has_more && recorded.result_name && <p className="notebook-muted">Published as <code>{recorded.result_name}</code>.</p>}
    {result && <><div className="table-scroll"><Table><TableHeader><TableRow>{result.columns.map((column, index) => <TableHead key={index} className={numericColumnType.test(column.data_type) ? 'notebook-number' : undefined}>{column.name}</TableHead>)}</TableRow></TableHeader><TableBody>{result.rows.map((row, index) => <TableRow key={index}>{row.map((value, column) => <TableCell key={column} className={numericColumnType.test(result.columns[column]?.data_type ?? '') ? 'notebook-number' : undefined}>{value ?? <span className="null-value">null</span>}</TableCell>)}</TableRow>)}</TableBody></Table>{!result.rows.length && <TableEmpty>No rows returned.</TableEmpty>}</div><p className="notebook-muted">{result.rows.length} rows shown{result.has_more ? ' | TRUNCATED at 200 rows; not a complete result' : ' | complete query output'}. {result.restored ? 'Stored output from an earlier execution; no query was run.' : 'Output saved with this execution.'}</p></>}
    {execution && <details><summary>SQL execution details</summary><small>Execution ID: {execution.id}<br/>DuckDB: {execution.duckdb_version ?? 'Unavailable'}</small>{boundInputs.length ? boundInputs.map(input => <div key={input.dataset_id}><small>Dataset ID: {input.dataset_id}<br/>Source fingerprint: {input.source_fingerprint}<br/>Representation ID: {input.representation_id ?? 'Unavailable'}</small></div>) : <small><br/>Source fingerprint: {execution.source_fingerprint}</small>}<pre>{recordedSql}</pre></details>}
  </div>;
}

export function PythonCodePanel({ selected, onRun, onInterrupt, result, error, running, disabled, code,
  sources, sqlExecutions, sqlExecutionId, onSqlExecutionChange }: {
  selected: string;
  onRun: () => void; onInterrupt: () => void; result?: PythonResult; error?: string;
  running: boolean; disabled: boolean; code: string; sources?: Source[];
  sqlExecutions?: Execution[]; sqlExecutionId?: string; onSqlExecutionChange?: (id: string) => void;
}) {
  return <div className="notebook-sql-panel notebook-python-panel">
    <div className="notebook-sql-controls"><label>SQL result <Select value={sqlExecutionId ?? ''} disabled={running || disabled} onChange={event => onSqlExecutionChange?.(event.target.value)}><option value="">None</option>{sqlExecutions?.filter(run => run.status === 'succeeded').map(run => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.dataset_id}</option>)}</Select></label></div>
    <p className="notebook-muted">Use literal <code>dataforge.dataset("name")</code> or <code>dataforge.result("name")</code> calls. Publish a complete DataFrame with <code>dataforge.publish("name", frame)</code>. Inputs over 200 rows or 3 MiB fail explicitly. DataFrames carry provenance in <code>df.attrs["dataforge"]</code>.</p>
    <details className="notebook-muted"><summary>Available datasets ({sources?.filter(source => source.status === 'ready').length ?? 0})</summary>{sources?.filter(source => source.status === 'ready').map(source => <div key={source.id}>{source.name}: <code>{`dataforge.dataset(${JSON.stringify(datasetAccessName(source, sources ?? []))})`}</code></div>)}</details>
    <div className="notebook-sql-controls"><Button type="button" variant="secondary" size="small" loading={running} disabled={disabled || !selected || !code.trim()} onClick={onRun}>Run Python</Button>{running && <Button type="button" variant="ghost" size="small" onClick={onInterrupt}>Interrupt</Button>}</div>
    <p className="notebook-sql-disclosure">Trusted Python runs locally with your account's full file and network privileges. Variables persist within this notebook's kernel until restart. Tables, PNG/JPEG images, and plain text are shown; executable HTML is never rendered.</p>
    {!selected && !error && <p className="notebook-muted">No compatible Python was found automatically. Open Notebook options, then Python environment, then Choose executable, or install ipykernel and jupyter_client in a Python on PATH.</p>}
    {running && <p role="status">Running PythonÃ¢â‚¬Â¦</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    {result && <><p className="notebook-muted">{result.status} Ã‚Â· In [{result.count ?? ' '} ] Ã‚Â· {result.duration_ms} ms Ã‚Â· Python {result.python}{result.recorded_code !== undefined && result.recorded_code !== code ? ' · Code changed since run' : ''}{result.restored ? ' · Stored output; kernel state was not restored' : ''}</p>{result.outputs.map((output,index) => <PythonOutputView key={index} output={output}/>)}</>}
  </div>;
}

export function PythonOutputView({ output }: { output: PythonOutput }) {
  if (output.kind === 'table' && output.columns?.length && output.rows) return <div className="notebook-python-rich"><div className="table-scroll"><Table><TableHeader><TableRow>{output.columns.map((name,index) => <TableHead key={index}>{name}</TableHead>)}</TableRow></TableHeader><TableBody>{output.rows.map((row,index) => <TableRow key={index}>{row.map((cell,column) => <TableCell key={column} title={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>{!output.rows.length && <TableEmpty>Empty DataFrame</TableEmpty>}</div>{output.truncated && <p className="notebook-muted">Showing the first 200 rows and 64 columns.</p>}{output.text && <details><summary>Plain text</summary><pre className="notebook-python-output">{output.text}</pre></details>}</div>;
  if (output.kind === 'image' && (output.mime === 'image/png' || output.mime === 'image/jpeg') && output.data && /^[A-Za-z0-9+/=]+$/.test(output.data)) return <div className="notebook-python-rich"><img className="notebook-python-image" src={`data:${output.mime};base64,${output.data}`} alt={output.text || 'Python image output'}/>{output.text && <details><summary>Plain text</summary><pre className="notebook-python-output">{output.text}</pre></details>}</div>;
  return <pre className={`notebook-python-output notebook-python-${output.kind}`}>{output.text}</pre>;
}

function InsertionSlot({ disabled, insert, location }: { disabled: boolean; insert: (kind: 'code' | 'markdown') => void; location: string }) {
  return <div className="notebook-insertion"><div className="notebook-insertion-actions"><Button variant="secondary" size="small" type="button" aria-label={`Insert Code ${location}`} disabled={disabled} onClick={() => insert('code')}>+ Code</Button><Button variant="secondary" size="small" type="button" aria-label={`Insert Text ${location}`} disabled={disabled} onClick={() => insert('markdown')}>+ Text</Button></div></div>;
}

export function CodeGutter({ number, state, disabled, onRun, onStop }: { number: number; state?: CodeRunStatus; disabled: boolean; onRun: () => void; onStop: () => void }) {
  const running = state === 'running';
  const StatusIcon = state === 'completed' ? Check : state === 'failed' || state === 'cancelled' ? CircleX : state === 'queued' ? Clock3 : running ? LoaderCircle : null;
  return <div className="notebook-code-gutter">
    <IconButton label={`${running ? 'Stop' : 'Run'} code cell ${number}`} disabled={disabled && !running} onClick={event => { event.stopPropagation(); if (running) onStop(); else onRun(); }}>{running ? <Square aria-hidden="true"/> : <Play aria-hidden="true"/>}</IconButton>
    <span className="notebook-gutter-status" role="status">{StatusIcon && <Tooltip><TooltipTrigger render={<span tabIndex={0} aria-label={`Code cell ${number} ${state}`} className={`notebook-gutter-icon status-${state}`} />}><StatusIcon aria-hidden="true" className={running ? 'motion-safe:animate-spin' : undefined}/></TooltipTrigger><TooltipContent>{state}</TooltipContent></Tooltip>}</span>
  </div>;
}

function message(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') { try { return message(JSON.parse(error)); } catch { return error; } }
  return 'The notebook operation could not be completed.';
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error === 'string') {
    try { return hasErrorCode(JSON.parse(error), code); } catch { return false; }
  }
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

function ResultBlock({ executionId, execution: historyExecution, sources, initialResult }: { executionId: string; execution?: Execution; sources: Source[]; initialResult?: Result }) {
  const [result, setResult] = useState<Result | null>(initialResult ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(!!initialResult);
  const [page, setPage] = useState<ResultPage | null>(initialResult ? savedResultPage(initialResult.execution.parameters) : null);
  const [retryPage, setRetryPage] = useState<ResultPage | null>(null);
  const requestSerial = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    setResult(initialResult ?? null); setError(''); setLoading(false); setLoaded(!!initialResult);
    setPage(initialResult ? savedResultPage(initialResult.execution.parameters) : null); setRetryPage(null);
    return () => { requestSerial.current++; pending.current = false; };
  }, [executionId]);
  async function loadPage(target?: ResultPage) {
    if (pending.current) return;
    pending.current = true;
    const serial = ++requestSerial.current;
    setLoading(true); setError(''); setRetryPage(target ?? null);
    try {
      const value = await invoke<Result>('get_execution_result', { executionId, ...(target ? { page: target } : {}) });
      if (serial !== requestSerial.current) return;
      setResult(value); setPage(target ?? savedResultPage(value.execution.parameters)); setLoaded(true); setRetryPage(null);
    } catch (failure) {
      if (serial === requestSerial.current) setError(message(failure));
    } finally {
      if (serial === requestSerial.current) { pending.current = false; setLoading(false); }
    }
  }
  const execution = result?.execution ?? historyExecution;
  const description = execution && describeNotebookExecution(execution);
  const shownPage = page ?? savedResultPage(execution?.parameters ?? '{}');
  const previous = result && previousResultPage(shownPage);
  const next = result && nextResultPage(shownPage, result.has_more);
  const pageSizes = [25, 50, 100, 200].includes(shownPage.limit) ? [25, 50, 100, 200] : [shownPage.limit, 25, 50, 100, 200].sort((a, b) => a - b);
  return <div className="notebook-output">
    <div className="notebook-result-meta"><div className="notebook-result-identity"><strong>{description?.operation ?? 'Saved execution'}</strong><span>{execution ? `Registered source: ${registeredSourceName(execution, sources)}` : 'Source unavailable'}</span></div>{description && <span className="notebook-result-summary">{description.summary}</span>}<small>{execution?.result_row_count ?? 'Ã¢â‚¬â€'} recorded rows{execution && <> Ã‚Â· {new Date(execution.started_at).toLocaleString()}</>}</small></div>
    {!loaded && !loading && !error && <div className="notebook-unavailable"><p>Load replays the saved operation against its pinned representation.</p><Button variant="secondary" size="small" onClick={() => void loadPage()}>Load result</Button></div>}
    {loading && <p className="notebook-muted" role="status">{result ? 'Loading another pageÃ¢â‚¬Â¦ Previous page remains visible.' : 'Replaying saved executionÃ¢â‚¬Â¦'}</p>}
    {result && <>
      <div className="table-scroll"><Table><TableHeader><TableRow>{result.columns.map((column, i) => <TableHead key={i} className={numericColumnType.test(column.data_type) ? 'notebook-number' : undefined} title={column.name}><span>{column.name}</span><small>{column.data_type}</small></TableHead>)}</TableRow></TableHeader><TableBody>{result.rows.map((row, i) => <TableRow key={i}>{row.map((value, j) => <TableCell key={j} className={numericColumnType.test(result.columns[j]?.data_type ?? '') ? 'notebook-number' : undefined} title={value ?? undefined}>{value ?? <span className="null-value">null</span>}</TableCell>)}</TableRow>)}</TableBody></Table>{!result.rows.length && <TableEmpty>{shownPage.offset ? 'No rows at this offset.' : 'No rows matched this operation.'}</TableEmpty>}</div>
      <div className="notebook-result-page"><span role="status">{resultRowRange(shownPage, result.rows.length, result.has_more)}</span><div className="notebook-result-page-actions"><label>Page size <Select value={shownPage.limit} disabled={loading} onChange={event => void loadPage({ offset: 0, limit: Number(event.target.value) })}>{pageSizes.map(size => <option key={size} value={size}>{size}</option>)}</Select></label><Button variant="secondary" size="small" disabled={loading || !previous} onClick={() => previous && void loadPage(previous)}>Previous</Button><Button variant="secondary" size="small" disabled={loading || !next} onClick={() => next && void loadPage(next)}>Next</Button></div></div>
      <p className="notebook-muted">{result === initialResult ? 'From the latest execution. Reopening this notebook loads the result by replay.' : 'Replayed from the pinned representation, not a saved snapshot.'} Without a saved sort, row order may vary between pages.</p>
    </>}
    {error && <div className="notebook-unavailable"><p role="alert">{result ? 'Could not load the requested page. The previous page remains visible.' : 'Result unavailable.'} {error}</p><Button variant="secondary" size="small" onClick={() => void loadPage(retryPage ?? undefined)}>Retry result</Button></div>}
    <details><summary>Execution details</summary><small>Execution ID: {executionId}{execution && <><br/>Dataset ID: {execution.dataset_id}<br/>Source fingerprint: {execution.source_fingerprint}<br/>Recorded status: {execution.status}<br/>Engine: {execution.duckdb_version ? `DuckDB ${execution.duckdb_version}` : 'Unavailable'}</>}</small>{execution && <><div>Original parameters</div><pre>{execution.parameters}</pre></>}</details>
  </div>;
}

export default function NotebookWorkspace({ active, onDirtyChange, onResultsChange, onNotebookChange, projectId, projectName, sources }: { active: boolean; onDirtyChange: (dirty: boolean) => void; onResultsChange: () => void; onNotebookChange: (id: string | null) => void; projectId: string; projectName?: string; sources: Source[] }) {
  const pythonPreferenceKey = `dataforge.notebook.python:${projectId}`;
  const [notebooks, setNotebooks] = useState<Summary[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'retrying' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  useEffect(() => { onNotebookChange(notebook?.id ?? null); }, [notebook?.id, onNotebookChange]);
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
  const [analysisSourceId, setAnalysisSourceId] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [configuration, setConfiguration] = useState<Configuration>(defaultConfiguration);
  const [targetResultId, setTargetResultId] = useState<string | null>(null);
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const pendingAnalysis = useRef<string | null>(null);
  const [analysisCanCancel, setAnalysisCanCancel] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [analysisResult, setAnalysisResult] = useState<Result | null>(null);
  const [sqlExecutions, setSqlExecutions] = useState<Execution[]>([]);
  const [sqlResults, setSqlResults] = useState<Record<string, Result>>({});
  const [sqlResultNames, setSqlResultNames] = useState<Record<string, string>>({});
  const [sqlErrors, setSqlErrors] = useState<Record<string, string>>({});
  const [sqlRunId, setSqlRunId] = useState<string | null>(null);
  const [sqlRunningBlock, setSqlRunningBlock] = useState<string | null>(null);
  const [sqlCanCancel, setSqlCanCancel] = useState(false);
  const pendingSql = useRef<string | null>(null);
  const [pythonEnvironments, setPythonEnvironments] = useState<PythonEnvironment[]>([]);
  const [pythonPath, setPythonPath] = useState('');
  const readyPythonPath = pythonEnvironments.some(environment => environment.path === pythonPath) ? pythonPath : '';
  const [pythonSqlInputs, setPythonSqlInputs] = useState<Record<string, string>>({});
  const [pythonResults, setPythonResults] = useState<Record<string, PythonResult>>({});
  const [pythonErrors, setPythonErrors] = useState<Record<string, string>>({});
  const [pythonRunningBlock, setPythonRunningBlock] = useState<string | null>(null);
  const [pythonRuntime, setPythonRuntime] = useState<PythonRuntime>({ status: 'stopped', python: null, environment: null });
  const [cellRuns, setCellRuns] = useState<Record<string, CodeRunStatus>>({});
  const [outputUsage, setOutputUsage] = useState<OutputUsage | null>(null);
  const [pendingOutputAction, setPendingOutputAction] = useState<'clear-all' | 'cleanup' | null>(null);
  const [runAllProgress, setRunAllProgress] = useState<{ current: number; total: number } | null>(null);
  const executionLock = useRef(false);
  const stopRunAllRequested = useRef(false);
  const pendingPython = useRef(false);
  const pythonInvokeStarted = useRef(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingNotebook, setSavingNotebook] = useState(false);
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'notebook' | 'cell'; id: string; title?: string } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRequest = useRef(0);
  const listPending = useRef(false);
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cursor = useRef<Record<string, [number, number]>>({});
  const failedAutoSave = useRef(false);
  const dirty = Object.keys(drafts).length > 0 || Object.keys(languages).length > 0 || (!!notebook && title !== notebook.title) || (!!renamingId && renameTitle !== notebooks.find(item => item.id === renamingId)?.title);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!active) void invoke('close_notebook_python').catch(() => {}); }, [active]);
  useEffect(() => {
    if (!active || !notebook) { setPythonRuntime({ status: 'stopped', python: null, environment: null }); return; }
    let current = true;
    const poll = () => void invoke<PythonRuntime>('notebook_python_status', { notebookId: notebook.id })
      .then(status => { if (current) setPythonRuntime(status); }).catch(() => { if (current) setPythonRuntime({ status: 'unavailable', python: null, environment: null }); });
    poll(); const timer = window.setInterval(poll, 1000);
    return () => { current = false; window.clearInterval(timer); };
  }, [active, notebook?.id]);
  useEffect(() => { if (active && notebook) void refreshOutputUsage(); else setOutputUsage(null); }, [active, notebook?.id]);
  async function refreshOutputUsage() {
    try { setOutputUsage(await invoke<OutputUsage>('notebook_output_usage')); }
    catch (failure) { setOutputUsage(null); setError(message(failure)); }
  }
  useEffect(() => { if (active && editingId) { editorRef.current?.focus(); const [start, end] = cursor.current[editingId] ?? [0, 0]; editorRef.current?.setSelectionRange(start, end); } }, [active, editingId]);
  useEffect(() => { if (renamingId) requestAnimationFrame(() => renameInputRef.current?.focus()); }, [renamingId]);
  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); }, []);
  async function refresh() {
    const request = ++listRequest.current;
    listPending.current = false;
    const notes = await invoke<Summary[]>('list_notebooks');
    if (request === listRequest.current) { setNotebooks(notes); setListStatus('ready'); setListError(''); }
  }
  async function loadList(mode: 'initial' | 'retry' | 'refresh') {
    if (listPending.current) return;
    listPending.current = true;
    const request = ++listRequest.current;
    if (mode !== 'refresh') setListStatus(mode === 'retry' ? 'retrying' : 'loading');
    try {
      const notes = await invoke<Summary[]>('list_notebooks');
      if (request !== listRequest.current) return;
      setNotebooks(notes); setListStatus('ready'); setListError('');
    } catch (e) {
      if (request !== listRequest.current) return;
      if (mode === 'refresh') setError(message(e));
      else { setListError(message(e)); setListStatus('error'); }
    } finally { if (request === listRequest.current) listPending.current = false; }
  }
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
    void loadList(listStatus === 'ready' ? 'refresh' : listStatus === 'error' ? 'retry' : 'initial');
    invoke<Execution[]>('list_executions').then(runs => { if (current) { setExecutions(runs.filter(run => run.status === 'succeeded' && run.operation_type !== 'sql' && run.operation_type !== 'python')); setSqlExecutions(runs.filter(run => run.operation_type === 'sql')); } }).catch(e => { if (current) setError(message(e)); });
    void (async () => {
      const remembered = localStorage.getItem(pythonPreferenceKey);
      let saved: PythonEnvironment | null = null;
      if (remembered) {
        try { saved = await invoke<PythonEnvironment>('inspect_python_environment', { path: remembered }); }
        catch { /* Keep the project choice so it can be restored if the environment returns. */ }
      }
      const items = await invoke<PythonEnvironment[]>('python_environments').catch(() => []);
      if (!current) return;
      setPythonEnvironments(saved && !items.some(item => item.path === saved.path) ? [saved, ...items] : items);
      const resolved = saved?.path ?? remembered ?? items[0]?.path ?? '';
      setPythonPath(existing => existing || resolved);
      if (resolved && !localStorage.getItem(pythonPreferenceKey)) localStorage.setItem(pythonPreferenceKey, resolved);
    })();
    return () => { current = false; listRequest.current++; listPending.current = false; };
  }, [active, pythonPreferenceKey]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!analysisRunId) return;
    let current = true;
    async function poll() {
      try {
        const id = await invoke<string | null>('active_execution');
        if (current) setAnalysisCanCancel(id === analysisRunId);
      } catch { /* The run reports its own error. */ }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 250);
    return () => { current = false; window.clearInterval(timer); };
  }, [analysisRunId]);
  useEffect(() => {
    if (!sqlRunId) return;
    let current = true;
    async function poll() { try { const id = await invoke<string | null>('active_execution'); if (current) setSqlCanCancel(id === sqlRunId); } catch { /* Run reports errors. */ } }
    void poll(); const timer = window.setInterval(() => void poll(), 250);
    return () => { current = false; window.clearInterval(timer); };
  }, [sqlRunId]);
  useEffect(() => {
    if (!analysisSourceId || !sources.some(source => source.id === analysisSourceId && source.status === 'ready')) {
      setColumns([]); setSchemaError(''); setSchemaLoading(false); return;
    }
    let current = true;
    setColumns([]); setSchemaError(''); setSchemaLoading(true);
    invoke<{ columns: Column[] }>('inspect_csv', { datasetId: analysisSourceId, limit: 1 })
      .then(value => { if (current) setColumns(value.columns); })
      .catch(error => { if (current) setSchemaError(message(error)); })
      .finally(() => { if (current) setSchemaLoading(false); });
    return () => { current = false; };
  }, [analysisSourceId, sources]);

  function editResult(block: Block, execution: Execution) {
    const saved = configurationFromExecution(execution.parameters);
    if (!saved) { setAnalysisError('This saved configuration cannot be edited here. Its result remains available.'); return; }
    setTargetResultId(block.id);
    setAnalysisSourceId(execution.dataset_id);
    setConfiguration(saved);
    setAnalysisError(''); setAnalysisNotice('Editing this result cell. Run to replace its execution reference.');
    requestAnimationFrame(() => document.getElementById('notebook-analysis')?.scrollIntoView({ block: 'nearest' }));
  }

  async function runAnalysis() {
    if (executionLock.current || pendingAnalysis.current || busy) return;
    let request: ReturnType<typeof buildNotebookRequest>;
    try { request = buildNotebookRequest(configuration, columns); }
    catch (error) { setAnalysisError(message(error)); return; }
    const id = crypto.randomUUID();
    executionLock.current = true;
    pendingAnalysis.current = id;
    setAnalysisRunId(id);
    setAnalysisCanCancel(false);
    setAnalysisNotice('');
    setAnalysisError('');
    setExecutionId('');
    try {
      const result = await invoke<Result>('run_analytics', {
        datasetId: analysisSourceId,
        executionId: id,
        request,
      });
      setAnalysisResult(result);
      setExecutions(current => [result.execution, ...current.filter(item => item.id !== result.execution.id)]);
      setExecutionId(result.execution.id);
      if (targetResultId) {
        await invoke('update_result_block', { id: targetResultId, executionId: result.execution.id });
        await reload(); setSelectedId(targetResultId);
        setAnalysisNotice('Result cell updated. Earlier execution remains in project history.');
      } else if (notebook) {
        const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind: 'result', content: '', executionId: result.execution.id });
        await reload(); setSelectedId(block.id); setTargetResultId(block.id);
        setAnalysisNotice('Result added. Edit the parameters and run again to update this cell.');
      }
    } catch (error) {
      if (hasErrorCode(error, 'cancelled')) setAnalysisNotice('Operation cancelled.');
      else {
        setAnalysisNotice('');
        setAnalysisError(message(error));
      }
    } finally {
      executionLock.current = false;
      pendingAnalysis.current = null;
      setAnalysisRunId(null);
      setAnalysisCanCancel(false);
    }
  }

  async function cancelAnalysis() {
    if (!analysisRunId || pendingAnalysis.current !== analysisRunId || !analysisCanCancel) return;
    setAnalysisNotice('Cancellation requested.');
    try { await invoke('cancel_execution', { executionId: analysisRunId }); }
    catch (error) {
      if (pendingAnalysis.current !== analysisRunId || hasErrorCode(error, 'execution_missing')) return;
      setAnalysisNotice('');
      setAnalysisError(message(error));
    }
  }
  async function runSql(block: Block): Promise<'completed' | 'failed' | 'cancelled'> {
    if (pendingSql.current || !notebook) return 'failed';
    const sql = drafts[block.id] ?? block.content;
    const id = crypto.randomUUID();
    pendingSql.current = id; setSqlRunId(id); setSqlRunningBlock(block.id); setSqlCanCancel(false);
    setSqlErrors(current => ({ ...current, [block.id]: '' }));
    setSqlResults(current => { const next = { ...current }; delete next[block.id]; return next; });
    try {
      await saveCell(block.id);
      if (stopRunAllRequested.current) return 'cancelled';
      const result = await invoke<Result>('run_notebook_sql', { datasetId: '', blockId: block.id, sql, executionId: id, resultName: sqlResultNames[block.id]?.trim() || null });
      setSqlResults(current => ({ ...current, [block.id]: result }));
      try { setSqlResultNames(current => ({ ...current, [block.id]: JSON.parse(result.execution.parameters).result_name ?? '' })); } catch { /* Execution still succeeded. */ }
      setSqlExecutions(current => [result.execution, ...current.filter(item => item.id !== id)]);
      onResultsChange();
      return 'completed';
    } catch (failure) {
      setSqlErrors(current => ({ ...current, [block.id]: hasErrorCode(failure, 'cancelled') ? 'Query cancelled.' : message(failure) }));
      try { setSqlExecutions((await invoke<Execution[]>('list_executions')).filter(item => item.operation_type === 'sql')); } catch { /* Original error remains visible. */ }
      return hasErrorCode(failure, 'cancelled') ? 'cancelled' : 'failed';
    } finally {
      pendingSql.current = null; setSqlRunId(null); setSqlRunningBlock(null); setSqlCanCancel(false);
    }
  }
  async function cancelSql() {
    if (!sqlRunId) return;
    setSqlCanCancel(false);
    try { await invoke('cancel_execution', { executionId: sqlRunId }); }
    catch (failure) { if (!hasErrorCode(failure, 'execution_missing') && sqlRunningBlock) setSqlErrors(current => ({ ...current, [sqlRunningBlock]: message(failure) })); }
  }
  async function browsePython() {
    try { const path = await open({ multiple: false, title: 'Choose an existing Python executable' });
      if (typeof path !== 'string') return;
      const environment = await invoke<PythonEnvironment>('inspect_python_environment', { path });
      setPythonEnvironments(current => current.some(item => item.path === environment.path) ? current : [...current, environment]);
      setPythonPath(environment.path);
      localStorage.setItem(pythonPreferenceKey, environment.path);
    } catch (failure) { setError(message(failure)); }
  }
  async function runPython(block: Block): Promise<'completed' | 'failed' | 'cancelled'> {
    if (!notebook || pendingPython.current) return 'failed';
    if (!readyPythonPath) { setPythonErrors(current => ({ ...current, [block.id]: pythonPath ? 'The saved Python executable is unavailable or lacks ipykernel and jupyter_client. Change it in Notebook options.' : 'No compatible Python was found automatically. Open Notebook options, then Python environment, then Choose executable, or install ipykernel and jupyter_client in a Python on PATH.' })); return 'failed'; }
    const code = drafts[block.id] ?? block.content; const id = crypto.randomUUID();
    pendingPython.current = true; setPythonRunningBlock(block.id);
    setPythonErrors(current => ({ ...current, [block.id]: '' }));
    try { await saveCell(block.id);
      if (stopRunAllRequested.current) return 'cancelled';
      pythonInvokeStarted.current = true;
      const result = await invoke<PythonResult>('run_notebook_python', { notebookId: notebook.id, blockId: block.id, code, python: readyPythonPath, executionId: id,
        datasetId: null, sqlExecutionId: pythonSqlInputs[block.id] || null });
      setPythonResults(current => ({ ...current, [block.id]: { ...result, recorded_code: code } }));
      if (result.status === 'succeeded') onResultsChange();
      return result.status === 'succeeded' ? 'completed' : result.status === 'interrupted' ? 'cancelled' : 'failed';
    } catch (failure) { setPythonErrors(current => ({ ...current, [block.id]: message(failure) })); return 'failed'; }
    finally { pythonInvokeStarted.current = false; pendingPython.current = false; setPythonRunningBlock(null); }
  }
  async function interruptPython() { if (!notebook) return; try { await invoke('interrupt_notebook_python', { notebookId: notebook.id }); } catch (failure) { setError(message(failure)); } }
  async function restartPython() { if (!notebook) return; try { await invoke('restart_notebook_python', { notebookId: notebook.id }); setPythonResults(current => Object.fromEntries(Object.entries(current).map(([id, result]) => [id, { ...result, restored: true }]))); setPythonErrors({}); } catch (failure) { setError(message(failure)); } }
  function updateCellRun(id: string, status: CodeRunStatus | null) {
    setCellRuns(current => { const next = { ...current }; if (status) next[id] = status; else delete next[id]; return next; });
  }
  async function executeCells(cells: Block[], all = false) {
    if (!cells.length || executionLock.current || busy) return;
    executionLock.current = true;
    stopRunAllRequested.current = false;
    setBusy(true);
    setError('');
    if (all) setRunAllProgress({ current: 0, total: cells.length });
    let current = 0;
    try {
      await runCodeSequence(cells, async cell => {
        current++;
        if (all) setRunAllProgress({ current, total: cells.length });
        return (languages[cell.id] ?? cell.language) === 'sql' ? runSql(cell) : runPython(cell);
      }, () => stopRunAllRequested.current, updateCellRun);
    } finally {
      executionLock.current = false;
      stopRunAllRequested.current = false;
      setBusy(false);
      setRunAllProgress(null);
      void refreshOutputUsage();
    }
  }
  async function clearOutputs(blockId?: string) {
    if (!notebook || executionLock.current) return;
    await invoke('clear_notebook_code_outputs', { id: notebook.id, blockId: blockId ?? null });
    const keep = <T,>(current: Record<string, T>) => blockId ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== blockId)) : {};
    setSqlResults(keep); setSqlErrors(keep); setPythonResults(keep); setPythonErrors(keep); setCellRuns(keep);
    await refreshOutputUsage();
  }
  async function cleanupOutputs() {
    if (executionLock.current) return;
    await invoke('cleanup_notebook_outputs');
    await refreshOutputUsage();
  }
  async function stopExecution() {
    stopRunAllRequested.current = true;
    if (pendingSql.current) await cancelSql();
    else if (pythonInvokeStarted.current) await interruptPython();
  }
  async function load(id: string) {
    if (notebook?.id !== id) await invoke('close_notebook_python');
    const [next, saved, runs] = await Promise.all([
      invoke<Notebook>('get_notebook', { id }),
      invoke<SavedCodeOutput[]>('get_notebook_code_outputs', { id }).catch(failure => { setError(`Saved Code output could not be loaded: ${message(failure)}`); return []; }),
      invoke<Execution[]>('list_executions'),
    ]);
    const sql: Record<string, Result> = {}, sqlErrors: Record<string, string> = {}, python: Record<string, PythonResult> = {};
    const pythonSqlIds: Record<string, string> = {}, restoredNames: Record<string, string> = {};
    for (const item of saved) {
      const block = next.blocks.find(cell => cell.id === item.block_id && cell.language === item.kind);
      if (!block) continue;
      if (item.kind === 'python') {
        const value = item.value as PythonResult;
        if (Array.isArray(value.outputs)) python[item.block_id] = { ...value, restored: true, recorded_code: item.code };
        const run = runs.find(entry => entry.id === item.execution_id);
        if (run) { try { for (const input of JSON.parse(run.parameters).inputs ?? []) {
          if (input.kind === 'sql_result') pythonSqlIds[item.block_id] = input.id;
        } } catch { /* Saved output remains readable. */ } }
      } else {
        const execution = runs.find(run => run.id === item.execution_id);
        if (!execution) continue;
        try { restoredNames[item.block_id] = JSON.parse(execution.parameters).result_name ?? ''; } catch { /* Saved output remains readable. */ }
        const value = item.value as Partial<Result> & { error?: string };
        if (value.error) sqlErrors[item.block_id] = value.error;
        else if (Array.isArray(value.columns) && Array.isArray(value.rows)) sql[item.block_id] = { execution, columns: value.columns, rows: value.rows, total_rows: value.total_rows ?? null, has_more: !!value.has_more, restored: true };
      }
    }
    setSqlResultNames(restoredNames);
    setNotebook(next); setTitle(next.title); setSelectedId(next.blocks[0]?.id ?? null); setEditingId(null);
    setTargetResultId(null); setAnalysisResult(null); setAnalysisSourceId(''); setConfiguration(defaultConfiguration());
    setAnalysisNotice(''); setAnalysisError(''); setSqlExecutions(runs.filter(run => run.operation_type === 'sql'));
    setSqlResults(sql); setSqlErrors(sqlErrors); setPythonResults(python); setPythonErrors({});
    setPythonSqlInputs(pythonSqlIds);
    setCellRuns({});
    if (next.blocks[0]) focusCell(next.blocks[0].id);
  }
  async function reload(id = notebook?.id) { if (id) { setNotebook(await invoke<Notebook>('get_notebook', { id })); await refresh(); } }
  function select(id: string) { setSelectedId(id); if (editingId && editingId !== id) setEditingId(null); clearDelete(); }
  function focusCell(id: string) {
    requestAnimationFrame(() => {
      const cell = cellRefs.current[id];
      if (cell && !cell.contains(editorRef.current)) cell.focus();
    });
  }
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
    setSavingNotebook(true);
    try {
      for (const block of notebook.blocks) await saveCell(block.id);
      if (title !== notebook.title) {
        const next = await invoke<Notebook>('rename_notebook', { id: notebook.id, title });
        setNotebook(next);
        setTitle(current => current === title ? next.title : current);
        await refresh();
      }
    } finally {
      setSavingNotebook(false);
    }
  }
  useEffect(() => { failedAutoSave.current = false; }, [notebook?.id, title, drafts, languages]);
  useEffect(() => {
    if (!notebook || !dirty || busy || failedAutoSave.current) return;
    const timer = setTimeout(() => { void action(async () => { try { await saveNotebook(); } catch (e) { failedAutoSave.current = true; throw e; } }); }, 1200);
    return () => clearTimeout(timer);
  }, [notebook?.id, dirty, title, drafts, languages, busy]);
  async function insert(kind: 'markdown' | 'code', relativeTo?: string, placement?: 'before' | 'after') {
    if (!notebook) return;
    const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind, content: '', language: kind === 'code' ? 'python' : null, executionId: null, relativeTo, placement });
    await reload(); setSelectedId(block.id); setEditingId(block.id);
  }
  async function remove(id: string) {
    const index = notebook?.blocks.findIndex(block => block.id === id) ?? -1;
    const nextId = notebook?.blocks[index + 1]?.id ?? notebook?.blocks[index - 1]?.id ?? null;
    await invoke('delete_block', { id });
    if (targetResultId === id) setTargetResultId(null);
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
    if (!active || !notebook || busy || executionLock.current) return;
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
      if (selected?.kind === 'code') {
        void executeCells([selected]).then(() => { setEditingId(null); const next = notebook.blocks[index + 1]?.id; if (next) { setSelectedId(next); focusCell(next); } else focusCell(selected.id); });
        return;
      }
      void action(async () => { if (editingId) cursor.current[editingId] = [editorRef.current?.selectionStart ?? 0, editorRef.current?.selectionEnd ?? 0]; if (selectedId) await saveCell(selectedId); setEditingId(null); const next = notebook.blocks[index + 1]?.id; if (next) { setSelectedId(next); focusCell(next); } else if (selectedId) focusCell(selectedId); }); return;
    }
    if (!selected) return;
    if (command === 'edit') { if (selected.kind !== 'result') setEditingId(selected.id); return; }
    if (command === 'prev' || command === 'next') { const next = notebook.blocks[index + (command === 'prev' ? -1 : 1)]; if (next) { select(next.id); focusCell(next.id); } return; }
    if (command === 'above' || command === 'below') { void action(() => insert('markdown', selected.id, command === 'above' ? 'before' : 'after')); return; }
    if (command === 'delete') armDelete(selected.id, event.repeat);
  }
  function onCellClick(event: MouseEvent<HTMLElement>, id: string) {
    select(id);
    const target = event.target as HTMLElement;
    if (target.closest('button,input,select,textarea,summary,a')) return;
    if (target.closest('.notebook-code-preview')) {
      setEditingId(id);
      return;
    }
    setEditingId(null);
    focusCell(id);
  }
  const succeeded = executions.find(item => item.id === executionId);
  const visibleNotebooks = sortNotebooks(filterNotebooks(notebooks, search), sort);
  const saveStatus = savingNotebook ? 'SavingÃ¢â‚¬Â¦' : dirty ? 'Unsaved changes' : 'Saved';
  return <div className={`notebook-workspace ${notebook ? 'notebook-editor' : 'notebook-home'}`} onKeyDown={onKeyDown}>
    {error && notebook && <div className="inline-error" role="alert">{error}</div>}
    {!notebook ? <>
      <div className="notebook-heading"><span className="eyebrow">{projectName ?? 'Current project'}</span><div className="notebook-heading-title"><h1>Notebooks</h1><Button variant="primary" size="small" disabled={busy || listStatus !== 'ready'} onClick={() => void action(async () => { await saveHomeRename(); const next = await invoke<Notebook>('create_notebook', { title: 'Untitled Notebook' }); setNotebook(next); setTitle(next.title); setSelectedId(null); setEditingId(null); setTargetResultId(null); setAnalysisSourceId(''); setAnalysisResult(null); setConfiguration(defaultConfiguration()); await refresh(); })}><Plus size={16}/> New Notebook</Button></div><p>Keep notes, code, and saved analytical results together.</p></div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="notebook-home-controls"><label className="notebook-search"><Search size={16}/><span className="sr-only">Search notebooks</span><Input disabled={listStatus !== 'ready'} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notebooks" /></label><label className="notebook-sort"><span className="sr-only">Sort notebooks</span><Select disabled={listStatus !== 'ready'} value={sort} onChange={event => setSort(event.target.value as 'modified' | 'name')}><option value="modified">Last modified</option><option value="name">Name</option></Select></label></div>
      <div className="notebook-home-list">{listStatus === 'loading' ? <div className="notebook-home-loading" role="status">Loading notebooksÃ¢â‚¬Â¦</div>
        : listStatus === 'error' || listStatus === 'retrying' ? <div className="notebook-home-empty" role={listStatus === 'error' ? 'alert' : 'status'}><h2>Could not load notebooks</h2><p>{listError || 'Try again.'}</p><Button loading={listStatus === 'retrying'} onClick={() => void loadList('retry')}>{listStatus === 'retrying' ? 'RetryingÃ¢â‚¬Â¦' : 'Retry'}</Button></div>
          : <>{visibleNotebooks.length > 0 && <div className="notebook-home-columns"><span>Name</span><span className="notebook-home-date-heading">Modified</span><span className="notebook-home-count-heading">Cells</span><span className="sr-only">Actions</span></div>}{visibleNotebooks.map(item => <div className="notebook-home-row" key={item.id}>
        {renamingId === item.id ? <form onSubmit={event => { event.preventDefault(); void action(saveHomeRename); }}><Input ref={renameInputRef} aria-label="Notebook title" maxLength={120} autoFocus value={renameTitle} onChange={event => setRenameTitle(event.target.value)}/><Button size="small" disabled={busy}>Save</Button><Button variant="ghost" size="small" type="button" disabled={busy} onClick={() => setRenamingId(null)}>Cancel</Button></form>
          : <><button className="notebook-home-open" title={item.title} disabled={busy} onClick={() => void action(async () => { await saveHomeRename(); await load(item.id); })}><BookOpen size={16}/><strong>{item.title}</strong></button><span className="notebook-home-meta"><span className="notebook-home-date">{new Date(item.updated_at).toLocaleString()}</span><span className="notebook-home-count"><span className="sr-only">Cells: </span>{item.block_count}<span className="notebook-home-count-unit" aria-hidden="true"> cells</span></span></span></>}
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="icon" aria-label={`Actions for ${item.title}`} title="Notebook actions" disabled={busy} />}><Ellipsis size={16}/></DropdownMenuTrigger><DropdownMenuContent>
          <DropdownMenuItem disabled={busy || renamingId === item.id} onClick={() => void action(async () => { await saveHomeRename(); setRenamingId(item.id); setRenameTitle(item.title); })}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive disabled={busy} onClick={() => setPendingDelete({ kind: 'notebook', id: item.id, title: item.title })}>Delete</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>)}{!visibleNotebooks.length && <div className="notebook-home-empty"><BookOpen size={28}/><h2>{notebooks.length ? 'No matching notebooks' : 'Your notebooks start here'}</h2><p>{notebooks.length ? 'Try a different search.' : 'Write text and code, then add saved analytical results as your investigation grows.'}</p></div>}</>}</div>
    </> : <>
      <header className="notebook-editor-toolbar" aria-label="Notebook controls">
        <div className="notebook-toolbar-inner">
          <div className="notebook-toolbar-identity">
            <Button className="notebook-breadcrumb" variant="ghost" size="small" disabled={busy || !!analysisRunId} onClick={() => void action(async () => {
              await saveNotebook();
              setAnalysisResult(null);
              setAnalysisNotice('');
              setAnalysisError('');
              setTargetResultId(null);
              await invoke('close_notebook_python');
              setNotebook(null);
              setSelectedId(null);
              setEditingId(null);
              await refresh();
            })}>Notebooks</Button>
            <span className="notebook-path-divider" aria-hidden="true">/</span>
            <div className="notebook-title">
              <label htmlFor="notebook-title" className="sr-only">Notebook title</label>
              <Input id="notebook-title" maxLength={120} disabled={busy} value={title} onChange={event => setTitle(event.target.value)}/>
            </div>
          </div>
          <div className="notebook-toolbar-actions" aria-label="Execution controls">
            <Button variant="secondary" size="small" disabled={busy || !!analysisRunId || notebook.blocks.find(cell => cell.id === selectedId)?.kind !== 'code'} onClick={() => { const cell = notebook.blocks.find(item => item.id === selectedId); if (cell) void executeCells([cell]); }}>Run Cell</Button>
            <Button variant="secondary" size="small" disabled={busy || !!analysisRunId || !notebook.blocks.some(cell => cell.kind === 'code')} onClick={() => void executeCells(notebook.blocks.filter(cell => cell.kind === 'code'), true)}>Run All</Button>
            {runAllProgress && <><span className="notebook-save-status" role="status">Running {runAllProgress.current} of {runAllProgress.total}</span><Button variant="ghost" size="small" aria-label="Stop Run All" onClick={() => void stopExecution()}>Stop</Button></>}
            <span className="notebook-save-status" role="status" title={(pythonRuntime.environment ?? pythonPath) || undefined}>Kernel: {pythonRuntime.status}{pythonRuntime.python ? ` · ${pythonRuntime.python}` : ''}{pythonRuntime.environment && pythonPath && pythonRuntime.environment !== pythonPath ? ' · other environment active' : ''}</span>
            <Button variant="ghost" size="small" aria-label="Restart Python kernel" disabled={pythonRuntime.status !== 'idle' || busy || !!analysisRunId} onClick={() => void restartPython()}>Restart</Button>
            <span className="notebook-save-status" role="status">{saveStatus}</span>
            <Button variant="ghost" size="small" disabled={busy || !dirty} onClick={() => void action(saveNotebook)}>Save</Button>
            <DropdownMenu>
              <DropdownMenuTrigger disabled={busy} render={<Button variant="secondary" size="small" />}>
                <Plus aria-hidden="true"/> Add cell
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code'))}>Add Code cell</DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown'))}>Add Text cell</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger render={<Button variant="icon" aria-label="More notebook options" title="More notebook options" />}>
                <Ellipsis aria-hidden="true"/>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverTitle className="sr-only">Notebook shortcuts and information</PopoverTitle>
                <div className="notebook-shortcuts">
                  <section><h3>Command mode</h3><dl><div><dt>Ã¢â€ â€˜ / Ã¢â€ â€œ</dt><dd>Select cell</dd></div><div><dt>Enter</dt><dd>Edit Code or Text</dd></div><div><dt>A / B</dt><dd>Insert Text above / below</dd></div><div><dt>D, D</dt><dd>Delete selected cell</dd></div></dl></section>
                  <section><h3>Editing</h3><dl><div><dt>Esc</dt><dd>Return to command mode</dd></div><div><dt>Tab</dt><dd>Indent Code</dd></div></dl></section>
                  <section><h3>Saving</h3><dl><div><dt>Ctrl+Enter</dt><dd>Save cell</dd></div><div><dt>Shift+Enter</dt><dd>Run Code or save Text, select next</dd></div><div><dt>Ctrl+S</dt><dd>Save notebook</dd></div></dl></section>
                  <p>SQL and trusted Python Code cells run locally. Python needs an existing ipykernel environment.</p>
                  <section><h3>Saved output storage</h3><p>{outputUsage ? `${(outputUsage.total_bytes / 1024).toFixed(1)} KiB saved · ${(outputUsage.reclaimable_bytes / 1024).toFixed(1)} KiB reclaimable` : 'Loading usage…'}</p><p>Clearing output keeps execution history. Cleanup permanently removes unused snapshots and images.</p><div><Button variant="ghost" size="small" disabled={busy || !!analysisRunId || !notebook.blocks.some(cell => cell.kind === 'code')} onClick={() => setPendingOutputAction('clear-all')}>Clear All Outputs</Button><Button variant="ghost" size="small" disabled={busy || !!analysisRunId || !outputUsage?.reclaimable_blobs} onClick={() => setPendingOutputAction('cleanup')}>Clean up storage</Button></div></section>
                  <section><h3>Python environment</h3><p>Compatible Python is selected automatically. Override it with an existing ipykernel environment.</p><Select aria-label="Python environment override" value={pythonPath} disabled={busy || !!analysisRunId} onChange={event => { setPythonPath(event.target.value); if (event.target.value) localStorage.setItem(pythonPreferenceKey, event.target.value); else localStorage.removeItem(pythonPreferenceKey); }}><option value="">No compatible Python</option>{pythonPath && !readyPythonPath && <option value={pythonPath}>Unavailable: {pythonPath}</option>}{pythonEnvironments.map(env => <option key={env.path} value={env.path}>{env.version} · {env.path}</option>)}</Select><Button variant="ghost" size="small" disabled={busy || !!analysisRunId} onClick={() => void browsePython()}>Choose executable</Button></section>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>
      <div className="notebook-blocks">{notebook.blocks.map((block, index) => {
        const draft = drafts[block.id] ?? block.content; const language = languages[block.id] ?? block.language;
        const changed = draft !== block.content || language !== block.language; const selected = selectedId === block.id; const editing = editingId === block.id;
        const savedStatus = language === 'python' ? pythonResults[block.id]?.status : sqlResults[block.id] || sqlErrors[block.id] ? codeExecutionForBlock(sqlExecutions, block.id)?.status : undefined;
        const runState = cellRuns[block.id] ?? (savedStatus === 'succeeded' ? 'completed' : savedStatus === 'interrupted' || savedStatus === 'cancelled' ? 'cancelled' : savedStatus ? 'failed' : undefined);
        const label = block.kind === 'markdown' ? 'Text' : block.kind === 'code' ? 'Code' : 'Result';
          const sqlPanel = <SqlCodePanel sqlText={draft} sources={sources} result={sqlResults[block.id]} execution={codeExecutionForBlock(sqlExecutions, block.id)} error={sqlErrors[block.id]} running={sqlRunningBlock === block.id} disabled={busy || !!analysisRunId} canCancel={sqlCanCancel} resultName={sqlResultNames[block.id]} onResultNameChange={name => setSqlResultNames(current => ({ ...current, [block.id]: name }))} onRun={() => void executeCells([block])} onCancel={() => void cancelSql()}/>;
          const pythonPanel = <PythonCodePanel selected={readyPythonPath} onRun={() => void executeCells([block])} onInterrupt={() => void interruptPython()} result={pythonResults[block.id]} error={pythonErrors[block.id]} running={pythonRunningBlock === block.id} disabled={busy || !!analysisRunId} code={draft} sources={sources} sqlExecutions={sqlExecutions} sqlExecutionId={pythonSqlInputs[block.id]} onSqlExecutionChange={id => setPythonSqlInputs(current => ({ ...current, [block.id]: id }))}/>;
        return <Fragment key={block.id}><InsertionSlot disabled={busy} location={`before cell ${index + 1}`} insert={kind => void action(() => insert(kind, block.id, 'before'))}/><section ref={element => { cellRefs.current[block.id] = element; }} tabIndex={selected ? 0 : -1} aria-label={`${label} cell ${index + 1}`} className={`notebook-block${block.kind === 'code' ? ' notebook-block--code' : ''}${selected ? ' selected' : ''}${editing ? ' editing' : ''}`} onClick={event => onCellClick(event, block.id)}>
          <div className={`notebook-block-toolbar${changed || deleteArmed === block.id ? ' has-state' : ''}`}>{(changed || deleteArmed === block.id) && <span className="notebook-cell-state">{changed && <em>Unsaved</em>}{deleteArmed === block.id && <em>Press D again to delete</em>}</span>}{block.kind === 'code' && <Select aria-label={`Language for code cell ${index + 1}`} value={language ?? 'python'} disabled={busy} onChange={event => { const value = event.target.value as 'python' | 'sql'; setLanguages(current => { const next = { ...current }; if (value === block.language) delete next[block.id]; else next[block.id] = value; return next; }); }}><option value="python">Python</option><option value="sql">SQL</option></Select>}
            {selected && !editing && block.kind !== 'result' && <Button variant="ghost" size="small" aria-label={`Edit ${label} cell ${index + 1}`} disabled={busy} onClick={event => { event.stopPropagation(); setEditingId(block.id); }}>Edit {label}</Button>}
            {block.kind === 'result' && block.execution_id && executions.find(item => item.id === block.execution_id) && <Button variant="ghost" size="small" disabled={busy || !!analysisRunId} onClick={event => { event.stopPropagation(); editResult(block, executions.find(item => item.id === block.execution_id)!); }}>Edit analysis</Button>}
            <DropdownMenu><DropdownMenuTrigger render={<Button variant="icon" aria-label={`Actions for cell ${index + 1}`} title="Cell actions" disabled={busy} />} onClick={() => select(block.id)}><Ellipsis aria-hidden="true"/></DropdownMenuTrigger><DropdownMenuContent>
              {block.kind !== 'result' && <><DropdownMenuItem onClick={() => { setSelectedId(block.id); editing ? commandMode() : setEditingId(block.id); }}>{editing ? 'Preview' : 'Edit'}</DropdownMenuItem><DropdownMenuSeparator /></>}
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code', block.id, 'before'))}>Insert Code above</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown', block.id, 'before'))}>Insert Text above</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('code', block.id, 'after'))}>Insert Code below</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void action(() => insert('markdown', block.id, 'after'))}>Insert Text below</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy || index === 0} onClick={() => void action(() => move(block.id, 'up'))}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={busy || index === notebook.blocks.length - 1} onClick={() => void action(() => move(block.id, 'down'))}>Move down</DropdownMenuItem>
              <DropdownMenuSeparator />
              {block.kind === 'code' && <><DropdownMenuItem disabled={busy || !!analysisRunId} onClick={() => void action(() => clearOutputs(block.id))}>Clear Output</DropdownMenuItem><DropdownMenuSeparator /></>}
              <DropdownMenuItem destructive disabled={busy} onClick={() => setPendingDelete({ kind: 'cell', id: block.id })}>Delete</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu></div>
          {block.kind === 'code' && <CodeGutter number={index + 1} state={runState} disabled={busy || !!analysisRunId} onRun={() => void executeCells([block])} onStop={() => void (language === 'sql' ? cancelSql() : interruptPython())}/>}
          {block.kind === 'result' ? block.execution_id ? <ResultBlock key={block.execution_id} executionId={block.execution_id} execution={executions.find(item => item.id === block.execution_id)} sources={sources} initialResult={analysisResult?.execution.id === block.execution_id ? analysisResult : undefined}/> : <p>Execution reference unavailable.</p>
: editing ? <div className={block.kind === 'code' ? 'notebook-code-frame' : 'notebook-text-frame'}><Textarea ref={editorRef} rows={Math.max(3, draft.split('\n').length + 1)} className={block.kind === 'code' ? 'notebook-code-editor' : ''} aria-label={`${label} cell ${index + 1} editor`} value={draft} readOnly={busy} spellCheck={block.kind === 'markdown'} onKeyDown={event => { if (block.kind !== 'code' || !['Tab', 'Enter'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey || (event.key === 'Enter' && event.shiftKey)) return; event.preventDefault(); const [value, start, end] = editCodeIndent(draft, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.key as 'Tab' | 'Enter', event.shiftKey, language === 'sql' ? 'sql' : 'python'); setDrafts(current => ({ ...current, [block.id]: value })); cursor.current[block.id] = [start, end]; requestAnimationFrame(() => editorRef.current?.setSelectionRange(start, end)); }} onSelect={event => { cursor.current[block.id] = [event.currentTarget.selectionStart, event.currentTarget.selectionEnd]; }} onChange={event => { const value = event.target.value; setDrafts(current => { const next = { ...current }; if (value === block.content) delete next[block.id]; else next[block.id] = value; return next; }); }}/>{block.kind === 'code' && <div className="notebook-code-output">{language === 'sql' ? sqlPanel : pythonPanel}</div>}</div>
              : block.kind === 'markdown' ? <div className="notebook-preview" onDoubleClick={() => setEditingId(block.id)}><Markdown text={draft}/></div>
                : <div className="notebook-code-preview"><div className="notebook-code-source"><pre>{draft || 'Press Enter to write code.'}</pre></div><div className="notebook-code-output">{language === 'sql' ? sqlPanel : pythonPanel}</div></div>}
        </section></Fragment>;
      })}<InsertionSlot disabled={busy} location={notebook.blocks.length ? `after cell ${notebook.blocks.length}` : 'in the empty notebook'} insert={kind => void action(() => insert(kind, notebook.blocks.at(-1)?.id, notebook.blocks.length ? 'after' : undefined))}/>{!notebook.blocks.length && <div className="notebook-empty-hint"><p>Add a cell to begin this notebook.</p><div><Button disabled={busy} onClick={() => void action(() => insert('code'))}>+ Code</Button><Button disabled={busy} onClick={() => void action(() => insert('markdown'))}>+ Text</Button></div></div>}</div>
      <NotebookAnalysisForm sources={sources} sourceId={analysisSourceId} onSourceChange={id => { setAnalysisSourceId(id); setConfiguration(defaultConfiguration()); setTargetResultId(null); setAnalysisError(''); }} columns={columns} schemaLoading={schemaLoading} schemaError={schemaError} config={configuration} onConfigChange={setConfiguration} targetResultId={targetResultId} onNewResult={() => { setTargetResultId(null); setAnalysisNotice("The next run will add a new result cell."); }} running={!!analysisRunId} canCancel={analysisCanCancel} notice={analysisNotice} error={analysisError} onRun={() => void runAnalysis()} onCancel={() => void cancelAnalysis()}/>
      {!!executions.length && <div className="notebook-add"><label htmlFor="execution-select">Saved execution</label><Select id="execution-select" value={executionId} onChange={e => setExecutionId(e.target.value)}><option value="">Choose an execution</option>{executions.map(item => <option key={item.id} value={item.id}>{notebookExecutionLabel(item, sources)}</option>)}</Select><Button disabled={busy || !succeeded} onClick={() => void action(async () => { const block = await invoke<Block>('add_block', { notebookId: notebook.id, kind: 'result', content: '', executionId }); await reload(); setSelectedId(block.id); focusCell(block.id); })}>Add result</Button>{succeeded && <details className="notebook-execution-choice-details"><summary>Selected execution details</summary><small>Execution ID: {succeeded.id}<br/>Dataset ID: {succeeded.dataset_id}<br/>Source fingerprint: {succeeded.source_fingerprint}<br/>Recorded status: {succeeded.status}</small><div>Original parameters</div><pre>{succeeded.parameters}</pre></details>}</div>}
    </>}
    <ConfirmationDialog open={pendingOutputAction !== null} title={pendingOutputAction === 'cleanup' ? 'Permanently clean up saved outputs?' : 'Clear all Code outputs?'} description={pendingOutputAction === 'cleanup' ? `Permanently remove ${outputUsage?.reclaimable_blobs ?? 0} unused blobs (${((outputUsage?.reclaimable_bytes ?? 0) / 1024).toFixed(1)} KiB) from this project? Execution records remain.` : 'Hide all saved Code outputs in this notebook? Execution records remain. Unused storage can be reclaimed separately.'} confirmLabel={pendingOutputAction === 'cleanup' ? 'Clean up' : 'Clear outputs'} destructive onCancel={() => setPendingOutputAction(null)} onConfirm={() => { const selected=pendingOutputAction; setPendingOutputAction(null); if (selected) void action(() => selected === 'cleanup' ? cleanupOutputs() : clearOutputs()); }}/>
    <ConfirmationDialog open={pendingDelete !== null} title={pendingDelete?.kind === 'notebook' ? 'Delete notebook?' : 'Delete cell?'} description={pendingDelete?.kind === 'notebook' ? `Delete Ã¢â‚¬Å“${pendingDelete.title}Ã¢â‚¬Â and all its cells? This cannot be undone.` : 'Delete this cell? This cannot be undone.'} confirmLabel="Delete" destructive onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete}/>
  </div>;
}
