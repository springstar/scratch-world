# Research Notes

技术调研记录，供架构决策参考。

---

## tiny-web-metaverse

- **仓库**: https://github.com/takahirox/tiny-web-metaverse
- **调研日期**: 2026-03-23

### 项目定位

基于 ECS + Phoenix WebSocket 状态同步 + mediasoup WebRTC 媒体流的 Web 多人虚拟世界框架，monorepo 拆成 7 个包（client、addons、state-client、state-server、stream-client、stream-server、demo）。

### 核心架构

| 层 | 技术 | 职责 |
|---|---|---|
| 渲染 | Three.js | 3D 图形 |
| ECS | bitecs 0.3.40 | 实体/组件管理（TypedArray，低 GC） |
| 状态同步 | Phoenix WebSocket | 实体状态复制（delta 压缩，~83ms 间隔） |
| 媒体流 | mediasoup SFU | WebRTC 音视频 |
| 后端 | Elixir/Phoenix | 状态服务器 |

### 值得借鉴的技术模式

**1. 显式 System 执行顺序（已部分采纳）**

```
Time(0) → EventHandling(100) → Setup(200) → Simulation(300) → MatricesUpdate(400) → Render(600) → TearDown(900)
```

scratch-world 已将此模式应用于 `animSystems` 优先级队列，当前分三档：Simulation=300、Culling=500、Render=600。

**2. Serialization-First 网络层**

每个组件有独立的 `Serializer / Deserializer / DiffChecker`，DiffChecker 在发送前 diff 上一帧，只发 delta；NetworkDeserializer 收到后自动注入 `LinearTranslate` 插值组件，不跳帧。适合未来多人功能的组件同步框架。

**3. Prefab 系统**

```typescript
type Prefab = (world: IWorld, params: object) => number
```
Prefab 是纯函数，参数可通过网络序列化，支持参数化生成（角色颜色、模型变体等）。

**4. Addon / Plugin 系统**

组件、System、Prefab、Serializer 均可在 addon 中注册，不修改核心。对应 scratch-world 的 `buildObject()` 可演化为 `registerObjectBuilder(type, factory)` 形式。

**5. Input 抽象分层**

```
鼠标/触屏/XR控制器 → 统一 Pointer → Ray → Raycasted 结果
```

当前 scratch-world `pick()` 直接在 click handler 内做 raycasting，抽成分层后 VR / 触屏支持自然落位。

**6. `scene.matrixWorldAutoUpdate = false`**

在 MatricesUpdate 阶段统一调用 `updateMatrixWorld()`，避免 Three.js 在 render 时隐式触发多次矩阵计算，节省 CPU。

### 他们没做、scratch-world 已有的能力

| 能力 | tiny-web-metaverse | scratch-world |
|---|---|---|
| LOD / 距离剔除 | 无 | ✅ SystemOrder.Culling |
| NPC AI（巡逻/随机游走）| 无 | ✅ NpcMobState |
| 对话气泡 | 无 | ✅ CanvasTexture Sprite |
| 地形 PBR + 坡度混合 | 无 | ✅ makeTerrainSlopeMat |
| AI 生成场景 | 无 | ✅ 核心特性 |

### 下一步参考方向

- 引入 bitecs 替换手动 Map 管理（`objects`、`objectMeta`、`npcMobStates`）
- 参考 Serialization 框架设计多人状态同步层
- Input 抽象：将 `pick()` 提升为独立 System，支持未来 VR 控制器

---

## Spark（@sparkjsdev/spark）

- **仓库**: https://github.com/sparkjsdev/spark
- **npm**: `@sparkjsdev/spark`（最新稳定 0.1.10，2.0 Preview 进行中）
- **许可**: MIT
- **作者**: Diego Marcos（A-Frame 原作者）
- **调研日期**: 2026-03-23

### 项目定位

专为 Three.js 无缝集成设计的 **3D Gaussian Splatting（3DGS）渲染器**。`SplatMesh` 继承自 `THREE.Object3D`，可直接 `scene.add()`，与普通 Mesh 混排渲染。

