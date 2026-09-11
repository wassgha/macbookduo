# Lid-aware login screen

A macOS lock screen screenshot, rendered with react-three-fiber, that holds its apparent
angle as you move the MacBook's lid — so it reads as a panel standing perpendicular to
the keyboard rather than as wallpaper stuck to the display. Movement blurs it,
progressively, and it settles back when you stop.

Needs a MacBook with a lid angle sensor (2019 16-inch MacBook Pro and most laptops since)
and the Swift command line tools.

```sh
npm install
npm run build:native   # the Swift helper that reads the sensor
npm run dev
```

Then move the lid, gently. Keep the base and your head still — the illusion assumes both.
It also assumes the browser viewport is the whole display, so it is at its best in
fullscreen.

## How it fits together

| Piece | Does |
| --- | --- |
| `native/lid-angle` | Swift CLI. Reads the sensor over IOKit HID, prints NDJSON. |
| `app/api/lid-angle/route.ts` | Runs the CLI, forwards its stdout as Server-Sent Events. |
| `components/useLidAngle.ts` | Subscribes to that stream, keeps the latest angle in a ref. |
| `components/lidAnchor.ts` | Decides which angle the content is being held at. |
| `components/blurPyramid.ts` | Renders the blurred copies of the image, once, at startup. |
| `components/LidPlane.tsx` | The shader: warps and blurs the image by the lid movement. |
| `components/LoginScene.tsx` | The canvas. |

The angle is also logged to the browser console, and
`npm run lid-angle -- --once` prints it in the terminal.

## Working on it without touching the lid

| URL | Does |
| --- | --- |
| `/?lid=95` | Pins the angle to 95° and never opens the stream. |
| `/?lid=105&fold=40` | Pins 105°, then moves to 65° and holds there. |

The second one is the equivalent of lid-plane's "Simulate a Fold" and the only way to
keep the effect still long enough to screenshot it.

## Options

`LidPlane` takes `hold`, `blur`, `autoAnchor` and `perspective`, all matching lid-plane's
menu, though `perspective` defaults the other way here. It decides how the held content
is projected, and the two modes are not variations in strength — they are different
effects:

- **`perspective` on (default).** Traces a ray from an assumed eye position through each
  display pixel to the plane the content is anchored to. Rays through the top of the
  display travel further, so the image keystones: pinned at the hinge, narrowing towards
  the top, as though it were standing still while the display tilts around it.
- **`perspective` off**, which is lid-plane's default, treats those rays as parallel.
  That reduces to scaling the image by 1/cos of the movement about the hinge — the image
  grows upward and is cropped at the top, identically whether the lid opens or closes.
  Cheaper, and a convincing enough companion to the blur, but it is not the same
  illusion.

`EYE` in `components/LidPlane.tsx` is the assumed viewing position, in display heights.
There is no head tracking, so it is a guess, and it is the knob that sets how strong the
effect is.

## Credit

The sensor reading and the effect both come from other people's work — see
[CREDITS.md](CREDITS.md).
