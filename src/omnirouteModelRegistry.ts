/**
 * In-memory registry of OmniRoute model capabilities discovered from
 * `GET /v1/models`. The client uses this to avoid sending parameters that an
 * upstream model explicitly does not support (e.g. `temperature` for models
 * advertising `capabilities.temperature === false`), which would otherwise
 * return HTTP 400.
 *
 * Keys are the *original* upstream model ids (e.g. `auto/best-coding`) — the
 * same ids that are sent in the request body after slash-encoding is resolved.
 */
const temperatureSupport = new Map<string, boolean>();

export function registerOmnirouteModelCapabilities(
  id: string,
  capabilities?: { temperature?: boolean },
): void {
  if (typeof capabilities?.temperature === 'boolean') {
    temperatureSupport.set(id, capabilities.temperature);
  }
}

/**
 * Whether the model accepts a `temperature` parameter. Unknown models default
 * to `true` (the common case) so we never accidentally drop it.
 */
export function omnirouteModelSupportsTemperature(id: string): boolean {
  return temperatureSupport.get(id) ?? true;
}

export function clearOmnirouteModelCapabilities(): void {
  temperatureSupport.clear();
}
