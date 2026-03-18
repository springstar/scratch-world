# Skill System Discussion

> Status: Design discussion in progress. Not yet implemented.
> Resume from this document in future sessions.

---

## What Prompted This

The Three.js renderer produces poor visual results. Rather than patching the renderer repeatedly,
we want a **skill mechanism** so unsatisfying components (scene generation, rendering, narration)
can be replaced without editing core code. Required operations: **add / remove / update / load / trigger**.

---

## Reference: bubbuild/bub

We studied [bubbuild/bub](https://github.com/bubbuild/bub) (Python, hook-first AI framework).

| Aspect | Bub | Our design |
|--------|-----|------------|
| Skill definition | `SKILL.md` only (Markdown + YAML frontmatter) — documentation, no code | `skill.json` + `index.ts` + `SKILL.md` |
| Discovery | Filesystem scan per run, no explicit registration | Scan at startup + explicit `add/remove` API |
| Loading hierarchy | project > global > builtin (3 levels) | **Same — adopted from Bub** |
| Lifecycle | No runtime CRUD; filesystem is source of truth | Runtime `add/remove/update` + `skills.active.json` |
| Triggering | Passive — injects docs into model prompt, model decides | Active — code executes at defined call sites |
| Context awareness | Progressive disclosure: metadata → body → resources | Manifest read at discovery; `index.ts` imported only on `activate()` — adopted |
| Type safety | Weakly typed Python | Strongly typed TypeScript + TypeBox |

**Borrowed from Bub:**
- 3-level directory hierarchy (project > global > builtin)
- `SKILL.md` alongside every skill for human-readable documentation
- Lazy implementation loading (manifest scanned eagerly; code imported only on activation)

**Why we differ from Bub:**
- Bub is a meta-framework where the LLM is the runtime. Skills are documentation injected into the
  model context; the model executes everything.
- Our backend is a long-running Node.js server with TypeScript as runtime. Skills need real executable
  code (`index.ts`) for providers, narrators, and tools.
- We need explicit CRUD because Node.js doesn't rescan the filesystem between requests (unlike Bub's
  per-run CLI model).
- We need an active-selection concept because `SceneManager` accepts exactly one `ThreeDProvider` —
  skills are substitutional (one active per category), not additive.

---

## Architecture: Two Roles of Claude

The key insight that shaped the design: Claude plays different roles depending on whether a
specialized 3D model is available.

```
Mode A — No specialized 3D model:
  User ──→ Claude (Sonnet)
             ├─ conversation & intent parsing
             └─ generates SceneData JSON directly
                 (guided by generator skill's SKILL.md in system prompt)

Mode B — Specialized 3D model (e.g. Marble, WorldLabs):
  User ──→ Claude (Sonnet)
             ├─ conversation & intent parsing  (Claude only)
             └─ calls create_scene tool
                   └─→ Marble / WorldLabs API (specialized)
  Normal chat never reaches the specialized model.
```

This means **generator skills have two subtypes**:

| Subtype | Files | How it works |
|---------|-------|--------------|
| `prompt-generator` | `SKILL.md` only — no `index.ts` | SKILL.md injected into system prompt; Claude fills `sceneData` parameter directly in the tool call. No secondary LLM call. |
| `code-generator` | `skill.json` + `index.ts` + `SKILL.md` | `create_scene` tool delegates to `ThreeDProvider.generate()`; Claude only orchestrates. |

`generator-claude` → prompt-generator (default; no specialized model needed)
`generator-marble` → code-generator (delegates to Marble API)

---

## System Interaction Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  SKILL SYSTEM                                                          │
│  skills.active.json: { "generator": "generator-claude", ... }         │
│                                                                        │
│  SkillManager                                                          │
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
                                │      skill-registry: findHandler(type)  │
                                └─────────────────────────────────────────┘
```

---

## Skill Switching Mid-Session: `hydrateActiveSkills()`

**Question raised:** If a user sends casual chat then immediately a scene-creation request, does the
skill switch correctly and in time?

**Answer:** Two separate concerns:

1. **Intent recognition** (casual vs scene-creation): handled by Claude's own reasoning based on the
   system prompt instruction "when a user describes a place to create, call create_scene". No skill
   system involvement.

2. **Skill switch timing:** `SessionManager` calls `hydrateActiveSkills()` at the start of every
   dispatch, after `hydrateActiveScene()`. This re-reads the active skill from `SkillManager` and
   updates the agent's system prompt before each message.

```
_dispatch(msg):
  getOrCreateAgent()
  hydrateActiveScene()    ← existing: injects active scene context
  hydrateActiveSkills()   ← new: injects active generator SKILL.md (if prompt-generator)
  agent.prompt(msg.text)
```

**Guarantee:** Skill changes take effect at the next message boundary. No server restart required.
The per-session serial queue prevents races between skill switches and concurrent dispatches.

---

## Open Questions / Not Yet Decided

- Should narrator skills also support a `prompt-narrator` subtype (Claude narrates inline) in addition to `code-narrator` (separate Haiku call)?
- Should the `/skills/activate` REST endpoint trigger `hydrateActiveSkills()` on all live sessions, or only on the next dispatch? (Current design: next dispatch only — simpler, sufficient for most cases.)
- Frontend renderer skills: the current plan extracts existing Three.js shapes into handler files. Should renderer skills also support loading from `.agents/skills/` (requires dynamic import in Vite)?
- Should the agent have a `list_skills` / `activate_skill` tool so the user can manage skills through natural language?

---

## Built-in Skills (Planned)

```
src/skills/built-in/
  generator-claude/   SKILL.md only  (prompt-generator — default)
  generator-marble/   skill.json + SKILL.md + index.ts
  generator-stub/     skill.json + SKILL.md + index.ts
  narrator-haiku/     skill.json + SKILL.md + index.ts
  generator-test/     skill.json + SKILL.md + index.ts  (3 fixed objects, no API)
  narrator-test/      skill.json + SKILL.md + index.ts  (fixed string return, no API)
```

3-level discovery: `.agents/skills/` (project) > `~/.agents/skills/` (global) > `src/skills/built-in/`
