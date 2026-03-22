# Three.js 渲染器设计与实现

**文件：** `viewer/src/renderer/scene-renderer.ts`
**辅助模块：** `texture-cache.ts`、`hdri-cache.ts`

---

## 概述

`SceneRenderer` 是 scratch-world 的客户端 3D 渲染引擎，负责将后端生成的 `SceneData` JSON
转换为可交互的 Three.js 3D 场景。它封装了以下完整渲染栈：

- 按需帧循环（demand frameloop）
- 自适应像素比（adaptive DPR）
- 多通道后期处理（SSAO + Bloom + **SMAA** + **Vignette**）
- 大气天空模型（Preetham Sky shader）
- Polyhaven HDRI 环境光（IBL，**2k 分辨率**）
- PBR 纹理异步加载（Polyhaven CDN，**diff + nor + rough + ao + disp 五通道**）
- 坡面混色地形材质（onBeforeCompile GLSL 注入，**支持漫反射贴图亮度混合**）
- 地面顶点位移（64 段细分 + 正弦波起伏，中心平坦边缘隆起）
- 永久地平线山脊（6 座固定远景山丘，z=-42 ~ -55，定义世界边界）
- 环境散布系统（每次加载户外场景自动散布岩石 + 灌木）
- 水面动画（MeshPhysicalMaterial + 流动法线贴图，湖床深色层产生水深感）
- GLTF 模型加载（Path A）
- 代码沙箱（Path C，自定义 Three.js 代码执行）
- NPC 待机动画
- 物体交互拾取（Raycasting）
- 视点平滑过渡（相机插值）
- 树木实例化批量渲染（InstancedMesh）

---

## 架构图

```
SceneData (JSON)
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│                    loadScene()                          │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ applyEnv()   │  │ buildObjects │  │ executeCode()│  │
│  │ 天空/灯光/   │  │ 按对象类型   │  │ Path C:      │  │
│  │ 雾/HDRI      │  │ 构建几何体   │  │ 代码沙箱     │  │
│  └──────────────┘  └──────┬───────┘  └──────────────┘  │
│                            │                            │
│    ┌───────────────────────┼───────────────────────┐   │
│    │  terrain              │  tree          │ other │   │
│    │  floor/hill/cliff/    │  InstancedMesh │ GLTF  │   │
│    │  platform/wall/water  │  批量渲染       │ 异步  │   │
│    └───────────────────────┴───────────────────────┘   │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│                  render loop (demand)                   │
│                                                         │
│   framesDue > 0 或 codeAnimCbs 活跃时才渲染              │
│                                                         │
│   EffectComposer:                                       │
│     RenderPass → SSAOPass → UnrealBloomPass → OutputPass│
└─────────────────────────────────────────────────────────┘
```

---

## 核心类 `SceneRenderer`

### 状态字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `scene` | `THREE.Scene` | Three.js 场景根节点 |
| `camera` | `PerspectiveCamera` | 60° FOV，near=0.1，far=500 |
| `renderer` | `WebGLRenderer` | antialias=false（与 EffectComposer 不兼容） |
| `controls` | `OrbitControls` | 阻尼系数 0.05，滚轮缩放 2–200 |
| `hemi` | `HemisphereLight` | 天光/地光，由 env preset 驱动 |
| `sun` | `DirectionalLight` | 主定向光，**4096px** PCFSoft 阴影 |
| `composer` | `EffectComposer` | 后期处理链 |
| `bloomPass` | `UnrealBloomPass` | 全局辉光 |
| `ssaoPass` | `SSAOPass` | 环境遮蔽 |
| `sky` | `Sky` | Preetham 大气天空 shader |
| `objects` | `Map<id, Object3D>` | objectId → Three.js 节点，用于拾取 |
| `objectMeta` | `Map<id, SceneObject>` | objectId → 原始 JSON，用于交互 |
| `codeAnimCbs` | `(delta)=>void[]` | 每帧回调列表（水面动画、NPC、代码沙箱） |
| `framesDue` | `number` | 按需帧计数器 |
| `treeInstances` | `InstancedMesh[]` | 树木实例化批次，loadScene 时重建 |
| `codeGroup` | `THREE.Group` | sceneCode 创建的对象容器，loadScene 时清空 |
| `scatterGroup` | `THREE.Group` | 环境散布（岩石/灌木）容器，每次加载室外场景重建 |

---

## 渲染循环（Demand Frameloop）

