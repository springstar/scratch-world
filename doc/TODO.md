# TODO — scratch-world 下一步

## 改进路线总表

> 最后更新：2026-04-28。来源：Living Worlds 文档、EvoMap/evolver 调研、splat-collider-builder 调研、现有待办汇总。
> 依赖关系见文末。已完成项移至底部"已完成"节。

---

### 🔴 P0 — 立刻（每项 ≤ 半天，零破坏性）

- [ ] **sceneCode 沙箱预验证** — acorn 语法检查 + banned API 白名单，Agent 写 DB 前验证，失败重试一次再回退 JSON 渲染模式。来源：Evolver solidify.js。
- [ ] **sceneCode 内容哈希缓存** — `executeCode()` 前 SHA-256 对比，命中跳过 WebGL 重建，重复访问节省 100-300ms。
- [ ] **场景编辑修复循环检测** — 同 session 3 次 `update_scene` 且 sceneData hash 无明显变化 → Agent system prompt 注入"建议重新生成"提示。来源：Evolver repair_loop_detector。
- [ ] **Admin tick 调试接口** — `POST /admin/scenes/:id/tick`（server secret 鉴权），立即触发一次 heartbeat，无需改常量等 10 分钟。来源：living-worlds.md §8。
- [ ] **worldTime 平滑插值** — 收到 `world_time_update` 后在 viewer 用 `requestAnimationFrame` 线性过渡 30s，替代当前跳变。来源：living-worlds.md §9。
- [ ] **Agent 自动生成碰撞体 GLB** — 根据 `sceneData.objects` 的 position + 推断尺寸，程序化构建 `BoxGeometry` Group，用 `GLTFExporter` 导出 `.glb`，上传到 `/uploads/`，写入 `colliderMeshUrl`。解决无 Marble 场景（stub/sceneCode）物理穿透问题，完全自动化无需手工。来源：splat-collider-builder.netlify.app 调研。

---

### 🟡 P1 — 短期（1-2 周）

- [ ] **聊天信号提取** — session 消息路径加 Regex 层（中英文），检测 `scene_dissatisfaction` / `feature_request` / `repair_loop` 信号，写入 session metadata，暴露给运营查询。来源：Evolver signals.js。
- [ ] **GLTF 模型 URL 哈希缓存** — `GltfObjectRenderer` 按 URL hash 缓存已加载 `Group`，同 URL 复用，跳过重新下载和解析。
- [ ] **NPC 停滞检测 + 唤醒进化** — NPC heartbeat 查询 7 天无互动的 NPC → 触发 `repair` 策略进化；14 天无互动 → 发布"NPC 离开"world_event。来源：Evolver stagnation detection。
- [ ] **NPC 进化审计日志** — 独立 `npc_evolution_events` 表（event_id, npc_id, trigger, delta, outcome, created_at），替代 metadata 里可变数组，支持跨 NPC 分析进化策略效果。
- [ ] **NPC 进化策略预设注入** — 按 `interactionCount` 自动选 `innovate` / `balanced` / `harden` / `repair` 策略，注入进化 prompt。`count<5`=innovate，`5-50`=balanced，`>50`=harden，7d停滞=repair。来源：Evolver strategy presets。
- [ ] **可变 heartbeat tick 率** — 有活跃 session 的场景 10min/tick；超过 24h 无访客的场景 60min/tick，非活跃场景 API 调用降至 1/6。来源：living-worlds.md §3。
- [ ] **worldTime 重启快进** — server 启动时读 `lastHeartbeatAt`，计算停机期间应补的 game-time，一次性追赶（上限 2 个 game-day）。来源：living-worlds.md §5。
- [ ] **Telegram 生成进度反馈** — 异步 Marble 任务期间每 15s 推送进度消息，完成时更新为场景链接。
- [ ] **玩家触发世界事件** — NPC 深度交互（`interactionCount` 达阈值或关键词命中）→ 立即生成并广播一条 `world_event`，关闭玩家行为→世界叙事闭环。来源：living-worlds.md §4。

---

### 🟢 P2 — 中期（1 个月）

- [ ] **sceneCode Gene 库初版** — `src/skills/renderer-threejs/genes/` 存 ~30 个常用效果 JSON（`{ signals, code, validated }`）；code-gen 先关键词匹配，命中直接返回，不调 Haiku。来源：Evolver selector.js，实测命中率 92%。
- [ ] **场景生成 prompt Gene 化** — `create-scene` 工具改用结构化信号字段（`style_signals`, `required`, `constraints`, `avoid_repeat`）替代自由文本。论文证明结构化 Gene 比自由文本控制信号强 2x。
- [ ] **滚动世界叙事（World Narrative）** — `EnvironmentConfig` 加 `worldNarrative?: string`；每次事件生成后 Haiku 将其更新为 100-200 字摘要；下次事件生成注入为背景，形成故事弧。来源：living-worlds.md §1。
- [ ] **天气视觉效果** — `world_event` type=weather 时解析 headline 关键词（暴雨/大雾/晴）→ 注入 sceneCode overlay（粒子雨/fog density/清除效果）。来源：living-worlds.md §10。
- [ ] **世界事件归档 + 传说系统** — 超过 30 天的 `world_events` 定期聚合为 `world_lore` 条目（Haiku 生成历史摘要）；World Journal 增加"传说"标签页。来源：living-worlds.md §7。
- [ ] **NPC 因果记忆（Memory Graph 轻版）** — memory 条目从 `string[]` 改为 `{ fact, source, timestamp, linkedFacts[] }`；NPC 对话时能追溯记忆来源，产生连贯叙事。来源：Evolver memoryGraph.js。
- [ ] **Gene 库自动增长** — 新生成的 sceneCode 通过沙箱验证后自动候选入库，CI 或人工审核后标记 `validated: true`。
- [ ] **场景访问控制** — viewer API 强制校验 shareToken / session，无权访问返回 403，不再静默失败。
- [ ] **移动端触控** — SplatViewer 虚拟摇杆 + 双指缩放；UniverseView 触控卡片滑动。
- [ ] **Universe 空状态引导** — 新用户无场景时显示引导卡（3 步：发消息 → 选风格 → 进入世界）。
- [ ] **多实例时区共识（Universe Time）** — 选配：所有 livingEnabled 场景共享 `universeTime` 基准，各自带 `timeZoneOffset`，同一宇宙时间同步。来源：living-worlds.md §6。

