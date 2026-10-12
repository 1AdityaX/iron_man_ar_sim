/**
 * One Euro filter (Casiez et al. 2012): an adaptive low-pass filter that smooths jitter
 * when the signal is slow and lets fast motion through with little lag.
 */

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

const alpha = (dtSec: number, cutoffHz: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
};

export class OneEuroFilter {
  private x = 0;
  private dx = 0;
  private lastT = -1;

  constructor(private readonly params: OneEuroParams) {}

  reset(): void {
    this.lastT = -1;
  }

  /** @param tSec timestamp in seconds */
  filter(value: number, tSec: number): number {
    if (this.lastT < 0) {
      this.x = value;
      this.dx = 0;
      this.lastT = tSec;
      return value;
    }
    const dt = Math.max(1e-4, tSec - this.lastT);
    this.lastT = tSec;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(dt, this.params.dCutoff) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

/**
 * Filters `count` points of `dim` components that share a timestamp. The cutoff for each point
 * adapts to that point's speed (vector magnitude), so all of its components lag equally.
 */
export class OneEuroPoints {
  readonly value: Float32Array;
  private readonly deriv: Float32Array;
  private lastT = -1;

  constructor(
    private readonly count: number,
    private readonly dim: number,
    private readonly params: OneEuroParams,
  ) {
    this.value = new Float32Array(count * dim);
    this.deriv = new Float32Array(count * dim);
  }

  reset(): void {
    this.lastT = -1;
  }

  get initialized(): boolean {
    return this.lastT >= 0;
  }

  /** Filters `input` in place into `this.value` and returns it. */
  filter(input: ArrayLike<number>, tSec: number): Float32Array {
    const { count, dim, value, deriv } = this;
    if (this.lastT < 0) {
      for (let i = 0; i < count * dim; i++) {
        value[i] = input[i];
        deriv[i] = 0;
      }
      this.lastT = tSec;
      return value;
    }
    const dt = Math.max(1e-4, tSec - this.lastT);
    this.lastT = tSec;
    const aD = alpha(dt, this.params.dCutoff);
    for (let p = 0; p < count; p++) {
      const o = p * dim;
      let speedSq = 0;
      for (let c = 0; c < dim; c++) {
        const raw = (input[o + c] - value[o + c]) / dt;
        deriv[o + c] += aD * (raw - deriv[o + c]);
        speedSq += deriv[o + c] * deriv[o + c];
      }
      const cutoff = this.params.minCutoff + this.params.beta * Math.sqrt(speedSq);
      const a = alpha(dt, cutoff);
      for (let c = 0; c < dim; c++) value[o + c] += a * (input[o + c] - value[o + c]);
    }
    return value;
  }
}
