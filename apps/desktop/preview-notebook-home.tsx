import React from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FilePlus2, FileSpreadsheet, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import NotebookWorkspace from './src/Notebook';
import './src/tailwind.css';
import './src/styles.css';

let notebooks = [
  { id: 'one', title: 'Regional sales investigation', updated_at: '2026-11-18T12:30:00Z', block_count: 8 },
  { id: 'two', title: 'Revenue quality checks', updated_at: '2026-11-17T09:15:00Z', block_count: 5 },
  { id: 'three', title: 'Customer cohorts', updated_at: '2026-11-14T14:45:00Z', block_count: 3 },
];

(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: Record<string, string> = {}) => {
    if (command === 'list_notebooks') return notebooks;
    if (command === 'list_executions') return [];
    if (command === 'create_notebook') {
      const note = { id: String(Date.now()), title: args.title, updated_at: new Date().toISOString(), block_count: 0 };
      notebooks = [note, ...notebooks];
      return { ...note, created_at: note.updated_at, blocks: [] };
    }
    if (command === 'get_notebook') {
      const note = notebooks.find(item => item.id === args.id);
      return note && { ...note, created_at: note.updated_at, blocks: [] };
    }
    if (command === 'rename_notebook') {
      notebooks = notebooks.map(item => item.id === args.id ? { ...item, title: args.title, updated_at: new Date().toISOString() } : item);
      return notebooks.find(item => item.id === args.id);
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
    </aside><main className="main-workspace"><div className="workspace-content">{notebookMode ? <NotebookWorkspace active projectName="Preview project" sources={[]} onDirtyChange={() => {}} /> : <div className="mode-empty"><Database size={28}/><h1>Select a source to continue.</h1></div>}</div></main></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