---

### ⚪ P3 — 长期 / 规划期

- [ ] **公开场景发现** — 公开世界广场，用户可浏览/进入他人 `isPublic` 的场景，带访客数/最近事件预览；需内容审核机制。
- [ ] **用户身份系统** — Web viewer 账户体系（OAuth 或自有），与 Telegram userId 打通，跨 session 持久化；解锁留言板署名、成就、跨设备访问。
- [ ] **NPC Gene 行为单元** — 把 NPC 行为拆解为可组合 Gene 结构（signal + action + validation），替代自由文本 personality；构建 NPC Gene 市场。依赖用户身份。
- [ ] **运营世界脚本（World Script）** — `EnvironmentConfig.worldScript: { content, expiresAt }`，运营注入临时叙事背景（节庆/世界事件），heartbeat 检查过期自动清除。
- [ ] **场景传记 Memory Graph** — 场景所有版本变更 + world_events 构成因果 DAG，支持"这个场景的故事"自然语言查询。来源：Evolver Memory Graph 在场景层的完整实现。
- [ ] **跨世界 Gene 共享** — 成功的 sceneCode gene、NPC 行为 gene 发布到"宇宙市场"，其他运营者可下载应用。依赖公开场景 + 用户身份。来源：Evolver Hub 概念。
- [ ] **LOD（Level of Detail）** — 远处物体降低细节：背景层树木用 sprite billboard 替代 InstancedMesh，减少 draw call；适用于超过 20 棵树的大型场景。
- [ ] **音频氛围** — 根据 skybox/weather 播放背景音效（风声、雨声、城市噪音），使用 Web Audio API。
- [ ] **更多 GLTF 模型库** — 补充 SKILL.md 中可用的 CC0 模型 URL，例如 Kenney City Kit、Quaternius 角色包的直链。
- [ ] **Viewer 内嵌碰撞体编辑器** — 编辑模式新增"碰撞体"tab，支持可视化绘制 Box/Sphere/Cylinder（鼠标拖拽 + 参考平面 raycast，同 splat-collider-builder 原理），GLTFExporter 导出 `.glb` 并写入 `colliderMeshUrl`。面向需要精细调整碰撞的场景创建者。依赖 P0 Agent 自动生成碰撞体作为初始值。来源：splat-collider-builder.netlify.app。

---

## 关键路径依赖

```
P0: sceneCode 沙箱验证 ──→ P2: Gene 库初版 ──→ P2: Gene 库自动增长 ──→ P3: 跨世界 Gene 共享
P0: 修复循环检测      ──→ P1: 聊天信号提取 ──→ P2: 场景生成 Gene 化
P1: NPC 停滞检测      ──→ P1: 策略预设注入 ──→ P2: 因果记忆        ──→ P3: NPC Gene 市场
P2: 公开场景发现      ──→ P3: 用户身份     ──→ P3: Gene 市场
P1: Living Worlds 完善 ──→ P2: 滚动叙事     ──→ P2: 事件归档传说   ──→ P3: 场景传记
```

---

## 已完成

- [x] **Living Worlds — 世界时钟 + 昼夜光照** — worldTime 字段、SceneManager.updateEnvironment()、WorldHeartbeat 10min tick、SplatViewer 昼夜插值（WT_KF 关键帧）
- [x] **Living Worlds — 世界事件系统** — Claude Haiku 事件生成、world_events 表（SQLite/PG）、RealtimeBus 推送、/scenes/:id/events 接口
- [x] **Living Worlds — World Journal UI** — 浮动日志面板、WS 实时推送、徽章计数、WorldJournal.tsx
- [x] **世界事件注入 NPC 感知** — NPC heartbeat 读取最近 2 条 world_events，注入 perceptionContext，NPC 开始评论世界发生的事
- [x] **场景访客计数** — EnvironmentConfig.visitCount + lastVisitedAt，POST /scenes/:id/visit，App.tsx 场景加载时自动触发
- [x] **留言板（Bulletin Board）** — bulletin_board SceneObject 类型、GET/POST /messages 接口（限流 5次/5min）、BulletinBoard.tsx 组件、SplatViewer 交互检测
- [x] **视觉质感全面提升** — PlaneGeometry 地面、PBR 纹理全通道、HDRI 2k、阴影 4096、SMAA + Vignette、水面着色器
- [x] **NPC 系统** — 感知上下文、记忆、进化、NPC-to-NPC 对话、PerceptionBus、进化日志
- [x] **SplatViewer 核心功能** — 流式加载 + 中止、进度条、像素比上限、物理行走、自由飞行、Portal 系统、ScriptPanel
- [x] **存储层** — SQLite/PostgreSQL 双后端、scene_versions 不可变快照、session 持久化
- [x] **限流** — LLM 和场景创建端点限流、bulletin board 限流
- [x] **部署** — Dockerfile、docker-compose、GitHub Actions CI/CD、deploy.md
- [x] **安全** — API 错误响应脱敏（无堆栈泄露）
- [x] **修复失败测试** — 158 测试全部通过（1 skipped）
