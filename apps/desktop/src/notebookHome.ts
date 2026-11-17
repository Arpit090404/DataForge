export function filterNotebooks<T extends { title: string }>(notebooks: T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  return notebooks.filter(notebook => notebook.title.toLowerCase().includes(query));
}

export function sortNotebooks<T extends { title: string; updated_at: string }>(notebooks: T[], sort: 'modified' | 'name'): T[] {
  return [...notebooks].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : b.updated_at.localeCompare(a.updated_at));
}
