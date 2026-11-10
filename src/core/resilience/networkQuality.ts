/** Rolling quality assessment for one provider's recent requests. */

export interface NetworkQuality {
  level: 'good' | 'degraded' | 'poor';
  /** Average latency across the sample window (ms). 0 when no samples. */
  avgLatencyMs: number;
  /** Fraction of failed requests in the window [0, 1]. */
  errorRate: number;
  sampleCount: number;
}

const WINDOW = 20;
// p80 latency thresholds (ms)
const POOR_LATENCY = 8_000;
const DEGRADED_LATENCY = 3_000;
// Error-rate thresholds
const POOR_ERROR_RATE = 0.5;
const DEGRADED_ERROR_RATE = 0.2;

export class NetworkQualityTracker {
  private readonly samples: Array<{ latencyMs: number; ok: boolean }> = [];

  record(latencyMs: number, ok: boolean): void {
    this.samples.push({ latencyMs, ok });
    if (this.samples.length > WINDOW) {
      this.samples.shift();
    }
  }

  getQuality(): NetworkQuality {
    if (this.samples.length === 0) {
      return { level: 'good', avgLatencyMs: 0, errorRate: 0, sampleCount: 0 };
    }

    const errorRate = this.samples.filter((s) => !s.ok).length / this.samples.length;
    const latencies = this.samples.map((s) => s.latencyMs);
    const avgLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    const sorted = [...latencies].sort((a, b) => a - b);
    const p80idx = Math.min(Math.floor(sorted.length * 0.8), sorted.length - 1);
    const p80 = sorted[p80idx] ?? 0;

    const level =
      errorRate > POOR_ERROR_RATE || p80 > POOR_LATENCY ? 'poor'
      : errorRate > DEGRADED_ERROR_RATE || p80 > DEGRADED_LATENCY ? 'degraded'
      : 'good';

    return { level, avgLatencyMs, errorRate, sampleCount: this.samples.length };
  }

  reset(): void {
    this.samples.length = 0;
  }
}
