import type { ConnectionTestResult } from '../core/provider/registry';

/** One-sentence summary of a connection test, e.g. "Groq is connected (320 ms, 9 models)." */
export function connectionSummary(providerName: string, result: ConnectionTestResult): string {
  if (!result.ok) {
    return `Couldn't connect to ${providerName}. ${asSentence(result.message)}`;
  }
  const extras = [
    result.latencyMs !== undefined ? `${result.latencyMs} ms` : '',
    result.modelCount !== undefined ? `${result.modelCount} models` : '',
  ].filter(Boolean);
  return `${providerName} is connected${extras.length > 0 ? ` (${extras.join(', ')})` : ''}.`;
}

export function isAuthFailure(result: ConnectionTestResult): boolean {
  return result.httpStatus === 401 || result.httpStatus === 403;
}

/** Capitalize and end with a full stop, so messages from different sources read the same. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
