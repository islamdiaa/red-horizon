/** GLSL chunks shared by the weather layers (GLSL ES 3.00; three.js compiles ShaderMaterials as WebGL2). */

export const HASH_GLSL = /* glsl */ `
uint wx_u(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float wx_h(uint x) { return float(wx_u(x) >> 8u) * (1.0 / 16777216.0); }
vec3 wx_rand3(vec3 s) {
  uint k = wx_u(uint(s.x * 16777215.0)) ^ wx_u(uint(s.y * 16777215.0) + 0x9e3779b9u) ^ wx_u(uint(s.z * 16777215.0) + 0x632be5abu);
  return vec3(wx_h(k), wx_h(k + 1u), wx_h(k + 2u));
}
vec4 wx_lane(float r) { return vec4(equal(vec4(floor(r * 4.0)), vec4(0.0, 1.0, 2.0, 3.0))); }
`;

/** Camera-following volume, see volume.ts. */
export const VOLUME_GLSL = /* glsl */ `
uniform mat3 uM;
uniform vec3 uB;
uniform vec3 uCam;
uniform vec4 uPhX;
uniform vec4 uPhY;
uniform vec4 uPhZ;
vec3 wx_norm(vec3 seed, vec4 lm) {
  vec3 ph = vec3(dot(uPhX, lm), dot(uPhY, lm), dot(uPhZ, lm));
  return fract(seed + ph - uCam);
}
vec3 wx_vol(vec3 n) { return uB + uM * (n - vec3(0.5, 0.5, 0.0)); }
`;

export const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uHeight;
uniform vec4 uHX;
/** x = ground height, y = blurred ground height. */
vec2 wx_height(vec2 xz) { return texture(uHeight, xz * uHX.xy + uHX.zw).rg; }
`;

/** Collapse a vertex so the primitive is clipped away (no fragments). */
export const COLLAPSE = 'gl_Position = vec4(0.0, 0.0, -2.0, 1.0)';
