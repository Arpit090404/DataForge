import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/button';
import { PythonOutputView } from '../src/Notebook';
import '../src/tailwind.css';
import '../src/styles.css';

function chartPng(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 700; canvas.height = 280;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 700, 280);
  context.strokeStyle = '#d7dce0'; context.lineWidth = 1;
  for (const y of [35, 90, 145, 200]) { context.beginPath(); context.moveTo(65, y); context.lineTo(670, y); context.stroke(); }
  context.beginPath(); context.moveTo(65, 25); context.lineTo(65, 210); context.lineTo(670, 210); context.stroke();
  context.fillStyle = '#58626c'; context.font = '13px Segoe UI';
  ['North', 'South', 'West'].forEach((label, index) => context.fillText(label, 125 + index * 235, 245));
  context.strokeStyle = '#3c77a6'; context.lineWidth = 3;
  context.beginPath(); context.moveTo(145, 91); context.lineTo(380, 156); context.lineTo(615, 45); context.stroke();
  context.fillStyle = '#3c77a6';
  for (const [x, y] of [[145, 91], [380, 156], [615, 45]]) { context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill(); }
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

function Preview() {
  const [image, setImage] = useState('');
  const [visible, setVisible] = useState(true);
  const [run, setRun] = useState(3);
  useEffect(() => setImage(chartPng()), []);
  const outputs = [
    { kind: 'stdout', text: 'Quarterly revenue\n' },
    { kind: 'table', text: '  region  revenue\n0  North     1240\n1  South      980\n2   West     1515', columns: ['', 'region', 'revenue'], rows: [['0', 'North', '1240'], ['1', 'South', '980'], ['2', 'West', '1515']] },
    ...(image ? [{ kind: 'image', text: '<Figure size 700x280 with 1 Axes>', mime: 'image/png', data: image }] : []),
    { kind: 'stderr', text: 'Note: sample output shown in browser only.\n' },
    { kind: 'result', text: '3 rows × 2 columns' },
  ];
  return <main className="rich-preview">
    <p className="rich-preview-note">Browser rendering demo · sample output · Python execution requires the desktop app</p>
    <section className="rich-preview-cell" aria-label="Python Code cell preview">
      <header className="rich-preview-toolbar"><span>Python</span><div><Button variant="secondary" size="small" onClick={() => { setVisible(true); setRun(current => current + 1); }}>Show sample output</Button><Button variant="ghost" size="small" onClick={() => setVisible(false)}>Clear output</Button></div></header>
      <pre className="rich-preview-code">{`import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.DataFrame({'region': ['North', 'South', 'West'], 'revenue': [1240, 980, 1515]})\nprint('Quarterly revenue')\ndisplay(df)\nplt.plot(df['region'], df['revenue'], marker='o')\nplt.show()`}</pre>
      <div className="rich-preview-output"><p className="notebook-muted">{visible ? `succeeded · In [${run}] · 392 ms` : 'No output shown'}</p>{visible && outputs.map((output, index) => <PythonOutputView key={index} output={output}/>)}</div>
    </section>
    <style>{`
      .rich-preview{min-height:100vh;padding:var(--space-page);background:var(--color-app-bg);color:var(--color-text);font-family:var(--font-family-ui)}
      .rich-preview-note{max-width:1120px;margin:0 auto var(--space-3);color:var(--color-text-muted);font-size:var(--font-size-secondary)}
      .rich-preview-cell{max-width:1120px;margin:auto;border:1px solid var(--color-border);border-radius:var(--radius-default);background:var(--color-surface);overflow:hidden}
      .rich-preview-toolbar{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-control-x);color:var(--color-accent);font-weight:600}
      .rich-preview-toolbar>div{display:flex;gap:var(--space-2)}
      .rich-preview-code{margin:0;padding:var(--space-3) var(--space-control-x);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--color-code-surface);color:var(--color-text);font:var(--font-size-code)/1.6 var(--font-family-code)}
      .rich-preview-output{display:grid;gap:var(--space-2);padding:var(--space-3) var(--space-control-x);border-top:1px solid var(--color-border)}
      .rich-preview-output>p{margin:0}
    `}</style>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
