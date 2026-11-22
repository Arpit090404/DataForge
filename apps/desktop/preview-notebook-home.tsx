import React from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FilePlus2, FileSpreadsheet, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import NotebookWorkspace from './src/Notebook';
import './src/tailwind.css';
import './src/styles.css';

let notebooks = [
  { id: 'one', title: 'Regional sales investigation', updated_at: '2026-11-18T12:30:00Z', block_count: 4 },
  { id: 'two', title: 'Revenue quality checks', updated_at: '2026-11-17T09:15:00Z', block_count: 5 },
  { id: 'three', title: 'Customer cohorts', updated_at: '2026-11-14T14:45:00Z', block_count: 3 },
];
type PreviewBlock = { id: string; notebook_id: string; position: number; kind: 'markdown' | 'code' | 'result'; content: string; language: 'python' | 'sql' | null; execution_id: string | null; created_at: string; updated_at: string };
const previewBlocks: PreviewBlock[] = [
  { id: 'text-one', notebook_id: 'one', position: 0, kind: 'markdown', content: '# Regional sales\nCompare the registered sales source across regions before interpreting any saved result.', language: null, execution_id: null, created_at: '2026-11-18T12:30:00Z', updated_at: '2026-11-18T12:30:00Z' },
  { id: 'code-one', notebook_id: 'one', position: 1, kind: 'code', content: 'SELECT region, SUM(revenue) AS revenue\nFROM sales\nGROUP BY region', language: 'sql', execution_id: null, created_at: '2026-11-18T12:30:00Z', updated_at: '2026-11-18T12:30:00Z' },
  { id: 'text-two', notebook_id: 'one', position: 2, kind: 'markdown', content: '## Revenue by region\nThe saved grouped result below is a separate analytical execution, not output from the Code cell above.', language: null, execution_id: null, created_at: '2026-11-18T12:30:00Z', updated_at: '2026-11-18T12:30:00Z' },
  { id: 'result-one', notebook_id: 'one', position: 3, kind: 'result', content: '', language: null, execution_id: 'preview-execution', created_at: '2026-11-18T12:30:00Z', updated_at: '2026-11-18T12:30:00Z' },
];
const blocksByNotebook = new Map<string, PreviewBlock[]>([['one', previewBlocks]]);
const previewExecution = { id: 'preview-execution', dataset_id: 'preview-source', operation_type: 'group', parameters: JSON.stringify({ kind: 'group', group_by: ['region', 'segment'], aggregations: [{ op: 'sum', column: 'revenue', alias: 'revenue' }, { op: 'count', alias: 'orders' }], sort: [{ column: 'revenue', direction: 'desc' }], limit: 100 }), started_at: '2026-11-18T12:30:00Z', completed_at: '2026-11-18T12:30:02Z', status: 'succeeded', result_row_count: 8523, error_summary: null, duckdb_version: 'preview', source_fingerprint: 'synthetic-preview' };
const previewRows = Array.from({ length: 15 }, (_, index) => [
  ['North', 'South', 'West', 'East'][index % 4],
  ['Consumer', 'Corporate', 'Home Office'][index % 3],
  String(184320 - index * 7631),
  String(782 - index * 29),
]);
function notebookData(id: string) {
  const note = notebooks.find(item => item.id === id);
  return note && { ...note, created_at: note.updated_at, blocks: [...(blocksByNotebook.get(id) ?? [])] };
}

