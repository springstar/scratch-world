# TODO — scratch-world 下一步

## 待办（按优先级）

### 低优先级

- [ ] **LOD（Level of Detail）** — 远处物体降低细节：背景层树木用 sprite billboard 替代 InstancedMesh，减少 draw call；适用于超过 20 棵树的大型场景
- [ ] **音频氛围** — 根据 skybox/weather 播放背景音效（风声、雨声、城市噪音），使用 Web Audio API
- [ ] **更多 GLTF 模型库** — 补充 SKILL.md 中可用的 CC0 模型 URL，例如 Kenney City Kit、Quaternius 角色包的直链

## 已完成

- [x] **水面可见性修复** — 深海军蓝 + emissive + 近镜面粗糙度（0.02）+ 高不透明度（0.93）；SKILL.md 新增湖边村庄布局规范（floor 与 water 不得重叠）

- [x] 后期处理：SSAO + UnrealBloom（EffectComposer）
- [x] GLTF 模型加载（metadata.modelUrl，Path A）
- [x] 代码生成沙盒（sceneCode，Path C）
- [x] 需求帧循环 + 自适应 DPR（R3F 借鉴）
- [x] Polyhaven HDRI 环境光（4 种天空预设，hdri-cache.ts）
- [x] 地形坡面混色材质（hill / cliff / platform，onBeforeCompile GLSL）
- [x] Polyhaven PBR 纹理：hill / cliff / platform / floor / wall / tree trunk / building wall
- [x] SKILL.md 深度构图规则（三层景深、高度变化、新地形形状）
- [x] terrain/wall PBR 纹理（plastered_wall_02）
- [x] 水面地形 terrain/water（Three.js Water shader，动画反射）
- [x] 场景切换淡入淡出（黑色遮罩 CSS transition）
- [x] NPC idle 动画（bob + sway，deterministic phase per objectId）
- [x] 室外地面细节（floor PBR repeat 从 size/4 → size/2，~2m² texels）
- [x] push 到远端 origin/master
