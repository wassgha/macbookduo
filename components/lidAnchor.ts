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

/**
 * Decides how far the content is being held from where the lid is now.
 *
 * Wraps the anchor with two rules that are ours, not lid-plane's, both consequences of
 * the warp not being symmetric. Closing tilts the display towards the viewer, so rays
 * through the top of it travel further, the image keystones away, and it reads as
 * content standing still while the display moves. Opening tilts the display away, which
 * puts the anchored content plane between the viewer and the display: the rays converge
 * instead, the keystone inverts, and the image just swells and blurs.
 *
 * 1. **Only the closing direction is held.** Opening wider than the anchor renders
 *    nothing rather than that inverted warp.
 * 2. **The anchor holds while the lid is shut.** Below {@link closedBelow} the screen is
 *    not really visible, so letting the anchor settle there would pin the content to a
 *    plane nobody ever looked at — and opening up again would then have to render the
 *    inverted warp, saturated, for the whole sweep. Holding the anchor instead means
 *    opening back up unwinds the very warp that closing built, in the direction that
 *    reads correctly, reaching flat exactly as the lid returns to where it started.
 */
export class LidHold {
  /** Below this the lid counts as shut rather than at a working angle, in degrees. */
  closedBelow = 45;

  private readonly anchor: LidAnchor;

  constructor(angle: number, now: number) {
    this.anchor = new LidAnchor(angle, now);
  }

  /** The angle the content is pinned to, in degrees. */
  get reference() {
    return this.anchor.reference;
  }

  /**
   * Advance by one frame.
   *
   * @param now - monotonic seconds.
   * @returns how far to warp, in degrees. Never negative; zero means flat.
   */
  update(angle: number, now: number, autoAnchor: boolean): number {
    this.anchor.update(angle, now, autoAnchor && angle >= this.closedBelow);
    return Math.max(0, this.anchor.reference - angle);
  }
}
