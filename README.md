# Lid-aware login screen

A macOS lock screen screenshot, rendered with react-three-fiber, that holds its apparent
angle as you move the MacBook's lid — so it reads as a panel standing perpendicular to
the keyboard rather than as wallpaper stuck to the display. Movement blurs it,
progressively, and it settles back when you stop.

Needs a MacBook with a lid angle sensor — the 2019 16-inch MacBook Pro and most laptops
since. The angle can come from either of two places, see below; the helper wants the
Swift command line tools.

React is pinned to 19.2.x: `@react-three/fiber@9.7.0` declares `react >=19 <19.3`, so
19.3 fails to install without `--legacy-peer-deps`, which is a deployment waiting to
break. Widen it when fiber ships a release that allows 19.3.

```sh
npm install
npm run build:native   # the Swift helper that reads the sensor
npm run dev
```

The effect only runs in the closing direction — see below. Then move the lid, gently. Keep the base and your head still — the illusion assumes both.
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

## Two ways to read the sensor

**WebHID**, in the browser, with nothing installed. Chromium can open the same HID device
the helper does and pull the same feature report, which is the only thing that can work
in a deployment — there is no helper process to run on a server. The costs are that it is
Chromium-only, so no Safari and no Firefox, and that the browser will not hand over a HID
device without the user picking it from a chooser. Hence the Connect button, which
appears only while nothing is supplying readings. The grant is remembered per origin, so
it is asked once.

**The helper**, over Server-Sent Events. No click, no browser restrictions, and it works
while iterating locally, which is why it is the fallback rather than the other way round.

`useLidAngle` prefers an existing WebHID grant, falls back to the stream, and offers the
chooser if neither produced a reading.

## Working on it without touching the lid

| URL | Does |
| --- | --- |
| `/?lid=95` | Pins the angle to 95° and never opens the stream. |
| `/?lid=105&fold=40` | Pins 105°, then moves to 65° and holds there. |
| `/?hid=1` | Skips the stream, so the WebHID path can be tried where the helper would answer first. |

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

## Why it only holds while closing

The warp is not symmetric. Closing tilts the display towards you, the image keystones
away from you, and it reads as content standing still while the display moves around it.
Opening tilts the display away, which puts the anchored content plane between you and
the display: the rays converge instead, the keystone inverts, and the image just swells
and blurs. So `LidHold` in `components/lidAnchor.ts` renders nothing when the lid opens
wider than the anchor.

It also stops the anchor settling once the lid is shut past `closedBelow` (45°), where
the screen is not really visible any more. Otherwise the anchor would pin the content to
a plane nobody ever looked at, and opening the lid again would have to render that
inverted warp, saturated, for the whole sweep. Holding the anchor instead means opening
back up unwinds the same warp that closing built, reaching flat exactly as the lid
returns to where it started.

## Credit

The sensor reading and the effect both come from other people's work — see
[CREDITS.md](CREDITS.md).
