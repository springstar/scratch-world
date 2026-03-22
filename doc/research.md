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
