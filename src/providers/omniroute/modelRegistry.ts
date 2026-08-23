/**
 * In-memory registry of OmniRoute model capabilities discovered from
 * `GET /models`. Used to avoid sending parameters an upstream model explicitly
 * rejects (e.g. `temperature: false`) and to mark reasoning-capable models.
 *
 * Keys are the *original* upstream ids (`auto/best-coding`). Bounded so a
 * misbehaving server cannot grow it indefinitely.
 */

const MAX_ENTRIES = 512;

interface ModelCapabilities {
  temperature?: boolean;
  thinking?: boolean;
}

const capabilitiesById = new Map<string, ModelCapabilities>();

export function registerOmnirouteModelCapabilities(id: string, caps?: ModelCapabilities): void {
  if (!caps || (caps.temperature === undefined && caps.thinking === undefined)) {
    return;
  }
  if (!capabilitiesById.has(id) && capabilitiesById.size >= MAX_ENTRIES) {
    const oldest = capabilitiesById.keys().next();
    if (!oldest.done) {
      capabilitiesById.delete(oldest.value);
    }
  }
  capabilitiesById.set(id, {
    temperature: typeof caps.temperature === 'boolean' ? caps.temperature : undefined,
    thinking: typeof caps.thinking === 'boolean' ? caps.thinking : undefined,
  });
}

/**
 * Whether the model accepts a `temperature` parameter. Unknown models default
 * to `true` (the common case) so we never accidentally drop it.
 */
export function omnirouteModelSupportsTemperature(id: string): boolean {
  return capabilitiesById.get(id)?.temperature ?? true;
}

/** Advertised reasoning support, when the server declares it. */
export function omnirouteModelAdvertisesThinking(id: string): boolean | undefined {
  return capabilitiesById.get(id)?.thinking;
}

export function clearOmnirouteModelCapabilities(): void {
  capabilitiesById.clear();
}
