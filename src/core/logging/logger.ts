import * as vscode from 'vscode';

/**
 * Centralized structured logging for Copilot Amplify.
 *
 * - Writes to a single VS Code output channel ("Copilot Amplify").
 * - Supports child loggers with bound context (e.g. `{ provider: 'omniroute' }`).
 * - Redacts sensitive values before they ever reach the channel.
 *
 * Never pass raw Authorization headers or API keys to the logger; redaction is
 * a safety net, not an invitation.
 */

const CHANNEL_NAME = 'Copilot Amplify';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY_PATTERN = /authorization|apikey|api[-_]key|token|secret|password|cookie/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g;

/** Placeholder substituted for any detected sensitive value. */
export const REDACTED = '[REDACTED]';

let channel: vscode.OutputChannel | undefined;
let minWeight = LEVEL_WEIGHT.info;
let configListener: vscode.Disposable | undefined;

function ensureDebugSettingListener(): void {
  if (configListener) {
    return;
  }
  // Refresh level threshold when the user flips debug logging.
  // Registered once per extension host; the disposable is tracked so
  // `disposeLogChannel()` can detach it on extension deactivation.
  try {
    configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('copilot-amplify.debugLogging') ||
        event.affectsConfiguration('copilot-amplify.CA-omniroute.debugLogging')
      ) {
        // VS Code fires this on every settings.json keystroke. Debounce so
        // a long edit session does not thrash `minWeight` reads.
        scheduleMinWeightRefresh();
      }
    });
  } catch {
    /* workspace API unavailable in some hosts — logging still works */
  }
}

let minWeightRefreshTimer: NodeJS.Timeout | undefined;
function scheduleMinWeightRefresh(): void {
  if (minWeightRefreshTimer) {
    return;
  }
  minWeightRefreshTimer = setTimeout(() => {
    minWeightRefreshTimer = undefined;
    minWeight = readMinWeight();
  }, 250);
  minWeightRefreshTimer.unref?.();
}

function readMinWeight(): number {
  try {
    const cfg = vscode.workspace.getConfiguration('copilot-amplify');
    const globalDebug = cfg.get<boolean>('debugLogging', false);
    const omniDebug = vscode.workspace
      .getConfiguration('copilot-amplify.CA-omniroute')
      .get<boolean>('debugLogging', false);
    return globalDebug || omniDebug ? LEVEL_WEIGHT.debug : LEVEL_WEIGHT.info;
  } catch {
    return LEVEL_WEIGHT.info;
  }
}

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
    minWeight = readMinWeight();
    ensureDebugSettingListener();
  }
  return channel;
}

/**
 * Redact sensitive material from arbitrary log data.
 * - Object/array values: keys matching sensitive patterns are censored.
 * - Strings: `Bearer <value>` sequences are censored inline.
 * - Cyclic references are broken via a `WeakSet` so a chained
 *   `error.cause = error` does not blow the recursion budget.
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > 6) {
    return '[depth limit]';
  }
  if (typeof value === 'string') {
    return value.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  }
  if (value instanceof Error) {
    return `${value.name}: ${redact(value.message, depth + 1, seen)}`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[cycle]';
    }
    seen.add(value);
    return value.map((item) => redact(item, depth + 1, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[cycle]';
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1, seen);
    }
    return out;
  }
  return value;
}

function serialize(data: unknown): string {
  if (data === undefined) {
    return '';
  }
  const safe = redact(data);
  if (typeof safe === 'string') {
    return safe;
  }
  try {
    return JSON.stringify(safe);
  } catch {
    return String(safe);
  }
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** Create a logger with additional bound context appended to every line. */
  child(bindings: Record<string, string | number | boolean>): Logger;
}

function write(level: LogLevel, bindings: Record<string, unknown>, message: string, data?: unknown): void {
  if (LEVEL_WEIGHT[level] < minWeight && level !== 'error' && level !== 'warn') {
    return;
  }
  const stamp = new Date().toISOString();
  const ctx = Object.entries(bindings)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  const payload = serialize(data);
  const line = `${stamp} [${level.toUpperCase()}]${ctx ? ` [${ctx}]` : ''} ${message}${payload ? ` ${payload}` : ''}`;
  try {
    getChannel().appendLine(line);
  } catch {
    /* never let logging break execution */
  }
}

function makeLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, d) => write('debug', bindings, m, d),
    info: (m, d) => write('info', bindings, m, d),
    warn: (m, d) => write('warn', bindings, m, d),
    error: (m, d) => write('error', bindings, m, d),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

/** Root application logger. Prefer `logger.child({ provider })` in providers. */
export const logger: Logger = makeLogger();

/** Test/debug hook: reveal the output channel. */
export function showLogChannel(preserveFocus = true): void {
  getChannel().show(preserveFocus);
}

/** Dispose the underlying output channel (called on extension shutdown). */
export function disposeLogChannel(): void {
  if (minWeightRefreshTimer) {
    clearTimeout(minWeightRefreshTimer);
    minWeightRefreshTimer = undefined;
  }
  configListener?.dispose();
  configListener = undefined;
  channel?.dispose();
  channel = undefined;
}
