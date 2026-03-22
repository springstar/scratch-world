# TODO — scratch-world 下一步

## 待办（按优先级）

### 高优先级

- [ ] **terrain/wall PBR 纹理** — 室内场景墙面目前纯白，加砖墙/抹灰法线贴图（`plaster_wall_02` 或 `painted_plaster_wall`），10 分钟内完成
- [ ] **水面地形（terrain/river / terrain/water）** — 新增 `water` 形状，利用已 import 的 Three.js `Water` shader 实现反射水面；`position.y` = 水面高度，`metadata.width/depth` 控制大小

### 中优先级

- [ ] **场景切换淡入淡出** — loadScene() 时画面先淡出（黑色遮罩），新场景建好后淡入；用 CSS transition 或 CanvasTexture overlay 实现，避免闪烁
- [ ] **NPC idle 动画** — 在 sceneCode 模式下实现简单 bob 动画（头部/手臂微摆），或在 JSON 模式下给 npc 加 `animate` 回调使其原地轻微晃动
- [ ] **室外地面细节** — 大面积 `terrain/floor` 的草地纹理目前 repeat 按尺寸计算，考虑加 `detailMap`（细节叠加）提升近景质感

### 低优先级

- [ ] **LOD（Level of Detail）** — 远处物体降低细节：背景层树木用 sprite billboard 替代 InstancedMesh，减少 draw call；适用于超过 20 棵树的大型场景
- [ ] **push 到远端** — 最近几次提交还没有 push 到 origin/master
- [ ] **音频氛围** — 根据 skybox/weather 播放背景音效（风声、雨声、城市噪音），使用 Web Audio API
- [ ] **更多 GLTF 模型库** — 补充 SKILL.md 中可用的 CC0 模型 URL，例如 Kenney City Kit、Quaternius 角色包的直链

## 已完成

- [x] 后期处理：SSAO + UnrealBloom（EffectComposer）
- [x] GLTF 模型加载（metadata.modelUrl，Path A）
- [x] 代码生成沙盒（sceneCode，Path C）
- [x] 需求帧循环 + 自适应 DPR（R3F 借鉴）
- [x] Polyhaven HDRI 环境光（4 种天空预设，hdri-cache.ts）
- [x] 地形坡面混色材质（hill / cliff / platform，onBeforeCompile GLSL）
- [x] Polyhaven PBR 纹理：hill / cliff / platform / floor / tree trunk / building wall
- [x] SKILL.md 深度构图规则（三层景深、高度变化、新地形形状）
