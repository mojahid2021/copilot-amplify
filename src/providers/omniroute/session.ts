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

/**
 * Resolve the session id to send: explicit override → generated window id.
 * Empty string when the caller should send nothing.
 */
export function resolveOmnirouteSessionId(explicit: string | undefined): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed) {
    return trimmed;
  }
  generatedSessionId ??= crypto.randomUUID();
  return generatedSessionId;
}
