# System Interactions

## Full System Interaction Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  SKILL SYSTEM                                                          │
│  skills.active.json: { "generator": "generator-claude", ... }         │
│                                                                        │
│  SkillLoader                                                           │
│  ├── generator-claude   [prompt-generator]  SKILL.md → system prompt  │
│  ├── generator-marble   [code-generator]    index.ts → ThreeDProvider │
│  ├── generator-stub     [code-generator]    index.ts → ThreeDProvider │
│  ├── narrator-haiku     [code]              index.ts → narrateFn      │
│  └── generator-test     [code]              index.ts → ThreeDProvider │
└──────────────┬──────────────────────────────────┬─────────────────────┘
               │ system prompt injection           │ impl injection
               ↓                                  ↓
┌──────────────────────────┐    ┌─────────────────────────────────────────┐
│  AGENT LAYER             │    │  SCENE MANAGER                          │
│                          │    │                                         │
│  System Prompt           │    │  createScene(prompt, sceneData?)        │
│  ├─ base instructions    │    │  ├─ sceneData provided (prompt-gen)     │
│  └─ SKILL.md (if active) │    │  │   → save directly, no provider call  │
│                          │    │  └─ no sceneData (code-gen)             │
│  Claude Sonnet           │    │      → provider.generate(prompt)        │
│  (conversation + intent) │    │                                         │
│  ↓ tool calls            │    │  interactWithObject(...)                │
│  create_scene(           │──→ │  └─ narrateFn → narrator skill         │
│    prompt,               │    └────────────────────┬────────────────────┘
│    sceneData?            │                         │ save
│  )                       │                         ↓
│  update_scene(...)       │    ┌─────────────────────────────────────────┐
│  navigate_to(...)        │    │  STORAGE (SQLite)                       │
└──────────────────────────┘    └────────────────────┬────────────────────┘
                                                     │ GET /scenes/:id
                                                     ↓
                                ┌─────────────────────────────────────────┐
                                │  VIEWER :5173                           │
                                │  providerRef.provider === "marble"?     │
                                │  ├─ YES → <MarbleViewer> (iframe)       │
                                │  └─ NO  → <ViewerCanvas> Three.js       │
                                └─────────────────────────────────────────┘
```

---

## Inbound Message Flow

```
Messaging Channel (Telegram, ...)
  │ raw platform event
  ▼
ChannelAdapter
  │ normalized ChatMessage { userId, channelId, sessionId, text }
  ▼
ChannelGateway
  │
  ▼
SessionManager.dispatch(msg)
  ├─ getOrCreateAgent()
  ├─ hydrateActiveScene()   — inject active scene context into system prompt
  ├─ hydrateActiveSkills()  — inject active generator SKILL.md (if prompt-generator)
  └─ agent.prompt(msg.text)
       │ LLM reasoning + tool calls
       ▼
     Tool execution (create_scene / update_scene / navigate_to / interact_with_object)
       │
       ▼
     SceneManager
       │
       ├─ prompt-generator path: sceneData already filled by Claude → save directly
       └─ code-generator path:   ThreeDProvider.generate(prompt) → save result
```

---

## Create Scene Flow ("Create me a medieval castle")

```
User (Telegram) ──► TelegramAdapter
                       │ ChatMessage
                       ▼
                   ChannelGateway
                       │
                       ▼
                   SessionManager.dispatch()
                       │ load session, get Agent
                       │ hydrateActiveSkills() → inject generator-claude SKILL.md
                       ▼
                   Agent.prompt("Create me a medieval castle")
                       │ LLM decides to call create_scene
                       ▼
                   create_scene tool (with sceneData filled by Claude)
                       │
                       ▼
                   SceneManager.createScene(prompt, sceneData)
                       │ prompt-generator: save sceneData directly
                       ▼
                   Store Scene in DB (v1)
                       │
                       ▼
                   Agent receives tool result
                       │ LLM generates reply
                       ▼
                   "Your castle is ready! [view link]"
                       │
                       ▼
                   TelegramAdapter.presentScene(userId, scene, viewerUrl)
```

---

## Viewer Interaction Flow

```
User clicks object in Viewer App
  → POST /interact { sessionId, sceneId, objectId, action: "examine" }
    → Viewer API → SessionManager.dispatch()
      → Agent.prompt("examine <object>")
        → interact_with_object tool → SceneManager
          → narrateFn (narrator skill) → InteractionResult { outcome: "..." }
        → LLM generates narrative reply
      → text deltas pushed via WebSocket
        → Viewer App displays narrative in overlay
```

---

## Skill Activation Flow

```
POST /generators/activate { category: "generator", name: "generator-marble" }
  → SkillLoader.activate("generator", "generator-marble")
    → write skills.active.json

Next dispatch in any session:
  hydrateActiveSkills()
    → SkillLoader.getActiveSkill("generator") → generator-marble
    → generator-marble is code-generator: no SKILL.md injection
    → create_scene tool will call ThreeDProvider.generate() instead
```

Skill changes take effect at the **next message boundary** — no server restart required.

---

## WebSocket Real-time Updates

```
Viewer App
  WS /realtime/:sessionId
    ← { type: "text_delta", delta: "..." }     LLM reply streaming
    ← { type: "scene_update", scene: {...} }   scene mutation after tool call
```
