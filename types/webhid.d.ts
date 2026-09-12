/**
 * The slice of WebHID this project uses.
 *
 * TypeScript's DOM library does not declare WebHID — it is a WICG spec implemented in
 * Chromium only — and pulling in @types/w3c-web-hid for five members is not worth the
 * dependency. Widen this if more of the API gets used, against
 * https://wicg.github.io/webhid/
 */
interface HIDCollectionInfo {
  readonly usagePage: number;
  readonly usage: number;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  /** The report's bytes, excluding the report ID. */
  readonly data: DataView;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly collections: readonly HIDCollectionInfo[];
  addEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HID {
  /** Devices this origin has already been granted; no user gesture needed. */
  getDevices(): Promise<HIDDevice[]>;
  /** Shows the browser's device chooser. Must be called from a user gesture. */
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid?: HID;
}