> 注：此项目与 World Labs 无直接关系。World Labs 是生成 splat 内容的 AI 模型提供商；Spark 是在浏览器里渲染 splat 的渲染库。两者可配合使用，但相互独立。

### 核心特性

- 与 Three.js 渲染管线融合，支持 splat 与 Mesh 混合场景
- 支持主流 splat 格式：`.PLY`（含压缩）、`.SPZ`、`.SPLAT`、`.KSPLAT`、`.SOG`
- 移动端友好，目标覆盖 98%+ WebGL2 设备
- 多 splat 对象正确深度排序
- **2.0 Preview**：LoD + 流式大世界，支持动态 3DGS 场景

### 最简集成示例

```javascript
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const butterfly = new SplatMesh({ url: "https://example.com/scene.spz" });
butterfly.position.set(0, 0, -3);
scene.add(butterfly);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

### 集成 scratch-world 的可行性评估

**技术上可行**，但需要明确用途和解决以下问题：

| 问题 | 说明 | 严重程度 |
|---|---|---|
| **EffectComposer 冲突** | Splat 需要 `onBeforeRender` 时机做视角深度排序，与 SSAO + Bloom 管线有冲突，需要介入渲染顺序 | 中 |
| **光照割裂** | Splat 内嵌烘焙光照，不受 Three.js 动态光影（DirectionalLight/投影）影响，和现有 Mesh 对象视觉上会割裂 | 中 |
| **2.0 API 不稳定** | 2.0 刚出 Developer Preview，大世界 LoD 的 API 还在迭代 | 低（0.1.x 稳定） |
| **素材管线缺失** | 需要配套 `.spz` 文件来源；当前 AI 生成场景系统输出 JSON，没有 splat 生成链路 | 高 |

### 两种集成路径

**路径 A：作为高质量场景渲染器**（工程量大，视觉提升显著）

配合 World Labs 或其他 3DGS 生成模型，从图片/文本生成 `.spz` 文件，Spark 负责浏览器渲染。scratch-world 从"程序生成场景"升级为"AI 生成真实感 splat 场景"。需要先建立 splat 素材生成/获取管线。

**路径 B：作为高质量资产选项**（工程量小，可渐进接入）

在 `SceneObject.metadata` 新增 `splatUrl` 字段，类似现有 `modelUrl: GLTF`，`loadScene()` 中针对有 `splatUrl` 的对象走 Spark 加载路径，其余保持不变。

```json
{
  "objectId": "obj_garden",
  "type": "object",
  "metadata": {
    "splatUrl": "https://example.com/garden.spz",
    "scale": 1.0
  }
}
```

### 建议

当前阶段优先路径 B（渐进接入）：先验证 `SplatMesh` 与现有 EffectComposer 的兼容性，再决定是否深入集成。路径 A 留待 splat 素材生成链路成熟后再评估。

---

## Image-Similarity-Based Scale Estimation for 3D Model

- **论文**: "Image-Similarity-Based Scale Estimation for 3D Model", SA Posters '25, December 2025, Hong Kong
- **作者**: Tianrui Hu, Jiaao Yu, Wenjun Hou（北京邮电大学 / 腾讯混元）
- **DOI**: 10.1145/3737571468
- **调研日期**: 2026-04-13

### 论文核心思路

生成模型后自动推断真实世界尺寸，无需人工标注。流程：

```
3D 模型（GLB/GLTF）
  → 渲染为图像（多角度）
  → CLIP 向量化
  → 在有真实尺寸标注的 3D 数据库中检索最相似物体（cosine similarity）
  → 用检索结果的尺寸（指数加权平均）推断目标尺寸
  → 以最短轴为缩放参考，uniform scale 应用到模型
