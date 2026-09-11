"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** One reading from the sensor, as sent by the `lid-angle` helper. */
export type LidAngleReading = {
  /** Degrees. Roughly 0 with the lid shut, ~130 at the hinge stop. */
  angle: number;
  /** Unix seconds, from the machine that took the reading. */
  t: number;
};

export type LidAngleSubscription = {
  /**
   * Latest angle in degrees, or `null` before the first reading arrives.
   *
   * A ref rather than state on purpose: readings arrive up to 30 times a second and are
   * consumed inside the render loop, so re-rendering React for each one would be pure
   * overhead.
   */
  angleRef: RefObject<number | null>;
  /** Why there are no readings, if the sensor or the helper is unavailable. */
  error: string | null;
  /**
   * Whether the angle is being driven by the URL rather than the sensor, in which case
   * the anchor should be left alone so the simulated movement holds.
   */
  simulated: boolean;
};

/** How long to let the anchor settle on the pinned angle before folding away from it. */
const simulatedFoldDelay = 400;

/**
 * Subscribes to `/api/lid-angle` and tracks the latest lid angle.
 *
 * Two URL overrides stand in for the sensor, so the effect can be worked on and captured
 * without touching the lid:
 *
 * - `?lid=95` pins the angle to 95° and never opens the stream.
 * - `?lid=105&fold=35` pins 105°, waits for the anchor to take, then moves to 70° — the
 *   equivalent of lid-plane's "Simulate a Fold", and the only way to hold the effect
 *   still for a screenshot.
 *
 * @param log - also `console.log` every reading.
 */
export function useLidAngle({ log = false }: { log?: boolean } = {}): LidAngleSubscription {
  const angleRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);

  // Read inside the SSE handlers without making them a dependency of the effect.
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const pinned = Number(parameters.get("lid"));
    const fold = Number(parameters.get("fold"));

    if (Number.isFinite(pinned) && pinned !== 0) {
      console.log(`[lid-angle] pinned to ${pinned}° by ?lid=`);
      angleRef.current = pinned;

      if (!Number.isFinite(fold) || fold === 0) return;

      setSimulated(true);
      const folded = Math.max(10, pinned - fold);
      const timer = setTimeout(() => {
        console.log(`[lid-angle] simulating a fold to ${folded}°`);
        angleRef.current = folded;
      }, simulatedFoldDelay);
      return () => clearTimeout(timer);
    }

    const source = new EventSource("/api/lid-angle");

    source.addEventListener("angle", (event) => {
      const reading = JSON.parse(event.data) as LidAngleReading;
      if (logRef.current) {
        console.log(`[lid-angle] ${reading.angle.toFixed(1)}°`);
      }
      angleRef.current = reading.angle;
      setError(null);
    });

    // The server closes the stream after this, and EventSource would reconnect to a
    // route that is going to fail the same way, so stop listening.
    source.addEventListener("sensor-error", (event) => {
      const { message } = JSON.parse(event.data) as { message: string };
      console.warn(`[lid-angle] ${message}`);
      setError(message);
      source.close();
    });

    // Fires on a dropped connection, and on a connection that never opened. Anything
    // the server can explain already arrived as `sensor-error`; this is the transport
    // giving up. EventSource reconnects on its own unless it has closed for good.
    source.addEventListener("error", () => {
      if (source.readyState !== EventSource.CLOSED) return;
      const message = "Connection to /api/lid-angle closed.";
      console.warn(`[lid-angle] ${message}`);
      setError(message);
    });

    return () => source.close();
  }, []);

  return { angleRef, error, simulated };
}
