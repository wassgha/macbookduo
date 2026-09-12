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

/**
 * HID Sensor page, "Orientation" usage.
 *
 * Narrow on purpose. This device exposes four HID interfaces — this one plus three
 * vendor-specific (0xFF00) — and only this one answers the feature report; the others
 * return "unsupported". They also carry no product name, so matching on vendor and
 * product alone fills the chooser with four identical "Unknown Device (05AC:8104)" rows,
 * three of which are dead ends.
 */
const filters = [{ ...lidSensor, usagePage: 0x0020, usage: 0x008a }];

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

/** Names an interface for a log line, since these devices have no product name. */
function label(device: HIDDevice) {
  const usages = device.collections
    .map((c) => `${c.usagePage.toString(16)}/${c.usage.toString(16)}`)
    .join(",");
  return `${device.productName || "unnamed"} [${usages || "no collections"}]`;
}

/**
 * Opens whichever of the given interfaces actually answers.
 *
 * The filter should mean only one candidate arrives, but a grant can cover an interface's
 * siblings, so this still probes rather than assuming — and says what it found when
 * nothing works, because four indistinguishable devices are impossible to debug blind.
 */
async function openAnswering(devices: HIDDevice[]): Promise<HIDDevice | null> {
  const attempts: string[] = [];

  for (const device of devices) {
    if (device.vendorId !== lidSensor.vendorId || device.productId !== lidSensor.productId) {
      continue;
    }
    try {
      if (!device.opened) await device.open();
      const report = await device.receiveFeatureReport(featureReportId);
      const bytes = [...new Uint8Array(report.buffer)];
      const angle = decodeAngle(report);
      // Requires a non-zero angle, not merely a decodable one: a silent interface can
      // answer with zeroes, and a lid being looked at is never shut.
      if (angle !== null && angle > 0) {
        console.log(`[lid-angle] WebHID reading ${label(device)}, [${bytes}] -> ${angle}°`);
        return device;
      }
      attempts.push(`${label(device)}: replied [${bytes}], no angle in it`);
      await device.close();
    } catch (cause) {
      attempts.push(`${label(device)}: ${cause instanceof Error ? cause.message : cause}`);
    }
  }

  if (attempts.length > 0) {
    console.warn(`[lid-angle] no interface answered:\n  ${attempts.join("\n  ")}`);
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

  const chosen = await navigator.hid.requestDevice({ filters });
  if (chosen.length === 0) {
    // Dismissing the chooser rejects instead, so this means it had nothing to offer:
    // either no sensor on this Mac, or the filter above is too narrow for it.
    console.warn(
      "[lid-angle] the chooser offered no device on the sensor page (usage 0x20/0x8a) " +
        `for ${lidSensor.vendorId.toString(16)}:${lidSensor.productId.toString(16)}`,
    );
    return null;
  }

  // Granting one interface can grant its siblings, so everything now on offer is worth a
  // try: if the chooser handed over a dead end, the answering one is likely beside it.
  const granted = await navigator.hid.getDevices();
  const candidates = [...chosen, ...granted.filter((device) => !chosen.includes(device))];
  return openAnswering(candidates);
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
