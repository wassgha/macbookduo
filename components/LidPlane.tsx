"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

import { LidHold } from "./lidAnchor";
import { blurSigmas, buildBlurPyramid } from "./blurPyramid";

/**
 * Holds the image at a fixed apparent angle while the lid moves around it, so it reads
 * as a panel standing perpendicular to the keyboard rather than as wallpaper stuck to
 * the screen.
 *
 * The approach — and the shader this is a port of — comes from
 * [jh3y/lid-plane](https://github.com/jh3y/lid-plane) (MIT), a menu bar app that does
 * this to your whole desktop. Two ideas do the work:
 *
 * 1. **The warp is an inverse ray cast, not a rotated mesh.** For each pixel of the
 *    physical display, the shader works out where that pixel sits in space once the lid
 *    has tilted by `delta`, draws a line from the viewer's eye through it, and samples
 *    the image where that line crosses the plane the content is anchored to. Doing it
 *    backwards in UV space means one full-screen quad, no geometry, and no camera work.
 * 2. **Progressive blur sells it.** Movement blurs the image, more towards the top of
 *    the display than at the hinge, and the image's own outer edge softens instead of
 *    ending in a hard line. Without it the warp reads as a flat squash.
 *
 * The one real departure: lid-plane rebuilds its blur levels every frame, because it is
 * blurring a live desktop capture. This image never changes, so the pyramid is rendered
 * once at startup (see blurPyramid.ts) and the shader only blends between the levels.
 */

/**
 * Where the viewer's eye sits, in units of display height, with the hinge at the origin.
 *
 * The distance is the one parameter that decides how strong the effect is, and it is a
 * guess about the viewer — there is no head tracking here. A 14-inch MacBook Pro's
 * display is about 196 mm tall, so 2.6 is roughly 510 mm away: normal laptop viewing
 * distance.
 *
 * lid-plane assumes 1.6 (about 310 mm). That is close enough to the screen that past
 * ~35° of movement the eye ray runs near-parallel to the content and the image smears;
 * backing the eye off keeps the keystone growing smoothly all the way to the clamp.
 */
const EYE = "vec3(0.0, 0.65, 2.6)";

/**
 * Shown outside the image once the warp has pulled its edges into view.
 *
 * Black, so the feathered edge fades into the page behind it. lid-plane uses a faint
 * blue-grey here instead, which makes sense when the overlay sits over a lit desktop.
 */
const SURROUND = "vec3(0.0)";

/** Time constant for easing `uDelta` towards the sensor, in seconds. */
const SMOOTHING = 0.08;

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  /** Progressively blurrier copies of uMap, at the sigmas in blurPyramid.ts. */
  uniform sampler2D uBlur1;
  uniform sampler2D uBlur2;
  uniform sampler2D uBlur3;
  uniform sampler2D uBlur4;
  /** Texture size in pixels, for turning blur radii into pixels. */
  uniform vec2 uImageSize;
  /** Cover-crop of the image into the content rectangle: xy scale, zw offset. */
  uniform vec4 uCrop;
  /** Lid movement away from the anchor, in radians. Positive as the lid closes. */
  uniform float uDelta;
  /** Aspect ratio of the display. */
  uniform float uAspect;
  /** Blur gain: 0 disables it. */
  uniform float uBlur;
  /** 0 = no warp, 1 = hold the angle, 2 = hold the angle with perspective taper. */
  uniform float uHold;

  varying vec2 vUv;

  void main() {
    // Flipped to put the origin at the top left, so uv.y runs with the display and
    // the height can be measured up from the hinge.
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float height = 1.0 - uv.y;

    // Bounds how far the effect can run: about 37 degrees of opening, 72 of closing.
    float a = clamp(uDelta, -0.65, 1.25);

    if (uHold > 0.5) {
      vec3 eye = ${EYE};
      // Where this pixel of the display has swung to, in the frame of the anchored
      // content: the display is a rectangle hinged along x, rotated by the delta.
      vec3 physical = vec3((uv.x - 0.5) * uAspect, height * cos(a), height * sin(a));
      // Walk the eye ray to where it crosses the content plane at z = 0. This is the
      // part that makes the content look like it is standing still: rays through the top
      // of the display have further to travel, so they land wider apart on the content,
      // and the image keystones as though leaning away from the display.
      //
      // uHold == 1 treats the rays as parallel instead, which is lid-plane's default. It
      // costs nothing and it is not the same illusion: it reduces to scaling the image
      // by 1/cos(a) about the hinge, identical whether the lid opens or closes.
      float t = uHold > 1.5 ? eye.z / max(0.25, eye.z - physical.z) : 1.0;
      vec3 hit = eye + t * (physical - eye);
      uv = vec2(hit.x / uAspect + 0.5, 1.0 - hit.y);
    }

    // Radius varies across the surface as well as over time: barely anything at the
    // hinge, most at the top of the display, and all of it scaled by how far the lid has
    // travelled. Expressed as a Gaussian sigma per 1000 pixels of image height, the
    // units the blur levels are cut at.
    float radius = uBlur * smoothstep(0.08, 1.0, height) * abs(sin(a)) * 65.0;
    float sigmaPixels = radius * uImageSize.y / 1000.0;

    // Undo the flip above, then cover-crop into the image.
    vec2 texUv = vec2(uv.x, 1.0 - uv.y) * uCrop.xy + uCrop.zw;

    // Cross-fade between the sharp image and the pyramid, band by band.
    vec3 color;
    if (radius < 2.0) {
      color = mix(texture2D(uMap, texUv).rgb, texture2D(uBlur1, texUv).rgb, radius / 2.0);
    } else if (radius < 6.0) {
      color = mix(texture2D(uBlur1, texUv).rgb, texture2D(uBlur2, texUv).rgb, (radius - 2.0) / 4.0);
    } else if (radius < 16.0) {
      color = mix(texture2D(uBlur2, texUv).rgb, texture2D(uBlur3, texUv).rgb, (radius - 6.0) / 10.0);
    } else {
      color = mix(texture2D(uBlur3, texUv).rgb, texture2D(uBlur4, texUv).rgb, clamp((radius - 16.0) / 24.0, 0.0, 1.0));
    }

    // Feather the image's own boundary over the same radius, so blurred content does not
    // end in a razor-sharp rectangle. Three sigma either side approximates the Gaussian
    // falloff; fwidth keeps it at least a pixel wide when there is no blur.
    vec2 feather = max(vec2(3.0 * sigmaPixels) / uImageSize, fwidth(uv));
    vec2 coverage = smoothstep(-feather, feather, uv)
                  * (1.0 - smoothstep(1.0 - feather, 1.0 + feather, uv));
    float mask = coverage.x * coverage.y;

    gl_FragColor = vec4(mix(${SURROUND}, color, mask), 1.0);
    #include <colorspace_fragment>
  }