灵感来自 React Three Fiber 的 `frameloop: "demand"` 模式。只在需要时渲染帧，极大降低 CPU/GPU 占用：

```typescript
// 核心门控逻辑
private loop(now: number) {
  const active = this.codeAnimCbs.length > 0;  // 有动画 → 持续渲染
  if (active || this.framesDue > 0) {
    if (this.framesDue > 0) this.framesDue--;
    this.controls.update();
    this.composer.render();
  }
  this.animFrame = requestAnimationFrame(this.loop.bind(this));
}
```

`invalidate(n)` 将 `framesDue` 增加 n，触发后续 n 帧渲染。以下事件都会调用 `invalidate`：

- `OrbitControls` 的 `change` 事件（含阻尼动画）
- 异步 PBR/HDRI 纹理加载完成
- GLTF 模型加载完成
- `window.resize`

### 自适应 DPR（Adaptive DPR）

当一帧耗时超过 50ms（约 20fps）时，自动将 `devicePixelRatio` 乘数降至 0.5，
200ms 无压力后恢复到 1.0。实现参考 R3F `performance.regress`：

```typescript
private readonly perfMin      = 0.5;
private readonly perfMax      = 1;
private readonly frameBudgetMs = 50;
```

---

## 后期处理（Post-Processing）

### 渲染通道链

```
WebGLRenderer (非 MSAA)
    │
EffectComposer
    ├─ RenderPass          — 将场景渲染到离屏 FBO
    ├─ SSAOPass            — 屏幕空间环境遮蔽（接触阴影）
    ├─ UnrealBloomPass     — 虚幻引擎辉光（仅对超亮像素生效）
    ├─ OutputPass          — 色调映射 + gamma 写入 canvas
    ├─ SMAAPass            — 形态学抗锯齿（在 LDR 输出后处理）
    └─ VignetteShader      — 边角暗化 ~24%（电影感）
```

**注意：** WebGLRenderer 的 `antialias: false` 是必须的。启用 MSAA 时，
EffectComposer 的内部 FBO 与 MSAA 帧缓冲冲突，导致画面闪烁。

### SSAO（屏幕空间环境遮蔽）

```typescript
ssaoPass.kernelRadius  = 8;
ssaoPass.minDistance   = 0.002;
ssaoPass.maxDistance   = 0.08;
```

SSAO 在 bloom 之前插入，确保遮蔽暗化区域不会被 bloom 增亮，
从而保留建筑/地形的接触阴影感。

### UnrealBloom（虚幻辉光）

```typescript
bloomPass.strength  = 0.4   // 默认（可被 environment.effects.bloom 覆盖）
bloomPass.radius    = 0.3
bloomPass.threshold = 0.9   // 最低值；防止普通表面因 bloom 过曝
```

- `threshold` 最低钳位为 0.9 — 保护普通光照表面不受 bloom 影响
- 夜晚场景（`skybox: "night"`）自动将 `strength` 提升至最低 0.8
- 发光对象（`emissiveIntensity > 0`）配合 bloom 产生光晕效果

### 色调映射

```typescript
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.65;  // 提升自 0.6，色彩更鲜艳
```

ACES Filmic 提供类电影的高光压缩和阴影细节保留。曝光 0.65 在
户外场景中保持合适亮度，避免 HDR 天空过曝。

---

## 大气天空（Three.Sky Shader）

使用 Preetham 大气散射模型，依据 `environment.skybox` 和 `timeOfDay` 动态调整：

```typescript
// 关键参数（由 resolveEnvPreset() 映射）
turbidity       — 大气混浊度（1=清澈，20=阴天）
rayleigh        — 天空蓝度（瑞利散射强度）
mieCoefficient  — 太阳光晕密度（米氏散射）
mieDirectionalG — 太阳光晕锐利度
elevation       — 太阳仰角（度）
azimuth         — 太阳方位角（度）
```

夜晚场景时，`sky.visible = false`，改用纯色背景 `scene.background = new Color(0x0a0a1a)`。

---

## HDRI 环境光（IBL）

**分两阶段：**

1. **构造时（即时）：** 使用 `RoomEnvironment`（内置，零网络请求）作为基线 IBL，
   确保场景立即有合理反射。

2. **loadScene 后（异步）：** 从 Polyhaven CDN 下载对应 skybox 的 1k .hdr 文件，
   通过 `PMREMGenerator` 转换为 PMREM 纹理，替换 `scene.environment`。

