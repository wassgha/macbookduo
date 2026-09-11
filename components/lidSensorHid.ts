/**
 * Reads the lid angle sensor straight from the browser, with no helper process.
 *
 * Chromium's WebHID can open the same device the native helper does and pull the same
 * feature report, which makes the helper optional wherever WebHID exists — including a
 * deployment, where there is no helper to run at all. The catch is that it is
 * Chromium-only (no Safari, no Firefox) and the first read needs a click: the browser
 * will not hand over a HID device without the user picking it from a chooser.
 */

/** Apple's vendor ID and the lid sensor's product ID. */
const lidSensor = { vendorId: 0x05ac, productId: 0x8104 };

/** The sensor answers on feature report 1. */
const featureReportId = 1;

/** HID Sensor page, "Orientation" usage — the interface that carries the angle. */
const filters = [{ ...lidSensor, usagePage: 0x0020, usage: 0x008a }, { ...lidSensor }];

/** Rejects a decode that landed on the wrong byte; the hinge stops well short of this. */
const implausibleAngle = 200;

export function webHidAvailable() {
  return typeof navigator !== "undefined" && navigator.hid !== undefined;
}

/**
 * Decodes the angle in degrees from a feature report, or null if it does not look like
 * one.
 *
 * Chromium puts the report ID in byte 0 here, unlike `sendFeatureReport` where it is a
 * separate argument, so the little-endian value normally starts at byte 1. That is
 * checked rather than assumed, because reading from the wrong offset yields a number
 * that looks plausible instead of failing.
 */
export function decodeAngle(report: DataView): number | null {
  const offset = report.byteLength >= 3 && report.getUint8(0) === featureReportId ? 1 : 0;
  if (report.byteLength < offset + 2) return null;
  const degrees = report.getUint16(offset, true);
  return degrees <= implausibleAngle ? degrees : null;
}

/**
 * Opens whichever of the device's interfaces actually answers.
 *
 * The same probe the native side has to do: this device exposes four HID interfaces —
 * one on the sensor page and three vendor-specific — and only one returns the report.
 */
async function openAnswering(devices: HIDDevice[]): Promise<HIDDevice | null> {
  for (const device of devices) {
    if (device.vendorId !== lidSensor.vendorId || device.productId !== lidSensor.productId) {
      continue;
    }
    try {
      if (!device.opened) await device.open();
      const report = await device.receiveFeatureReport(featureReportId);
      const angle = decodeAngle(report);
      // Requires a non-zero angle, not merely a decodable one: a silent interface can
      // answer with zeroes, and a lid being looked at is never shut.
      if (angle !== null && angle > 0) {
        console.log(
          `[lid-angle] WebHID reading ${device.productName || "the sensor"}, ` +
            `report [${[...new Uint8Array(report.buffer)].join(", ")}] -> ${angle}°`,
        );
        return device;
      }
      await device.close();
    } catch {
      // This interface will not answer. Try the next.
    }
  }
  return null;
}

/** The sensor, if this origin has already been granted it. Never prompts. */
export async function openGrantedSensor(): Promise<HIDDevice | null> {
  if (!navigator.hid) return null;
  return openAnswering(await navigator.hid.getDevices());
}

/** Shows the chooser and opens what comes back. Must be called from a user gesture. */
export async function requestSensor(): Promise<HIDDevice | null> {
  if (!navigator.hid) return null;
  return openAnswering(await navigator.hid.requestDevice({ filters }));
}

/**
 * Polls `device` and reports each angle until the returned function is called.
 *
 * Reads are serialised: at 30 Hz a slow round trip would otherwise queue up behind
 * itself.
 */
export function pollSensor(
  device: HIDDevice,
  hz: number,
  onAngle: (angle: number) => void,
): () => void {
  let stopped = false;
  let inFlight = false;

  const timer = setInterval(async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const angle = decodeAngle(await device.receiveFeatureReport(featureReportId));
      if (angle !== null && !stopped) onAngle(angle);
    } catch {
      // A dropped read is not fatal; the next tick tries again.
    } finally {
      inFlight = false;
    }
  }, 1000 / hz);

  return () => {
    stopped = true;
    clearInterval(timer);
    void device.close().catch(() => {});
  };
}
