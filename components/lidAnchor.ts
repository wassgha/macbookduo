/**
 * Tracks the lid angle the content is being held at.
 *
 * The effect is always relative to an anchor, never to an absolute angle: "hold the
 * content where it was when you last stopped moving the lid" rather than "hold the
 * content at 90°". Without that, every reading would be a deviation from vertical and
 * the image would sit permanently keystoned at a normal working angle.
 *
 * Auto-anchor is the other half: once the lid has been still for `delay`, the anchor
 * eases over to the current angle across `duration`, so the effect unwinds itself and
 * the image settles flat again.
 *
 * Ported from `AutoAnchor` in jh3y/lid-plane (MIT) — see components/LidPlane.tsx.
 */
export class LidAnchor {
  /** The angle the content is currently pinned to, in degrees. */
  reference: number;

  /** How long the lid must be still before the anchor starts catching up, in seconds. */
  delay = 0.15;
  /** How long the catch-up takes, in seconds. */
  duration = 0.2;
  /** Degrees of movement that count as "the lid is moving". */
  movementThreshold = 1.5;

  /** The angle at the last movement that cleared `movementThreshold`. */
  private motionAngle: number;
  private lastMovement: number;
  private settlingSince: number | null = null;
  private settlingFrom = 0;

  constructor(angle: number, now: number) {
    this.reference = angle;
    this.motionAngle = angle;
    this.lastMovement = now;
  }

  /** Pin the content to `angle`, cancelling any settle in progress. */
  anchor(angle: number, now: number) {
    this.reference = angle;
    this.motionAngle = angle;
    this.lastMovement = now;
    this.settlingSince = null;
  }

  /**
   * Advance the state machine. `now` is monotonic seconds.
   *
   * @param enabled - whether to auto-anchor. When false the reference never moves on its
   *   own, so the content holds its original angle indefinitely.
   */
  update(angle: number, now: number, enabled: boolean) {
    // Compared against the last meaningful movement rather than the previous sample, so
    // that a slow drift still adds up to "moving" and keeps restarting the debounce.
    if (Math.abs(angle - this.motionAngle) >= this.movementThreshold) {
      this.motionAngle = angle;
      this.lastMovement = now;
      this.settlingSince = null;
    }

    if (!enabled || now - this.lastMovement < this.delay) {
      this.settlingSince = null;
      return;
    }

    if (Math.abs(this.reference - angle) < 0.05) {
      this.reference = angle;
      this.settlingSince = null;
      return;
    }

    if (this.settlingSince === null) {
      this.settlingSince = now;
      this.settlingFrom = this.reference;
    }

    const progress = Math.min(1, Math.max(0, (now - this.settlingSince) / Math.max(0.01, this.duration)));
    const eased = progress * progress * (3 - 2 * progress);
    this.reference = this.settlingFrom + (angle - this.settlingFrom) * eased;
    if (progress === 1) this.settlingSince = null;
  }
}
