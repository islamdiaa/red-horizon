import * as THREE from 'three';

/**
 * Shared holographic material (fresnel rim + rising scanlines). Used for the building
 * placement preview and for structures under construction.
 */
export function createHoloMaterial(color = 0x40d8ff): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uCut: { value: -100 },      // world Y below which the hologram is hidden (solid part takes over)
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 w = modelMatrix * vec4(transformed, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * objectNormal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCut, uFade; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        if (vW.y < uCut) discard;
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float scan = smoothstep(0.0, 0.08, fract(vW.y * 6.0 - uTime * 1.5)) * 0.35 + 0.65;
        float grid = max(step(0.96, fract(vW.x * 4.0)), step(0.96, fract(vW.z * 4.0))) * 0.25;
        float flicker = 0.92 + 0.08 * sin(uTime * 37.0 + vW.y * 11.0);
        float a = (0.1 + f * 0.6 + grid) * scan * flicker * uFade;
        gl_FragColor = vec4(uColor * (0.6 + f * 2.2), a);
      }`,
  });
}
