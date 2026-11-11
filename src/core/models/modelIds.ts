/**
 * VS Code's Language Model API treats `/` in a model id as a separator, so
 * ids like `moonshotai/kimi-k3` silently vanish from the Copilot Chat picker.
 * Providers whose ids contain `/` show `__` in the picker instead and turn it
 * back into `/` before calling the API.
 */
export function toPickerId(apiId: string): string {
  return apiId.replaceAll('/', '__');
}

export function fromPickerId(pickerId: string): string {
  return pickerId.replaceAll('__', '/');
}

/** Readable name for a model we have no details for: "moonshotai/kimi-k2.6" → "Kimi K2.6". */
export function displayNameFromId(id: string): string {
  return id
    .slice(id.lastIndexOf('/') + 1)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