```typescript
// hdri-cache.ts — 四种预设映射到 Polyhaven 资产 ID
clear_day → kloofendal_48d_partly_cloudy_puresky
sunset    → kloppenheim_06
night     → starlit_golf_course
overcast  → overcast_soil_puresky
```

`hdri-cache.ts` 维护全局内存缓存，同一 skybox 在整个会话内只下载一次。
网络失败时静默降级为 RoomEnvironment。

---

## PBR 纹理系统（Polyhaven CDN）

**文件：** `viewer/src/renderer/texture-cache.ts`

所有 terrain 形状的材质在构建时先使用纯色 MeshStandardMaterial（即时渲染），
然后通过 `applyTerrainPbr()` 异步升级为含法线 + 粗糙度贴图的 PBR 材质。

```typescript
applyTerrainPbr(mat, textureId, repeat, onUpdate)
// 加载：nor_gl（法线贴图）+ rough（粗糙度贴图，可选）
// CDN：https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{id}/{id}_{map}_1k.jpg
```

### 各地形形状对应纹理

| 形状 | `textureId` | UV repeat 逻辑 |
|---|---|---|
| `floor`（草地） | `aerial_grass_rock_02` | `max(width,depth)/2`（约 2m²/texel） |
| `floor`（室内木地板） | `light_wood_floor_02` | 同上 |
| `floor`（石板/广场） | `cobblestone_floor_08` | 同上 |
| `hill` | `aerial_grass_rock_02` | 固定 4 |
| `cliff` | `rock_face` | 固定 3 |
| `platform` | `cobblestone_floor_08` | 固定 4 |
| `wall` | `plastered_wall_02` | 固定 4 |
| `tree`（树干） | `bark_brown_02` | 固定 2 |
| `building`（墙面） | `red_brick_04` | 固定 3 |

`texture-cache.ts` 维护模块级 Map 缓存，同一 `(textureId, map)` 组合只下载一次，
并去重并发请求（`inFlight` Map）。

---

## 地形坡面材质（Slope Blend）

专为 `hill`、`cliff`、`platform` 设计，通过 `onBeforeCompile` GLSL 注入
实现顶部/侧面双色坡度混色，无需 TSL 或 WebGPURenderer。

```glsl
// Vertex shader 注入：将 objectNormal.y 作为 varying 传给 fragment
vSlopeY = objectNormal.y;

// Fragment shader 注入：基于法线 Y 分量混色
float slopeBlend = smoothstep(uSlopeLo, uSlopeHi, vSlopeY);
diffuseColor.rgb = mix(uSideColor, uTopColor, slopeBlend);
```

坡面混色参数：

| 形状 | topColor | sideColor | lo | hi |
|---|---|---|---|---|
| `hill` | `0x5a8a3c`（草绿） | `0x8b7355`（土褐） | 0.35 | 0.75 |
| `cliff` | `0x908070`（石灰） | `0x5a4a3c`（深棕） | 0.70 | 0.90 |
| `platform` | `0xb0a282`（浅石） | `0x7a6a58`（深石） | 0.60 | 0.85 |

`customProgramCacheKey` 包含两个颜色值，防止 Three.js 在不同地形形状间错误复用同一
GLSL 程序。

---

## 水面（terrain/water）

水面是整个渲染器中最具技巧性的部分，需解决多个 Z-fighting 和可见性问题。

### 材质设计

```typescript
new THREE.MeshPhysicalMaterial({
  color: 0x0a2e45,          // 深海军蓝 — 视觉上主导草地底色
  emissive: 0x003355,
  emissiveIntensity: 0.25,  // 自发光 — 在阴影中仍可见
  roughness: 0.02,           // 近镜面 — 捕获天空高光
  metalness: 0.15,
  transparent: true,
  opacity: 0.93,             // 近不透明 — 深色主导
  depthWrite: false,         // 禁止写深度缓冲 — 避免与地面 Z-fighting
  envMapIntensity: 1.2,      // 强环境反射
})
```

**为什么不用 Three.js `Water`（reflector shader）：**
完整反射渲染需要从水面以下额外渲染一次场景，产生镜面效果而非湖面效果，
且性能开销翻倍。当前方案用流动法线贴图模拟水波，视觉效果更自然。

### 水波动画

```typescript
// 加载 threejs.org/examples/textures/waternormals.jpg
waterMat.normalMap   = normalTex;
waterMat.normalScale = new THREE.Vector2(1.2, 1.2);  // 强法线可见度

// 每帧双方向 UV 偏移 — 注册到 codeAnimCbs
normalTex.offset.set(t * 0.03, t * 0.015);
```

