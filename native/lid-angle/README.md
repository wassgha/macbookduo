# lid-angle

A small macOS CLI that prints the MacBook lid angle as NDJSON, one object per line:

```console
$ npm run build:native
$ npm run lid-angle -- --once
{"angle":101.0,"t":1789107921.905696}
```

```
usage: lid-angle [--once] [--hz N] [--all]

  --once    print a single reading and exit
  --hz N    polling rate in Hz (default 30, max 240)
  --all     emit every poll instead of only when the angle changes
```

By default it only prints when the angle changes, so leaving it running is quiet until
you move the lid. `app/api/lid-angle/route.ts` runs it and forwards its stdout to the
browser over Server-Sent Events.

## How it reads the sensor

The lid angle sensor is an Apple HID device (vendor `0x05AC`, product `0x8104`) on the
HID Sensor usage page (`0x0020`), usage "Orientation" (`0x008A`). It does not send input
events — the angle lives in **feature report 1**, as a little-endian `UInt16` of degrees
in bytes 1–2, so it has to be polled with `IOHIDDeviceGetReport`.

Two things that are easy to get wrong:

- The match returns **several HID interfaces** on the same physical device and most of
  them answer `kIOReturnUnsupported`. Each one has to be probed; the one that returns a
  reading is the sensor.
- Closing the `IOHIDManager` **invalidates the device handles it handed out**, so a device
  opened during discovery silently stops answering. It has to be reopened after the
  manager is gone.

No entitlements, code signing, or TCC permission prompts are involved — reading a feature
report from this device is not treated as input monitoring.

## Hardware support

Introduced with the 2019 16-inch MacBook Pro; newer laptops generally have it, and the
13-inch MacBook Pro, pre-M2 MacBook Air, and desktops do not. Rather than carrying a
model table, this tool just probes: if no interface returns a reading it exits non-zero
with an explanation on stderr.

## Build

`./build.sh`, which shells out to `swiftc` — there is no SwiftPM manifest on purpose,
because the Command Line Tools' bundled `PackageDescription` fails to link one and this
is two dependency-free files. Output goes to `bin/lid-angle` (gitignored).

## Credit

The device-matching dictionary and the feature-report layout come from
[samhenrigold/LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor)
(Apache-2.0), which is a menu bar app — a creaking-door sound effect and all — for the
same sensor. The code here is a rewrite down to a headless CLI: no SwiftUI, no audio, no
velocity smoothing, and discovery restructured as described above.
