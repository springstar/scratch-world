# renderer-threejs

Three.js rendering patterns for the scratch-world viewer (`viewer/src/renderer/scene-renderer.ts`).
Source: [Dexploarer/threejs-scene-builder](https://smithery.ai/skills/Dexploarer/threejs-scene-builder), adapted to this project.

---

## PBR Materials

```typescript
// Standard PBR
new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.5, normalMap, roughnessMap })

// Glass / transmission
new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0, transmission: 1, thickness: 0.5 })

// Glow / additive
new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })

// Toon shading
new THREE.MeshToonMaterial({ color })
```

## Lighting Setup (recommended 3-light rig)

```typescript
// Ambient
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// Sun (directional + shadow)
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 10, 5);
sun.castShadow = true;
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;  sun.shadow.camera.bottom = -10;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// Hemisphere (sky/ground fill)
scene.add(new THREE.HemisphereLight(0xffffbb, 0x080820, 0.3));
```

## Post-Processing

```typescript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { SSAOPass }       from 'three/examples/jsm/postprocessing/SSAOPass';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85));
composer.addPass(new SSAOPass(scene, camera));

// In render loop: composer.render() instead of renderer.render()
```

## Performance Optimization

```typescript
// Instanced mesh — use for many identical objects (trees, rocks, crowd)
const mesh = new THREE.InstancedMesh(geometry, material, count);
positions.forEach((pos, i) => {
  matrix.setPosition(pos);
  mesh.setMatrixAt(i, matrix);
});
mesh.instanceMatrix.needsUpdate = true;

// LOD — swap geometry at distance thresholds
const lod = new THREE.LOD();
lod.addLevel(highPolyMesh, 0);
lod.addLevel(lowPolyMesh, 50);
scene.add(lod);

// Frustum culling (manual, for dynamic objects)
const frustum = new THREE.Frustum();
frustum.setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
);
objects.forEach(o => { o.visible = frustum.intersectsObject(o); });
```

## Animation System

```typescript
// Setup
const mixer = new THREE.AnimationMixer(model);
const actions = new Map<string, THREE.AnimationAction>();
animations.forEach(clip => actions.set(clip.name, mixer.clipAction(clip)));

// Crossfade between animations
function crossFade(from: string, to: string, duration = 0.3) {
  actions.get(from)?.fadeOut(duration);
  actions.get(to)?.reset().fadeIn(duration).play();
}

// In render loop
mixer.update(clock.getDelta());
```

## GLTF Model Loading

```typescript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const gltf = await new Promise<GLTF>((res, rej) => loader.load(url, res, undefined, rej));
gltf.scene.traverse(child => {
  if (child instanceof THREE.Mesh) {
    child.castShadow = true;
    child.receiveShadow = true;
  }
});
scene.add(gltf.scene);
```

## Renderer Config (production quality)

```typescript
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2x
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
```

## Do / Don't

| Do | Don't |
|---|---|
| Use `BufferGeometry` | Create objects inside render loop |
| Dispose geometries + materials on removal | Forget to call `dispose()` |
| Use instanced meshes for 10+ identical objects | Use mesh colliders for every object |
| Limit shadow-casting lights to 1–2 | Add many `castShadow` lights |
| Cap `devicePixelRatio` at 2 | Render at native DPR on mobile |
| Use LOD for scene objects beyond 30 units | Load uncompressed models in production |
