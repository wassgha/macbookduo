"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  openGrantedSensor,
  pollSensor,
  requestSensor,
  webHidAvailable,
} from "./lidSensorHid";

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
  /**
   * Shows the browser's HID chooser, or null when there is nothing to ask for — either
   * readings are already arriving or this browser has no WebHID.
   *
   * Must be called from a user gesture, so it needs a real control behind it.
   */
  connect: (() => void) | null;
};

/** How long to let the anchor settle on the pinned angle before folding away from it. */
const simulatedFoldDelay = 400;

/** Polling rate for the WebHID path, in Hz. The stream is paced by the helper instead. */
const pollRate = 30;

/**
 * Tracks the latest lid angle, from whichever source can supply it.
 *
 * WebHID first when this origin has already been granted the device, since that needs
 * no helper and is the only thing that can work in a deployment. Otherwise the
 * `/api/lid-angle` stream, which is the zero-click path in local development. If
 * neither has produced a reading, `connect` offers the chooser.
 *
 * Two URL overrides stand in for the sensor, so the effect can be worked on and captured
 * without touching the lid:
 *
 * - `?lid=95` pins the angle to 95° and never opens the stream.
 * - `?lid=105&fold=35` pins 105°, waits for the anchor to take, then moves to 70° — the
 *   equivalent of lid-plane's "Simulate a Fold", and the only way to hold the effect
 *   still for a screenshot.
 * - `?hid=1` skips the stream, so the WebHID path can be exercised on a machine where
 *   the helper would otherwise answer first.
 *
 * @param log - also `console.log` every reading.
 */
export function useLidAngle({ log = false }: { log?: boolean } = {}): LidAngleSubscription {
  const angleRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [reading, setReading] = useState(false);
  // Set from an effect, not read inline: the server cannot see navigator.hid, so letting
  // it into the first client render is a hydration mismatch.
  const [canConnect, setCanConnect] = useState(false);
  const stopHid = useRef<(() => void) | null>(null);

  // Read inside the SSE handlers without making them a dependency of the effect.
  const logRef = useRef(log);
  logRef.current = log;

  const track = useCallback(
    (angle: number) => {
      if (logRef.current) console.log(`[lid-angle] ${angle.toFixed(1)}°`);
      angleRef.current = angle;
      setReading(true);
      setError(null);
    },
    [],
  );

  useEffect(() => setCanConnect(webHidAvailable()), []);

  /** Opens the chooser, then polls whatever the user picked. */
  const connect = useCallback(() => {
    requestSensor()
      .then((device) => {
        if (!device) {
          const message = "No lid angle sensor came back from the chooser.";
          console.warn(`[lid-angle] ${message}`);
          setError(message);
          return;
        }
        stopHid.current?.();
        stopHid.current = pollSensor(device, pollRate, track);
      })
      .catch((cause: unknown) => {
        // Dismissing the chooser rejects, so this is a normal outcome, not a fault.
        const message = cause instanceof Error ? cause.message : String(cause);
        console.warn(`[lid-angle] the chooser did not return a device: ${message}`);
      });
  }, [track]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const pinned = Number(parameters.get("lid"));
    const fold = Number(parameters.get("fold"));

    if (Number.isFinite(pinned) && pinned !== 0) {
      console.log(`[lid-angle] pinned to ${pinned}° by ?lid=`);
      angleRef.current = pinned;
      setReading(true);

      if (!Number.isFinite(fold) || fold === 0) return;

      setSimulated(true);
      const folded = Math.max(10, pinned - fold);
      const timer = setTimeout(() => {
        console.log(`[lid-angle] simulating a fold to ${folded}°`);
        angleRef.current = folded;
      }, simulatedFoldDelay);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    let source: EventSource | null = null;

    // An existing grant is reused silently; only a first visit needs the chooser.
    openGrantedSensor()
      .then((device) => {
        if (cancelled) return;
        if (device) {
          stopHid.current = pollSensor(device, pollRate, track);
          source?.close();
          source = null;
          return;
        }
        if (parameters.get("hid")) {
          console.log("[lid-angle] ?hid= is set and no device is granted yet; use Connect.");
          return;
        }
        source = openStream();
      })
      .catch((cause: unknown) => {
        // WebHID exists but would not enumerate. The helper may still answer.
        console.warn(`[lid-angle] WebHID unavailable: ${cause}`);
        if (!cancelled && !parameters.get("hid")) source = openStream();
      });

    function openStream() {
      const stream = new EventSource("/api/lid-angle");

      stream.addEventListener("angle", (event) => {
        track((JSON.parse(event.data) as LidAngleReading).angle);
      });

      // The server closes the stream after this, and EventSource would reconnect to a
      // route that is going to fail the same way, so stop listening.
      stream.addEventListener("sensor-error", (event) => {
        const { message } = JSON.parse(event.data) as { message: string };
        console.warn(`[lid-angle] ${message}`);
        setError(message);
        stream.close();
      });

      // Fires on a dropped connection, and on a connection that never opened. Anything
      // the server can explain already arrived as `sensor-error`; this is the transport
      // giving up. EventSource reconnects on its own unless it has closed for good.
      stream.addEventListener("error", () => {
        if (stream.readyState !== EventSource.CLOSED) return;
        const message = "Connection to /api/lid-angle closed.";
        console.warn(`[lid-angle] ${message}`);
        setError(message);
      });

      return stream;
    }

    return () => {
      cancelled = true;
      source?.close();
      stopHid.current?.();
      stopHid.current = null;
    };
  }, [track]);

  return {
    angleRef,
    error,
    simulated,
    connect: canConnect && !reading ? connect : null,
  };
}