```

**缩放策略**：不直接匹配三轴，而是用最短轴（`argmin axis`）为基准：

```
s = argmin(axis_B) / argmin(axis_A)
```

避免形状变形；最短轴通常对应物体最稳健的几何特征。

**评估结果**（40 个 8 类别标准化模型，ground-truth 尺寸手工测量）：

| 方法 | Average Error | Usability |
|------|--------------|-----------|
| Depth 估计（baseline）| 0.894 | 5% |
| 本文（CLIP 检索）| 0.202 | 80% |

CLIP 检索方案误差降低 77%，可用率提升 16×。

### 与 scratch-world 的关联

#### 当前方案的局限

我们现在用 agent 根据文字名称判断语义类别，再查表写入 `metadata.targetHeight`。这条路存在根本缺陷：

- agent 看到的是文字（"一桶"），不是模型视觉内容
- 依赖人工维护语义高度表，新类别需要手动添加
- 分类错误无法自动修正（调试中已出现"一桶"被误判为人的情况）

#### 论文方案的优势

渲染后用 CLIP 做视觉检索，**看的是模型本身**，不依赖名称：

- 一只躺着的猫和一只坐着的猫都能匹配到猫的尺寸
- 不需要维护分类表，泛化到任意新物体
- 可与 Hunyuan 3D 生成流程串联：生成完立即推断尺寸并写入 metadata

#### 对 scratch-world 的具体启发

**短期（可立即实现）**：在 Hunyuan 生成完成后，用 CLIP 对渲染缩略图做零样本分类（human / animal / furniture / vehicle），映射到对应 `targetHeight` 区间，比纯文字名称更可信。我们已经在生成流程中产出缩略图，CLIP 调用成本极低。

**中期（需构建数据库）**：用 3D-FUTURE / ShapeNet / Objaverse 中有真实尺寸标注的子集构建嵌入数据库，实现论文的完整检索流程。生成一个模型的同时自动查询并写入 `targetHeight`，完全消除人工干预。

**缩放参考轴**：论文建议用最短轴而非 Y 轴（高度轴）作为缩放参考，这与我们当前遇到的模型躺倒检测问题直接对应——如果用最短轴，躺倒的模型和直立的模型都能得到正确的缩放比例，无需先做方向矫正。

### 实现路径建议

```
阶段 1：CLIP 零样本分类（低成本，可快速验证）
  - 在 image-to-3d.ts 生成完成后，渲染模型缩略图
  - 调用 CLIP（OpenAI API 或本地 clip-vit-base）对缩略图分类
  - 按分类结果自动写入 targetHeight
  - 不依赖外部数据库，纯推理

阶段 2：嵌入数据库（更高精度）
  - 下载 3D-FUTURE 或 Objaverse-XL 的有尺寸标注子集
  - 预计算 CLIP 嵌入，构建向量索引（FAISS）
  - 检索时返回最相似物体的真实尺寸
  - 用论文的指数加权平均 + 最短轴方案计算 targetHeight