(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: Record<string, string | null | undefined> = {}) => {
    if (command === 'list_notebooks') return notebooks;
    if (command === 'list_executions') return [previewExecution];
    if (command === 'get_execution_result') return { execution: previewExecution, columns: [{ name: 'region', data_type: 'text' }, { name: 'segment', data_type: 'text' }, { name: 'revenue', data_type: 'decimal' }, { name: 'orders', data_type: 'integer' }], rows: previewRows, total_rows: 8523, has_more: true };
    if (command === 'create_notebook') {
      const note = { id: String(Date.now()), title: args.title, updated_at: new Date().toISOString(), block_count: 0 };
      notebooks = [note, ...notebooks];
      blocksByNotebook.set(note.id, []);
      return notebookData(note.id);
    }
    if (command === 'get_notebook') return notebookData(args.id ?? '');
    if (command === 'rename_notebook') {
      notebooks = notebooks.map(item => item.id === args.id ? { ...item, title: args.title, updated_at: new Date().toISOString() } : item);
      return notebookData(args.id ?? '');
    }
    if (command === 'add_block') {
      const id = args.notebookId ?? '';
      const blocks = blocksByNotebook.get(id) ?? [];
      const now = new Date().toISOString();
      const block: PreviewBlock = { id: `preview-${Date.now()}`, notebook_id: id, position: blocks.length, kind: args.kind as PreviewBlock['kind'], content: args.content ?? '', language: args.language as PreviewBlock['language'] ?? null, execution_id: args.executionId ?? null, created_at: now, updated_at: now };
      const reference = blocks.findIndex(item => item.id === args.relativeTo);
      const index = reference < 0 ? blocks.length : reference + Number(args.placement === 'after');
      blocks.splice(index, 0, block);
      blocks.forEach((item, position) => { item.position = position; });
      blocksByNotebook.set(id, blocks);
      notebooks = notebooks.map(item => item.id === id ? { ...item, block_count: blocks.length, updated_at: now } : item);
      return block;
    }
    if (command === 'update_block') {
      const block = [...blocksByNotebook.values()].flat().find(item => item.id === args.id);
      if (block) { block.content = args.content ?? ''; block.language = args.language as PreviewBlock['language'] ?? null; block.updated_at = new Date().toISOString(); }
      return block;
    }
    if (command === 'delete_notebook') { notebooks = notebooks.filter(item => item.id !== args.id); return; }
    throw new Error(`Preview does not support ${command}`);
  },
};

function Preview() {
  const [mode, setMode] = React.useState<'Chat' | 'Notebook'>('Notebook');
  const notebookMode = mode === 'Notebook';
  return <div className={`app-shell${notebookMode ? ' notebook-mode' : ''}`} style={{ '--sidebar-width': '248px' } as React.CSSProperties}>
    <header className="topbar"><div className="top-identity"><strong className="brand">DataForge</strong><span className="top-project">Preview project</span></div><div className="mode-switch" role="group" aria-label="Workspace mode"><button className={mode === 'Chat' ? 'active' : ''} aria-pressed={mode === 'Chat'} onClick={() => setMode('Chat')}>Chat</button><button className={notebookMode ? 'active' : ''} aria-pressed={notebookMode} onClick={() => setMode('Notebook')}>Notebook</button><button disabled>Dashboard</button></div><div /></header>
    <div className="body-grid inspector-hidden"><aside className="left-sidebar" aria-label="Workspace navigation">
      <div className="threads-section" aria-hidden={notebookMode} inert={notebookMode}><div className="section-heading"><span>THREADS</span><button className="section-actions" disabled aria-label="Threads are not available yet"><Plus size={16}/></button></div><div className="section-empty"><MessageSquare size={16}/><span>No threads yet</span><small>Agent investigations are coming later.</small></div></div>
      <div className="sources-section"><div className="section-heading"><span>SOURCES</span><div className="section-actions"><button disabled aria-label="Refresh source status"><RefreshCw size={14}/></button><button disabled aria-label="Register CSV source"><Plus size={16}/></button></div></div><div className="source-list"><button className="source-item" onClick={() => {}}><FileSpreadsheet size={16}/><span className="source-copy"><span className="source-name">sales.csv</span><span className="source-meta">CSV · 42 KB</span></span><span className="status-dot" aria-hidden="true" /></button></div><div className="sources-footer"><button className="add-source" disabled><FilePlus2 size={16}/> Add CSV source</button></div></div>
      <div className="sidebar-footer"><span className="local-dot"/> Local workspace <span className="version">v0.1</span></div>
    </aside><main className="main-workspace"><div className="workspace-content">{notebookMode ? <div className="notebook-surface"><NotebookWorkspace active projectName="Preview project" sources={[{ id: 'preview-source', name: 'sales.csv' }]} onDirtyChange={() => {}} /></div> : <div className="mode-empty"><Database size={28}/><h1>Select a source to continue.</h1></div>}</div></main></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
