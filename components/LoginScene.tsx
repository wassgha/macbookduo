"use client";

import { Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

/** Distance from the camera to the image plane, in world units. */
const PLANE_DISTANCE = 5;

/**
 * The login image on a plane, scaled so it covers the viewport the way
 * `background-size: cover` would (fill it, crop the overflowing axis).
 */
function LoginImage() {
  const texture = useTexture("/login.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // `viewport` is measured at the origin, which is where the plane sits.
  const viewportWidth = useThree((state) => state.viewport.width);
  const viewportHeight = useThree((state) => state.viewport.height);

  const image = texture.image as { width: number; height: number };
  const imageAspect = image.width / image.height;
  const viewportAspect = viewportWidth / viewportHeight;

  const [width, height] =
    viewportAspect > imageAspect
      ? [viewportWidth, viewportWidth / imageAspect]
      : [viewportHeight * imageAspect, viewportHeight];

  return (
    <mesh scale={[width, height, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export default function LoginScene() {
  return (
    <div id="scene">
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ fov: 45, position: [0, 0, PLANE_DISTANCE], near: 0.1, far: 100 }}
      >
        <Suspense fallback={null}>
          <LoginImage />
        </Suspense>
      </Canvas>
    </div>
  );
}
