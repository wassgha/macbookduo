"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";

import { LidPlane } from "./LidPlane";
import { useLidAngle } from "./useLidAngle";

/** Distance from the camera to the image plane, in world units. */
const PLANE_DISTANCE = 5;

export default function LoginScene() {
  const { angleRef, simulated, connect } = useLidAngle({ log: true });

  return (
    <div id="scene">
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ fov: 45, position: [0, 0, PLANE_DISTANCE], near: 0.1, far: 100 }}
      >
        <Suspense fallback={null}>
          {/* A simulated fold has to hold its angle, so it opts out of auto-anchoring. */}
          <LidPlane image="/login.png" angleRef={angleRef} autoAnchor={!simulated} />
        </Suspense>
      </Canvas>

      {/* Only shown while nothing is supplying readings. The browser will not hand over
          a HID device without a gesture, so this cannot happen on its own. */}
      {connect && (
        <button type="button" className="connect" onClick={connect}>
          Connect lid sensor
        </button>
      )}
    </div>
  );
}