### 可见性保障

- `depthWrite: false` — 防止深度写入覆盖后续透明物体
- `renderOrder = 1` — 在不透明地形（renderOrder=0）之后渲染
- `position.y = obj.position.y + 0.12` — 水面始终高于地面顶面（y+0.075）0.045 单位

### 场景布局要求（CRITICAL）

水面不可见的根本原因是 **floor 覆盖了 water 的脚印**。
必须确保 floor 和 water 在 z 轴上不重叠：

```
正确：floor at z=8（村庄区域），water at z=-8（湖区）
错误：floor at z=0（60×60），water at z=-8（被 floor 完全覆盖）
```

---

## NPC 待机动画

每个 `type: "npc"` 对象在 `loadScene()` 后通过 `registerNpcIdleAnims()` 注册
三路叠加的正弦动画，模拟自然人体待机状态：

```typescript
// 呼吸（Y 轴）：约 0.3 Hz，幅度 ±0.03
root.position.y = baseY + Math.sin(elapsed * 1.9 + phase) * 0.03;

// 重心移动（Z 轴旋转）：约 0.4 Hz，幅度 ±2°
root.rotation.z = Math.sin(elapsed * 2.5 + phase) * 0.035;

// 微前后摇（X 轴旋转）：约 0.27 Hz，幅度 ±1°
root.rotation.x = Math.sin(elapsed * 1.7 + phase + 1) * 0.018;
```

`phase` 从 `objectId` 确定性计算（字符码之和对 100 取模），
保证不同 NPC 动作相位不同步，增加自然感。

---

## 树木实例化批量渲染（InstancedMesh）

所有不带 `modelUrl` 的 `type: "tree"` 对象统一收集，通过 `buildInstancedTrees()`
用 `THREE.InstancedMesh` 批量渲染，将 N 棵树的 N×4 draw call 缩减为 4 次：

```
InstancedMesh x4：
  ├─ trunkIM       — 树干（CylinderGeometry）
  ├─ foliageIM[0]  — 底层树冠球
  ├─ foliageIM[1]  — 中层树冠球
  └─ foliageIM[2]  — 顶层树冠球
```

每棵树根据 `position.x * 7 + position.z * 13` 生成确定性随机数，
用于差异化缩放（0.85–1.3x）和旋转，避免均匀感。

---

## 对象形状系统

### type: "terrain" 形状

| shape | 几何体 | 特殊处理 |
|---|---|---|
| `floor` | BoxGeometry(w, 0.15, d) | PBR 纹理自动检测（草/石/木）；y+0.075 |
| `water` | PlaneGeometry(w, d) | 特殊水面材质；y+0.12；动画 UV 偏移 |
| `hill` | SphereGeometry 半球 | 坡面混色材质；位置为峰顶 |
| `cliff` | BoxGeometry(w, h, d) | 坡面混色；位置为顶部边缘，向下延伸 h/2 |
| `platform` | BoxGeometry(w, h, d) | 坡面混色；位置为顶面，向下延伸 h/2 |
| `wall` | BoxGeometry(20, 3.2, 0.2) | 仅室内；x 或 z 方向自动旋转 |
| `ceiling` | BoxGeometry(20, 0.15, 20) | 与 floor 相同但 y+3 |
| `court` | 复合几何体 | 篮球场线（3分线/罚球区/中线）程序化生成 |

### type: "object" 形状

| shape | 结构 |
|---|---|
| `desk/table` | 桌面 + 4 根圆柱腿 |
| `chair/stool` | 座面 + 靠背 + 4 根细腿 |
| `blackboard` | 黑板面 + 木框 + 粉笔托 + CanvasTexture 文字 |
| `window` | 外框 + 横/竖格条 + 半透明玻璃 |
| `door` | 门板（箱体） |
| `shelf/bookcase` | 背板 + 两侧板 + 5 层搁板 + 书籍程序化排列 |
| `pillar/column` | 圆柱 |
| `hoop` | 竖杆 + 横臂 + 篮板 + 橙色边框 + 环 + 半透明网；自动镜像 x>0 一侧 |
| `box` | 默认小立方体 |

### type: "building"

程序化建筑：箱体主体（随高度变化宽深比）+ 四棱锥屋顶。
根据描述关键词选择屋顶颜色，随机旋转角度增加有机感。

### type: "npc"

胶囊状人形：躯干（CylinderGeometry）+ 头部（SphereGeometry）+ 四肢。
整体 Group 挂载 NPC 动画回调。

