# generator-claude

## Mandatory rules

1. **Every call must have `sceneCode`** — never pass only `sceneData` JSON objects.
2. **`stdlib.setupLighting()` is always the first call** — without it the scene is pitch black.
3. **`hdri: true` for every outdoor scene** — photographic sky, zero rendering cost.
4. **GLTF for humans, animals, vehicles** — `stdlib.loadModel(url)`. Building characters from BoxGeometry is prohibited. See Asset Catalog in `04-stdlib-api.md`.
5. **Named real-world landmark? Use real geometry** — try `stdlib.loadModel()` first; use `stdlib.makeGateway()` for arched monuments / triumphal gates; never substitute with `makeBuilding()`. A box cannot represent an arch.
6. **Named real-world place or famous scene? Run Research first** — see `06-research.md` BEFORE the 5-step pre-analysis in `01-pre-analysis.md`.
7. **Use the layout solver** — `stdlib.useLayout(type)` for all structural placement. Never hardcode x,y,z for structural elements.
