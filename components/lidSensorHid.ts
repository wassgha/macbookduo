/**
 * Reads the lid angle sensor straight from the browser, with no helper process.
 *
 * Chromium's WebHID can reach the same device the native helper does, which makes the
 * helper optional wherever WebHID exists — including a deployment, where there is no
 * helper to run at all. The costs are that it is Chromium-only (no Safari, no Firefox)
 * and that the first read needs a click: the browser will not hand over a HID device
 * without the user picking it from a chooser.
 *
 * It does not read the device the way the helper does, and it cannot. The helper polls a
 * *feature* report, which works because IOKit will service that request even though the
 * device never declares such a report — `kIOHIDMaxFeatureReportSizeKey` on this
 * interface is 1, i.e. nothing beyond a report ID. WebHID validates reports against the
 * report descriptor, so `receiveFeatureReport` on it always fails with "Failed to receive
 * the feature report".
 *
 * What the descriptor does declare is the angle as an *input* report:
 *
 *     05 20        Usage Page (Sensors)
 *     09 8a        Usage (Orientation)
 *     a1 01        Collection (Application)
 *     85 01        Report ID (1)
 *     0a 7f 04     Usage (0x047f)
 *     46 68 01     Physical Maximum (360)
 *     26 68 01     Logical Maximum (360)
 *     75 09        Report Size (9 bits)
 *     95 01        Report Count (1)
 *     81 02        INPUT (Data, Variable, Absolute)
 *
 * So the browser subscribes instead of polling. The device pushes about once a second
 * while the lid is still, and faster while it moves.
 */

/** Apple's vendor ID and the lid sensor's product ID. */
const lidSensor = { vendorId: 0x05ac, productId: 0x8104 };

/** HID Sensor page, "Orientation" usage: the interface carrying the angle. */
const sensorCollection = { usagePage: 0x0020, usage: 0x008a };

/**
 * Narrow on purpose. This device exposes four HID interfaces — this one plus three
 * vendor-specific (0xFF00) — and only this one carries the angle. They have no product
 * name, so matching on vendor and product alone fills the chooser with four identical
 * "Unknown Device (05AC:8104)" rows, three of which are dead ends.
 */
const filters = [{ ...lidSensor, ...sensorCollection }];

/** The angle arrives on report 1. The interface declares others for other properties. */
const angleReportId = 1;

/** The declared field is 9 bits; the rest of the second byte is padding. */
const angleMask = 0x1ff;

/** Rejects a decode that landed wrong; the hinge stops well short of this. */
const implausibleAngle = 200;

/** How long to wait for the device's first push before saying something is wrong. */
const firstReportTimeout = 3000;

export function webHidAvailable() {
  return typeof navigator !== "undefined" && navigator.hid !== undefined;
}

/**
 * Decodes an input report into degrees, or null if it does not look like an angle.
 *
 * `HIDInputReportEvent.data` excludes the report ID, so the little-endian value starts
 * at byte 0 — unlike the helper's feature report, where the ID occupies byte 0.
 */
export function decodeInputAngle(data: DataView): number | null {
  if (data.byteLength < 2) return null;
  const degrees = data.getUint16(0, true) & angleMask;
  return degrees <= implausibleAngle ? degrees : null;
}

/** Names an interface for a log line, since these devices have no product name. */
function label(device: HIDDevice) {
  const usages = device.collections
    .map((c) => `${c.usagePage.toString(16)}/${c.usage.toString(16)}`)
    .join(",");
  return `${device.productName || "unnamed"} [${usages || "no collections"}]`;
}

function isSensorInterface(device: HIDDevice) {
  return (
    device.vendorId === lidSensor.vendorId &&
    device.productId === lidSensor.productId &&
    device.collections.some(
      (c) => c.usagePage === sensorCollection.usagePage && c.usage === sensorCollection.usage,
    )
  );
}

/**
 * Picks the sensor interface out of a set of devices and opens it.
 *
 * A grant covers every interface on the device, so this has to choose by collection
 * rather than take the first thing it is handed.
 */
async function openSensorInterface(devices: HIDDevice[]): Promise<HIDDevice | null> {
  const device = devices.find(isSensorInterface);
  if (!device) {
    if (devices.length > 0) {
      console.warn(
        `[lid-angle] none of these is the sensor interface: ${devices.map(label).join(", ")}`,
      );
    }
    return null;
  }

  try {
    if (!device.opened) await device.open();
    return device;
  } catch (cause) {
    console.warn(`[lid-angle] could not open ${label(device)}: ${cause}`);
    return null;
  }
}

/** The sensor, if this origin has already been granted it. Never prompts. */
export async function openGrantedSensor(): Promise<HIDDevice | null> {
  if (!navigator.hid) return null;
  return openSensorInterface(await navigator.hid.getDevices());
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

  // Granting one interface grants its siblings, so ask again for the full set and pick
  // the right one out of it rather than trusting whichever row was clicked.
  const granted = await navigator.hid.getDevices();
  return openSensorInterface(granted.length > 0 ? granted : chosen);
}

/**
 * Reports every angle the device pushes, until the returned function is called.
 *
 * The first report is logged with its raw bytes: this is the one assumption that cannot
 * be checked from here, and a surprise in the layout should be visible rather than show
 * up as a plausible wrong number.
 */
export function listenForAngles(
  device: HIDDevice,
  onAngle: (angle: number) => void,
): () => void {
  let first = true;

  const handler = (event: HIDInputReportEvent) => {
    if (event.reportId !== angleReportId) return;
    const angle = decodeInputAngle(event.data);
    if (angle === null) return;

    if (first) {
      first = false;
      const bytes = [...new Uint8Array(event.data.buffer)];
      console.log(`[lid-angle] WebHID connected to ${label(device)}: [${bytes}] -> ${angle}°`);
    }
    onAngle(angle);
  };

  device.addEventListener("inputreport", handler);

  // The device heartbeats about once a second even when still, so silence means the
  // subscription is not working rather than that the lid is not moving.
  const watchdog = setTimeout(() => {
    if (first) {
      console.warn(
        `[lid-angle] no input report from ${label(device)} in ${firstReportTimeout}ms; ` +
          "it opened but is not pushing reports",
      );
    }
  }, firstReportTimeout);

  return () => {
    clearTimeout(watchdog);
    device.removeEventListener("inputreport", handler);
    void device.close().catch(() => {});
  };
}
