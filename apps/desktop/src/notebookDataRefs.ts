export type ReferenceDataset = { id: string; name: string };
export type ReferenceResult = { id: string; name: string | null; available: boolean };

export function datasetAccessName(source: ReferenceDataset, sources: ReferenceDataset[], results: ReferenceResult[] = []): string {
  const collision = sources.some(other => other.id !== source.id && other.name.toLowerCase() === source.name.toLowerCase())
    || results.some(result => result.available && result.name?.toLowerCase() === source.name.toLowerCase());
  return collision || source.name.toLowerCase() === 'source' || source.name.toLowerCase().startsWith('dataset_')
    ? `dataset_${source.id.replaceAll('-', '')}` : source.name;
}

export function resultAccessName(result: ReferenceResult, datasets: ReferenceDataset[] = []): string {
  return result.name && !datasets.some(dataset => dataset.name.toLowerCase() === result.name?.toLowerCase())
    ? result.name : `result_${result.id.replaceAll('-', '')}`;
}

export function sqlReference(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function pythonReference(kind: 'dataset' | 'result', name: string): string {
  return `dataforge.${kind}(${JSON.stringify(name)})`;
}
