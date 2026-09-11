# Credits

This project stands on two pieces of prior work. Both are reimplemented here rather than
vendored, but the ideas, the hardware details and — for the shader — the structure of the
code are theirs.

## samhenrigold/LidAngleSensor

<https://github.com/samhenrigold/LidAngleSensor> · Apache License 2.0 · Copyright Sam Gold

A menu bar app that reads the MacBook lid angle sensor and, optionally, plays a creaking
door. The HID device-matching dictionary and the feature-report layout in
`native/lid-angle/src/LidAngleSensor.swift` come from it. See
[native/lid-angle/README.md](native/lid-angle/README.md) for what that involves and where
this implementation differs.

## jh3y/lid-plane

<https://github.com/jh3y/lid-plane> · MIT License · Copyright (c) 2026 Jhey

A menu bar app that holds your whole desktop at a fixed apparent angle as you move the
lid, blurring it progressively. The effect in `components/LidPlane.tsx` is a port of its
Metal shader to GLSL, and `components/lidAnchor.ts` is a port of its `AutoAnchor`. The
warp maths, the blur grading, the boundary feather and the anchor timings are all from
there.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
> THE USE OR OTHER DEALINGS IN THE SOFTWARE.