```

### 与当前架构的集成点

| 集成位置 | 说明 |
|---------|------|
| `src/agent/tools/image-to-3d.ts` | Hunyuan 生成完成后触发 CLIP 推断，自动填 `targetHeight` |
| `src/viewer-api/routes/scenes.ts` | NPC POST 接口已支持 `targetHeight` 字段，直接接收推断结果 |
| `viewer/src/components/SplatViewer.tsx` | 渲染层已纯数据驱动，读 `targetHeight` 即可，无需改动 |

- **仓库**: https://github.com/SimWorld-AI/SimWorld
- **论文**: arXiv 2512.01078，NeurIPS 2025 Spotlight
- **Stars**: 515
- **许可**: Apache 2.0
- **调研日期**: 2026-03-23

### 项目定位

基于 Unreal Engine 5 的 **Embodied AI 仿真平台**，面向 LLM/VLM Agent 的训练与评测。Python 控制层通过 UnrealCV 与 UE5 后端通信，提供 Gym-like 接口。

> **与 scratch-world 的本质差异**：SimWorld 是科研用 Python 控制的 UE5 仿真器；scratch-world 是浏览器实时 Three.js 世界生成引擎。技术栈几乎无重叠，但有三个模块的**算法逻辑**值得移植。

### 三层架构

```
UE5 后端          — 物理仿真、资产渲染、传感器（RGB/深度/分割图）
Environment 层    — 程序化城市生成、语言驱动场景编辑、Gym API、交通仿真
Agent 层          — LLM/VLM 多模态感知 + 自然语言动作规划
```

### 值得借鉴的模块

#### 1. 程序化城市生成（`simworld/citygen/`）⭐ 最有价值

纯数学算法，与 UE5 完全解耦，可直接移植。

**道路生成（`RoadGenerator`）**：
- 基于优先队列的增量式道路扩展——从初始线段出发递归生长
- 支持高速路 / 普通路分级，交叉口自动检测与插入
- 支持从 JSON 文件加载预定义路网，也支持程序化随机生成

**建筑放置（`BuildingGenerator`）**：
- 沿道路两侧按间距依次排列，垂直于道路方向偏移
- 用 **QuadTree** 做空间碰撞检测，防止建筑重叠
- 按建筑类型配额（`num_limit`）控制密度，从最大到最小降级填充空隙
- 建筑朝向自动计算为面向道路

**数据结构**：`Point / Segment / Intersection / Bounds / Building / MetaInfo` — 一套自洽的城市几何类型系统。

**对 scratch-world 的意义**：
当前 LLM 生成场景是逐对象手工布局，缺乏城市级连贯性。引入 citygen 算法后，AI 只需给出"主题 + 规模"，自动生成道路骨架和建筑分布，再由 LLM 填充对象描述和 metadata。

```
用户: "生成一个有商业街的小城镇"
  → citygen 生成路网 + 建筑 footprint
  → LLM 为每栋建筑生成 name/description/metadata
  → loadScene() 渲染
```

#### 2. 自然语言资产检索放置（`simworld/assets_rp/`）⭐ 直接对口

**流程**：
```
自然语言输入
  → LLM 结构化提取（asset_to_place / reference_asset / relation / surrounding_assets）
  → SentenceTransformer embedding 对场景节点做相似度排序
  → 几何关系计算（front/back/left/right）确定放置坐标
  → 在 UE5 中 spawn 资产
```

**LLM 解析的 prompt 结构**（直接可复用）：
```
从自然语言中提取四个字段：
1. asset_to_place: 要放置的资产列表
2. reference_asset: 参考建筑（带描述词）
3. relation: front/back/left/right
4. surrounding_assets: 周边环境关键词（用于 embedding 相似度匹配）
```

**对 scratch-world 的意义**：
`update_scene` 的场景编辑目前依赖 LLM 直接修改 JSON，无法精确表达"在某物旁边放"这类相对位置语义。移植此模式（用 Claude 解析 + `objectMeta` 做 embedding 匹配）可大幅提升场景编辑精度。

#### 3. Gym-like Agent 接口理念（远期参考）

SimWorld 将仿真抽象为标准 `reset() / step(action) → observation` 接口，Agent 只关注感知-决策，执行细节封装在 Environment 内。

scratch-world NPC 系统若将来支持 LLM 驱动的自主行为，可借鉴此范式：

```typescript
// 未来方向
interface NpcEnvironment {
  observe(npcId: string): NpcObservation;   // 位置、视野内对象、可交互物
  step(npcId: string, action: NpcAction): void;
}
```

### 不适合借鉴的部分

| 模块 | 原因 |
|---|---|
| UE5 后端 / UnrealCV 通信层 | 完全不同的渲染技术栈 |
| Python 控制层整体 | scratch-world 是前端 TypeScript |
| 物理仿真（碰撞/刚体） | 依赖 UE5 物理引擎 |
| RL 训练管线 | 目标场景不同 |

### 建议优先级

1. **近期**：精读 `citygen/road/road_generator.py` 和 `citygen/building/building_generator.py`，评估将 QuadTree + 道路生长算法移植为 TypeScript 的工作量，用于生成更大规模连贯场景。
2. **中期**：将 AssetsRP 的"LLM 解析 → embedding 匹配 → 相对位置放置"流程移植到 `update_scene` 场景编辑 API，替代当前纯 LLM JSON 修改的方式。
3. **远期**：NPC 行为从随机游走升级到 LLM 驱动时，参考 Gym 接口设计 `NpcEnvironment`。
