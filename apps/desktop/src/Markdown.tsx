// Render text as React nodes; unsupported Markdown and raw HTML remain text.
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    parts.push(text.slice(last, index));
    const value = match[0];
    if (value.startsWith('`')) parts.push(<code key={index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith('**')) parts.push(<strong key={index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith('*')) parts.push(<em key={index}>{value.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value)!;
      if (/^(https?:\/\/|mailto:)/i.test(link[2])) parts.push(<a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>);
      else parts.push(value);
    }
    last = index + value.length;
  }
  parts.push(text.slice(last));
  return parts;
}

const listMarker = /^([ \t]*)([-*+]|\d{1,9}\.)[ \t]+(.+)$/;

function readLists(lines: string[], start: number) {
  type Item = { line: number; text: string; children: React.ReactNode[] };
  type List = { indent: number; ordered: boolean; start: number; items: Item[] };
  const stack: List[] = [];
  const nodes: React.ReactNode[] = [];
  function closeList() {
    const list = stack.pop()!;
    const items = list.items.map(item => <li key={item.line}>{inline(item.text)}{item.children}</li>);
    const key = list.items[0].line;
    const node = list.ordered ? <ol key={key} start={list.start === 1 ? undefined : list.start}>{items}</ol> : <ul key={key}>{items}</ul>;
    (stack.at(-1)?.items.at(-1)?.children ?? nodes).push(node);
  }

  let i = start;
  while (i < lines.length) {
    const marker = listMarker.exec(lines[i]);
    if (!marker) {
      if (!lines[i].trim() && listMarker.test(lines[i + 1] ?? '')) { i++; continue; }
      break;
    }
    const indent = [...marker[1]].reduce((column, char) => column + (char === '\t' ? 4 - column % 4 : 1), 0);
    const ordered = marker[2].endsWith('.');
    while (stack.length && stack[stack.length - 1].indent > indent) closeList();
    const current = stack.at(-1);
    if (current?.indent === indent && current.ordered !== ordered) closeList();
    if (stack.at(-1)?.indent !== indent) {
      stack.push({ indent, ordered, start: ordered ? parseInt(marker[2], 10) : 1, items: [] });
    }
    stack.at(-1)!.items.push({ line: i, text: marker[3], children: [] });
    i++;
  }
  while (stack.length) closeList();
  return { nodes, end: i };
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^```/.test(lines[i])) {
      const start = i++;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={start}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (heading) {
      const content = inline(heading[2]);
      const level = heading[1].length;
      nodes.push(level === 1 ? <h1 key={i}>{content}</h1> : level === 2 ? <h2 key={i}>{content}</h2> : level === 3 ? <h3 key={i}>{content}</h3> : level === 4 ? <h4 key={i}>{content}</h4> : level === 5 ? <h5 key={i}>{content}</h5> : <h6 key={i}>{content}</h6>);
      i++; continue;
    }
    if (listMarker.test(lines[i])) {
      const list = readLists(lines, i);
      nodes.push(...list.nodes);
      i = list.end;
      continue;
    }
    const start = i; const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && (i === start || (!/^(#{1,6}\s+|```)/.test(lines[i]) && !listMarker.test(lines[i])))) paragraph.push(lines[i++]);
    nodes.push(<p key={start}>{inline(paragraph.join(' '))}</p>);
  }
  return <div className="notebook-markdown">{nodes.length ? nodes : <p className="notebook-muted">Empty Markdown block</p>}</div>;
}