`;

export type LidPlaneProps = {
  /** Image to hold, resolved from `public/`. */
  image: string;
  /** Live lid angle in degrees, from `useLidAngle`. */
  angleRef: RefObject<number | null>;
  /** Hold the content's angle as the lid moves. */
  hold?: boolean;
  /**
   * Trace real eye rays, rather than assuming parallel ones.
   *
   * On, because it is what makes the content read as held in place; lid-plane has it off
   * by default. See EYE, and the note in the shader.
   */
  perspective?: boolean;
  /** Blur the content progressively as the lid moves. */
  blur?: boolean;
  /** Settle back to flat once the lid has been still for a moment. */
  autoAnchor?: boolean;
};

export function LidPlane({
  image,
  angleRef,
  hold = true,
  perspective = true,
  blur = true,
  autoAnchor = true,
}: LidPlaneProps) {
  const texture = useTexture(image);
  const viewport = useThree((state) => state.viewport);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    // The shader samples explicit mip levels, so the chain has to exist and has to be
    // filtered between levels.
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [texture, gl]);

  // Built here rather than declared as <shaderMaterial uniforms={...} />, because
  // react-three-fiber clones a `uniforms` prop: the material ends up holding copies of
  // the value holders, and every write from the frame loop lands on an orphan.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uMap: { value: texture },
          uImageSize: { value: new THREE.Vector2(1, 1) },
          uCrop: { value: new THREE.Vector4(1, 1, 0, 0) },
          uDelta: { value: 0 },
          uAspect: { value: 1 },
          uBlur: { value: 0 },
          uHold: { value: 0 },
          // Stand-ins until the pyramid is built; a sharp level just means no blur.
          uBlur1: { value: texture },
          uBlur2: { value: texture },
          uBlur3: { value: texture },
          uBlur4: { value: texture },
        },
      }),
    [texture],
  );

  useEffect(() => () => material.dispose(), [material]);

  // The image is static, so the blur levels are rendered once here rather than every
  // frame. Until they land the shader keeps sampling the sharp texture.
  useEffect(() => {
    const source = texture.image as { height: number };
    const sigmas = blurSigmas.map((sigma) => (sigma * source.height) / 1000);
    const pyramid = buildBlurPyramid(gl, texture, sigmas);

    const uniforms = material.uniforms;
    pyramid.levels.forEach((level, index) => {
      uniforms[`uBlur${index + 1}`].value = level;
    });

    return () => {
      pyramid.levels.forEach((_, index) => {
        uniforms[`uBlur${index + 1}`].value = texture;
      });
      pyramid.dispose();
    };
  }, [texture, gl, material]);

  // Cover-crop the image into the display rectangle, the way `background-size: cover`
  // would: match the tighter axis and centre the overflow off-screen.
  useEffect(() => {
    const source = texture.image as { width: number; height: number };
    const imageAspect = source.width / source.height;
    const displayAspect = size.width / size.height;

    const [scaleX, scaleY] =
      displayAspect > imageAspect
        ? [1, imageAspect / displayAspect]
        : [displayAspect / imageAspect, 1];

    const uniforms = material.uniforms;
    uniforms.uCrop.value.set(scaleX, scaleY, (1 - scaleX) / 2, (1 - scaleY) / 2);
    uniforms.uAspect.value = displayAspect;
    uniforms.uImageSize.value.set(source.width, source.height);
  }, [texture, size, material]);

  useEffect(() => {
    material.uniforms.uBlur.value = blur ? 1 : 0;
    material.uniforms.uHold.value = hold ? (perspective ? 2 : 1) : 0;
  }, [blur, hold, perspective, material]);

  const lidHold = useRef<LidHold | null>(null);
  const target = useRef(0);

  useFrame((state, dt) => {
    const angle = angleRef.current;
    if (angle !== null) {
      const now = state.clock.elapsedTime;
      lidHold.current ??= new LidHold(angle, now);
      target.current = THREE.MathUtils.degToRad(
        lidHold.current.update(angle, now, autoAnchor),
      );
    }

    // Ease towards the sensor rather than following it directly: the readings are whole
    // degrees, and stepping between them is visible as a stutter in the warp.
    const delta = material.uniforms.uDelta;
    delta.value += (target.current - delta.value) * (1 - Math.exp(-dt / SMOOTHING));
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
