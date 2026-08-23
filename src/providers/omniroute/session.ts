/**
 * OmniRoute session identification.
 *
 * The server accepts `X-OmniRoute-Session-Id` for per-session cost attribution
 * and memory. An explicit setting always wins; otherwise a stable per-window
 * identifier is generated lazily so requests from this window share one tag
 * without leaking across windows.
 *
 * (The VS Code LM API does not expose a conversation identity, so true
 * per-conversation tagging is not possible today — documented limitation.)
 */

let generatedSessionId: string | undefined;

function generateSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to Math.random */
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolve the session id to send: explicit override → generated window id.
 * Empty string when the caller should send nothing.
 */
export function resolveOmnirouteSessionId(explicit: string | undefined): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed) {
    return trimmed;
  }
  generatedSessionId ??= generateSessionId();
  return generatedSessionId;
}

/** Test hook: forget the generated id. */
export function resetGeneratedSessionId(): void {
  generatedSessionId = undefined;
}