### 黑板文字渲染（CanvasTexture）

从 `description` 字段提取文字（优先引号内容，其次连续 CJK 字符），
用 `canvas.getContext('2d')` 渲染到离屏 Canvas，生成 `CanvasTexture`
贴到 PlaneGeometry。正确处理中文等 Unicode 字符。

---

## GLTF 模型加载（Path A）

当 `metadata.modelUrl` 存在时，先显示程序化占位体，再异步加载真实模型：

```typescript
// 流程
1. buildObject(obj) → 创建占位体，立即加入场景
2. gltfLoader.loadAsync(url)
3. 成功：model.scale.setScalar(scale); model.position.y += yOffset
        移除占位体，加入真实模型；更新 objects Map
4. 失败：占位体保留；console.warn 记录错误
```

`GLTFLoader` 复用单例 `this.gltfLoader`，避免重复初始化。

---

## 代码沙箱（Path C — sceneCode）

当 `SceneData.sceneCode` 存在时，`loadScene()` 直接调用 `executeCode()`，
跳过 JSON 对象构建流程，并关闭内置灯光（让代码完全控制光照）：

```typescript
executeCode(code: string) {
  const fn = new Function(
    'THREE','scene','camera','renderer','controls','animate','Water',
    code
  );
  fn(THREE, this.codeGroup,  // scene 指向 codeGroup 而非根节点
     this.camera, this.renderer, this.controls,
     (cb) => this.codeAnimCbs.push(cb),
     Water);
}
```

**沙箱接口：**
- `THREE` — 完整 Three.js 库
- `scene` — 实际指向 `codeGroup`，loadScene 时随整组清空
- `camera`、`renderer`、`controls` — 只读访问渲染器内部状态
- `animate(cb)` — 注册每帧回调（delta 单位：秒）
- `Water` — Three.js Water 插件（用于逼真反射水面）

---

## 相机视点过渡

`goToViewpoint(viewpoint)` 触发平滑相机动画，而非直接跳切：

```typescript
// 过渡参数
TRANSITION_DURATION = 800ms
// 插值：从当前 pos/target 到目标 pos/lookAt
// 每帧在 loop() 中用 lerp() 更新，动画期间持续调用 invalidate(1)
```

---

## 对象拾取（Raycasting）

`pick(ndcX, ndcY)` 从 NDC 坐标发射光线，遍历 `objects` Map 中所有节点：

```typescript
raycaster.setFromCamera({ x, y }, camera);
const hits = raycaster.intersectObjects([...objects.values()], true);
// 取第一个命中；从 child.userData 向上遍历找 objectId
```

返回 `PickResult { objectId, name, interactable, interactionHint }`。
`ViewerCanvas.tsx` 用此结果驱动悬停高亮和点击交互。

---

## 场景切换（高亮 + 淡入淡出）

### 高亮

```typescript
highlightObject(id: string | null) {
  // 所有对象恢复原材质 emissive
  // 目标对象 emissiveIntensity += 0.4（橙色高亮）
}
```

### 淡入淡出

由 `ViewerCanvas.tsx` 驱动，而非渲染器本身：

```
loadScene() 调用前：setFading(true) → 黑色遮罩覆盖 canvas（不透明）
loadScene() 完成后：setFading(false) → CSS transition 0.4s ease-out 淡出
```

---

## 窗口缩放处理

`ResizeObserver` 监听 canvas 容器大小变化：

```typescript
observer.observe(canvas.parentElement);
// 回调内：
renderer.setSize(w, h);
camera.aspect = w / h;
camera.updateProjectionMatrix();
composer.setSize(w, h);
ssaoPass.setSize(w, h);
bloomPass.setSize(w, h);  // 注意：bloomPass 需要手动更新 resolution
invalidate(2);
```

---

## 性能设计总结

| 技术 | 效益 |
|---|---|
| 按需帧循环（demand frameloop） | 静态场景零 GPU 消耗 |
| 自适应 DPR（adaptive DPR） | 低端设备帧率保障 |
| InstancedMesh 树木批量 | N 棵树 → 4 draw calls |
| PBR 纹理异步加载 | 不阻塞初次渲染 |
| HDRI 会话缓存 | 同 skybox 不重复下载 |
| `renderer.shadowMap.autoUpdate = false` | 仅在 `invalidate` 时更新阴影 |
| `antialias: false` + EffectComposer | 避免 MSAA/FBO 冲突 |
