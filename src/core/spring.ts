/** Damped spring integrated with fixed sub-steps for frame-rate independence. */
export class Spring {
  x: number;
  v = 0;
  target: number;

  constructor(x = 0, public stiffness = 110, public damping = 21) {
    this.x = x;
    this.target = x;
  }

  get idle(): boolean {
    return this.v === 0 && this.x === this.target;
  }

  snap(x: number) {
    this.x = this.target = x;
    this.v = 0;
  }

  step(dt: number) {
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      const a = -this.stiffness * (this.x - this.target) - this.damping * this.v;
      this.v += a * h;
      this.x += this.v * h;
      left -= h;
    }
    if (Math.abs(this.v) < 0.02 && Math.abs(this.x - this.target) < 0.05) {
      this.x = this.target;
      this.v = 0;
    }
  }
}
