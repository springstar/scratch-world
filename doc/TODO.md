# TODO — scratch-world 下一步

## 待办（按优先级）

### 低优先级

- [ ] **LOD（Level of Detail）** — 远处物体降低细节：背景层树木用 sprite billboard 替代 InstancedMesh，减少 draw call；适用于超过 20 棵树的大型场景
- [ ] **音频氛围** — 根据 skybox/weather 播放背景音效（风声、雨声、城市噪音），使用 Web Audio API
- [ ] **更多 GLTF 模型库** — 补充 SKILL.md 中可用的 CC0 模型 URL，例如 Kenney City Kit、Quaternius 角色包的直链

## 已完成

- [x] **视觉质感全面提升（场景氛围感）**
  - floor 从 BoxGeometry → PlaneGeometry（消除"木板"侧面）
  - 水面深度感：湖床层 + opacity 0.78（消除"纸片"感）
  - 地面 64 段细分 + 正弦位移（边缘地形起伏）
  - 永久地平线山脊（6 座远景山丘，z=-42~-55）
  - 环境散布：每次加载户外场景自动散布岩石 35 个 + 灌木 20 个
  - 雾参数收紧（near 40→30，far 120→90），软化地平线
  - SKILL.md 最小户外地板升至 80×60，建筑间距 8-15 单位

- [x] **PBR 纹理全通道升级**
  - 补充漫反射贴图（`diff`）— 最大视觉提升，草地/砖墙/木纹真实颜色
  - 新增 AO 贴图（`ao`）— 凹陷接触阴影，`setupUv2()` 工具函数
  - 新增 Displacement 贴图（`disp`）— 地面/地板真实几何起伏
  - 坡面 shader 改为"漫反射亮度 × 坡面颜色"混合（贴图细节不再被覆盖）
  - 家具 PBR：桌面/椅子/书架 `light_wood_floor_02`，柱子 `cobblestone_floor_08`

- [x] **渲染质量硬件升级**
  - HDRI 分辨率 1k → 2k（IBL 反射更细腻）
  - 阴影贴图 2048 → 4096（阴影边缘锐利）
  - 后处理链新增 SMAAPass（抗锯齿）+ Vignette（边角暗化 24%）
  - 曝光 0.6 → 0.65（色彩更鲜艳）
  - 几何体细分提升：树干 8→12 段，树叶球体 8×6→12×9，NPC 头部 10×8→16×12

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
