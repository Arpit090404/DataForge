import React from 'react';
import { createRoot } from 'react-dom/client';
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

createRoot(document.getElementById('root')!).render(<div className="app-shell notebook-mode" style={{ '--sidebar-width': '248px' } as React.CSSProperties}>
  <header className="topbar"><div className="top-identity"><strong className="brand">DataForge</strong><span className="top-project">Preview project</span></div><div className="mode-switch"><button>Chat</button><button className="active">Notebook</button><button>Dashboard</button></div><div /></header>
  <div className="body-grid"><aside className="sidebar"><div className="sidebar-header">SOURCES</div><div className="source-list"><div className="source-item"><div className="source-copy"><span className="source-name">sales.csv</span><span className="source-meta">CSV source</span></div></div></div></aside><main className="main-workspace"><div className="workspace-content"><NotebookWorkspace active projectName="Preview project" sources={[]} onDirtyChange={() => {}} /></div></main></div>
</div>);
