import * as THREE from "three";

/**
 * Builds a set of progressively blurrier copies of a texture, for a shader to blend
 * between.
 *
 * These are the levels lid-plane cuts its blur at — Gaussian sigmas in pixels per 1000
 * pixels of image height. It rebuilds them every frame from a live desktop capture with
 * Metal Performance Shaders; our image never changes, so they are built once.
 */
export const blurSigmas = [2, 6, 16, 40];

/**
 * Sigma, in texels, that each level is rendered at.
 *
 * A level only has to resolve its own blur, so wide blurs are rendered small and
 * magnified back — at four texels per sigma the texture is smooth over several texels
 * and bilinear magnification has nothing left to crease.
 *
 * This is also what keeps the mip chain's artefacts out: the downsample that feeds each
 * level is a mip sample, which speckles thin high-contrast features, and a blur this
 * wide relative to the texel grid averages that speckle away.
 */
const sigmaTexels = 4;

/** Taps either side of centre. Covers three sigma at the resolution above. */
const tapRadius = 12;

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  /** One texel along the axis being blurred, in UV. */
  uniform vec2 uStep;
  /** Gaussian sigma, in texels of the target. */
  uniform float uSigma;
  /** Mip level to read, for the pass that also downsamples. */
  uniform float uLod;

  varying vec2 vUv;

  void main() {
    vec3 sum = vec3(0.0);
    float total = 0.0;

    for (int i = -${tapRadius}; i <= ${tapRadius}; i++) {
      float offset = float(i);
      float weight = exp(-0.5 * offset * offset / (uSigma * uSigma));
      sum += textureLod(uMap, vUv + uStep * offset, uLod).rgb * weight;
      total += weight;
    }

    gl_FragColor = vec4(sum / total, 1.0);
  }
`;

/** A blurred copy of the source, and the means to release it. */
export type BlurPyramid = {
  levels: THREE.Texture[];
  dispose: () => void;
};

/**
 * Renders one blurred copy of `source` per entry in `sigmas` (in source pixels).
 *
 * Runs two separable passes per level, straight away rather than in the frame loop —
 * the caller can keep drawing the sharp image until the levels show up.
 */
export function buildBlurPyramid(
  renderer: THREE.WebGLRenderer,
  source: THREE.Texture,
  sigmas: number[],
): BlurPyramid {
  const image = source.image as { width: number; height: number };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uMap: { value: source },
      uStep: { value: new THREE.Vector2() },
      uSigma: { value: 1 },
      uLod: { value: 0 },
    },
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene().add(quad);
  const camera = new THREE.Camera();

  const createTarget = (width: number, height: number) =>
    new THREE.WebGLRenderTarget(width, height, {
      // Half float rather than bytes: these hold linear-light values, and 8 bits of
      // linear banks all its precision in the highlights and bands the shadows.
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });

  const previousTarget = renderer.getRenderTarget();
  const outputs: THREE.WebGLRenderTarget[] = [];

  for (const sigma of sigmas) {
    const scale = Math.min(1, sigmaTexels / sigma);
    const width = Math.max(2, Math.round(image.width * scale));
    const height = Math.max(2, Math.round(image.height * scale));

    const scratch = createTarget(width, height);
    const output = createTarget(width, height);

    // Horizontal, reading the source at the mip level matching this resolution so the
    // downsample is prefiltered rather than point-sampled.
    material.uniforms.uMap.value = source;
    material.uniforms.uLod.value = Math.max(0, Math.log2(image.width / width));
    material.uniforms.uSigma.value = sigma * scale;
    material.uniforms.uStep.value.set(1 / width, 0);
    renderer.setRenderTarget(scratch);
    renderer.render(scene, camera);

    // Vertical, over the result of the first pass.
    material.uniforms.uMap.value = scratch.texture;
    material.uniforms.uLod.value = 0;
    material.uniforms.uStep.value.set(0, 1 / height);
    renderer.setRenderTarget(output);
    renderer.render(scene, camera);

    scratch.dispose();
    outputs.push(output);
  }

  renderer.setRenderTarget(previousTarget);

  quad.geometry.dispose();
  material.dispose();

  return {
    levels: outputs.map((target) => target.texture),
    dispose: () => outputs.forEach((target) => target.dispose()),
  };
}
