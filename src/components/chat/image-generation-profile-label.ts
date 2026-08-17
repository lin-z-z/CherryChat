export function sameImageProfileLabel(name: string, modelId: string): boolean {
  return normalizeLabel(name) === normalizeLabel(modelId);
}

export function imageProfileLabel(name: string, modelId: string): string {
  return sameImageProfileLabel(name, modelId)
    ? name
    : `${name} \u00b7 ${modelId}`;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
