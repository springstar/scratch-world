---
name: webgpu-threejs-tsl
description: Three.js WebGPU renderer + TSL node materials, compute shaders, TSL post-processing. Use when creating node-based materials, GPU compute, or TSL post-processing effects in sceneCode.
---

# Three.js WebGPU + TSL

The viewer uses `WebGPURenderer` with the TSL (Three.js Shading Language) node system.
All `sceneCode` runs with `THREE` from `three/webgpu` and the `tsl` variable (all TSL exports).

## Sandbox variables in sceneCode

```javascript
// Available globals in sceneCode:
// THREE    — import * as THREE from "three/webgpu"  (WebGPURenderer, NodeMaterials, etc.)
// tsl      — import * as TSL from "three/tsl"       (all TSL nodes)
// scene    — THREE.Scene proxy (add/remove go to codeGroup)
// camera   — THREE.PerspectiveCamera
// renderer — THREE.WebGPURenderer
// controls — OrbitControls
// animate  — (cb: (delta: number) => void) => void  (register per-frame callback)
// WaterMesh — three/addons/objects/WaterMesh.js
```

## NodeMaterial — replacing ShaderMaterial

```javascript
// TSL replaces GLSL shaders with composable node expressions.
// Import from tsl variable (available in sceneCode):
const { color, normalLocal, mix, uniform, float, vec3, sin, cos,
        time, oscSine, uv, texture } = tsl;

// Slope-blended terrain (replaces onBeforeCompile)
const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
const blend = normalLocal.y.smoothstep(0.3, 0.8);
mat.colorNode = mix(color(0x8b6040), color(0x3a6a2a), blend);

// Animated emissive (neon glow)
const mat2 = new THREE.MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.8 });
mat2.emissiveNode = color(0xff00ff).mul(oscSine(time.mul(2.0)).remapClamp(0, 1, 0.3, 1.5));

// Color from UV gradient
const mat3 = new THREE.MeshStandardNodeMaterial();
mat3.colorNode = vec3(uv().x, uv().y, float(0.5));
```

## GPU Compute

```javascript
// Particle system with GPU compute
const { storage, instanceIndex, Fn, If, vec4, vec3, float } = tsl;
const PARTICLE_COUNT = 10000;

const positionBuffer = new THREE.StorageBufferAttribute(PARTICLE_COUNT, 4);
const velocityBuffer = new THREE.StorageBufferAttribute(PARTICLE_COUNT, 4);

const positionNode = storage(positionBuffer, "vec4", PARTICLE_COUNT);
const velocityNode = storage(velocityBuffer, "vec4", PARTICLE_COUNT);

const updateCompute = Fn(() => {
  const pos = positionNode.element(instanceIndex);
  const vel = velocityNode.element(instanceIndex);
  vel.addAssign(vec4(0, -0.001, 0, 0)); // gravity
  pos.addAssign(vel);
  // Reset when below ground
  If(pos.y.lessThan(-5), () => {
    pos.assign(vec4(
      float(Math.random() * 20 - 10), float(10), float(Math.random() * 20 - 10), 1
    ));
  });
})().compute(PARTICLE_COUNT);

// Render as points
const particleMat = new THREE.SpriteNodeMaterial({ sizeAttenuation: true });
particleMat.positionNode = positionNode.element(instanceIndex).xyz;
particleMat.colorNode = color(0x88aaff);
const points = new THREE.Mesh(new THREE.BufferGeometry(), particleMat);
points.count = PARTICLE_COUNT;
scene.add(points);

animate((delta) => {
  renderer.computeAsync(updateCompute);
});
```

## TSL PostProcessing

The viewer uses `THREE.PostProcessing` with TSL nodes. The full pipeline is set up automatically.
For `sceneCode`, you can create custom materials with node-based effects instead.

```javascript
// Custom post effect via fullscreen quad (for sceneCode)
import { pass, bloom } from "three/tsl";
// Note: PostProcessing is managed by the viewer — use NodeMaterial effects instead.
```

## Common TSL Nodes Reference

| Node | Description |
|---|---|
| `color(hex)` | Constant color node |
| `uniform(val)` | Mutable uniform (call `.value = x` to update) |
| `float(n)` | Constant float |
| `vec2/vec3/vec4(...)` | Vector constructors |
| `time` | Current time in seconds (auto-increments) |
| `oscSine(t)` | Sine oscillator [0–1] |
| `normalLocal` | Object-space normal |
| `normalWorld` | World-space normal |
| `normalView` | View-space normal |
| `uv()` | Primary UV coordinates |
| `positionWorld` | World-space position |
| `cameraPosition` | Camera world position |
| `.mul(n)` | Multiply |
| `.add(n)` | Add |
| `.smoothstep(lo, hi)` | Smoothstep |
| `.mix(a, b)` | Lerp (or use `mix(a, b, t)`) |
| `.remapClamp(inLo, inHi, outLo, outHi)` | Remap range |
| `sin(n)`, `cos(n)`, `abs(n)` | Math functions |
| `Fn(() => { ... })` | TSL function builder |
| `If(cond, () => {})` | Conditional |
| `storage(buf, type, count)` | GPU storage buffer |
| `instanceIndex` | Current instance index in compute |

## SkyMesh — WebGPU Sky

```javascript
// SkyMesh exposes TSL uniform properties directly
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
const sky = new SkyMesh();
sky.scale.setScalar(450000);
sky.turbidity.value = 4;
sky.rayleigh.value = 1;
sky.mieCoefficient.value = 0.003;
sky.mieDirectionalG.value = 0.75;
sky.sunPosition.value.set(0.3, 0.8, 0.2);
scene.add(sky);
```

## WaterMesh — WebGPU Water

```javascript
// WaterMesh auto-animates via TSL time node — no manual animation needed
const waterNormals = new THREE.TextureLoader().load(
  "https://threejs.org/examples/textures/waternormals.jpg",
  (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
);
const water = new WaterMesh(new THREE.PlaneGeometry(100, 100), {
  waterNormals,
  waterColor: 0x4a8fa8,
  distortionScale: 4,
});
water.rotation.x = -Math.PI / 2;
scene.add(water);
// No animate() needed — WaterMesh uses built-in TSL time node
```

## Cyberpunk neon example

```javascript
const { color, uniform, time, oscSine, normalWorld, mix, sin, float } = tsl;

// Neon floor grid
const gridMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.1, metalness: 0.9 });
const pulse = oscSine(time.mul(1.5));
gridMat.emissiveNode = color(0x00ffff).mul(pulse.remapClamp(0, 1, 0.2, 1.0));

// Holographic scanline material
const holoMat = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide });
const scanLine = sin(positionWorld.y.mul(20.0).add(time.mul(3.0))).remapClamp(-1, 1, 0.2, 0.8);
holoMat.colorNode = color(0x00ff88).mul(scanLine);
holoMat.opacityNode = scanLine.mul(0.6);
```
