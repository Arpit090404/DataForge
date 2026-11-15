export function filterNotebooks<T extends { title: string }>(notebooks: T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  return notebooks.filter(notebook => notebook.title.toLowerCase().includes(query));
}
