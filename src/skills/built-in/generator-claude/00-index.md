# generator-claude

## Mandatory rules

1. **Every call must have `sceneCode`** — never pass only `sceneData` JSON objects.
2. **`stdlib.setupLighting()` is always the first call** — without it the scene is pitch black.
3. **`hdri: true` for every outdoor scene** — photographic sky, zero rendering cost.
4. **GLTF for humans, animals, vehicles** — `stdlib.placeAsset(id)` for cataloged assets, `find_gltf_assets` for discovery, `stdlib.loadModel(url)` for direct URLs. Building characters from BoxGeometry is prohibited. See `07-asset-catalog.md`.
5. **Named real-world landmark? Use real geometry** — try `stdlib.loadModel()` first; use `stdlib.makeGateway()` for arched monuments / triumphal gates; never substitute with `makeBuilding()`. A box cannot represent an arch.
6. **Named real-world place or famous scene? Run Research first** — see `06-research.md` BEFORE the 5-step pre-analysis in `01-pre-analysis.md`.
7. **Use the layout solver** — `stdlib.useLayout(type)` for all structural placement. Never hardcode x,y,z for structural elements.
8. **Three depth layers** — every scene must have foreground (0–6 m), midground (6–25 m), and background (25–200 m) objects. See `08-composition.md`.
9. **`stdlib.makeTree()` for ALL trees — no exceptions** — never write custom tree functions (rainTree, makeForestTree, etc.) using raw SphereGeometry crowns or CylinderGeometry trunks. `stdlib.makeTree()` produces leaf cards via InstancedMesh with bark PBR; hand-rolled sphere-crown trees are strictly worse. Call it for every individual tree:
   ```javascript
   stdlib.makeTree({ position: { x: 5, y: 0, z: -8 } });
   stdlib.makeTree({ position: { x: -3, y: 0, z: -15 }, scale: 1.4 });
   ```
   For dense forests (20+ trees), use a loop — never a custom geometry function.
10. **`MeshStandardMaterial` minimum for all surfaces** — `MeshLambertMaterial` is prohibited. It ignores PBR and produces flat plastic-looking surfaces regardless of lighting. Use `stdlib.makeMat()` (returns MeshStandardMaterial) or `stdlib.makePhysicalMat()` for special surfaces.
