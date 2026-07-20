export function normalizeClientName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizedClientKey(value: string) {
  return normalizeClientName(value).toLocaleLowerCase();
}
