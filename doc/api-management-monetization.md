# API Management and Monetization Design

## Background

The project currently integrates multiple external APIs:
- **Claude Sonnet** (Anthropic) — agent reasoning, scene generation, NPC dialogue
- **Marble** (WorldLabs) — 3D Gaussian Splat scene creation
- **Hunyuan** (Tencent) — image-to-3D model generation

Planned additions (Path B 3D model workflow):
- **Meshy.ai** or **Rodin** — AI 3D mesh generation from text/image

As the API surface grows, exposing raw providers to users creates tight coupling between UX and vendor pricing/availability. This document describes the architecture for managing multi-provider APIs, user-facing capability selection, and billing.

---

## Design Principles

1. **Users see capabilities, not vendors.** Never expose vendor names or pricing in the UI.
2. **Credits as unified currency.** Normalize all provider costs behind a single in-app currency.
3. **Ability routers handle dispatch.** Each capability routes to the best available provider automatically, with user override for advanced settings.
4. **Credit ledger is append-only.** Account balance is derived from ledger rows, never stored as a mutable field.

---

## Architecture: Capability Routing

Extend the existing `ThreeDProvider` abstraction pattern to all external services:

```
Capability Layer (user-facing)    Router Layer (internal)    Vendor Layer (APIs)
─────────────────────────────     ───────────────────────    ───────────────────
"Generate 3D scene"         →     SceneGenRouter         →   Marble / Stub
"Generate 3D model"         →     ModelGenRouter         →   Meshy / Rodin / Hunyuan
"NPC dialogue"              →     LLMRouter              →   Claude Sonnet / Haiku
"Vision / image analysis"   →     VisionRouter           →   Claude Vision
```

Each router knows:
- Available providers for that capability
- Per-provider unit cost (in credits)
- Quality tier per provider
- Live availability/health status

Default behavior: auto-select by best quality/price ratio. Advanced users can pin a specific provider in settings.

### Interface sketch

```typescript
interface CapabilityRouter<TInput, TOutput> {
  route(input: TInput, options?: RouteOptions): Promise<TOutput>;
  providers(): ProviderInfo[];
}

interface RouteOptions {
  preferProvider?: string;   // pin to specific vendor
  qualityTier?: "fast" | "balanced" | "quality";
  maxCreditCost?: number;    // reject if estimated cost exceeds limit
}

interface ProviderInfo {
  id: string;
  name: string;
  creditCostPerCall: number;
  qualityTier: "fast" | "balanced" | "quality";
  available: boolean;
}
```

---

## Credit System

### Motivation

Provider pricing is opaque, volatile, and per-unit. Direct pass-through causes:
- User confusion when prices change
- Broken UX if a provider is swapped
- Complex multi-currency accounting

Credits solve this by decoupling user-facing cost from vendor cost. When a vendor raises prices, only the internal credit-to-vendor exchange rate changes; user-facing credit prices stay stable.

### Credit Costs (initial estimates — calibrate from real usage data)

| Operation | Credit Cost |
|-----------|-------------|
| Generate scene | 50 |
| Update scene | 10 |
| Generate 3D model | 20 |
| NPC dialogue (per 10 turns) | 5 |
| Image-to-3D conversion | 30 |

All high-cost operations (≥ 20 credits) show a confirmation prompt before executing.

### Credit Ledger Schema

```sql
CREATE TABLE credit_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,           -- positive = credit, negative = debit
  operation   TEXT NOT NULL,              -- e.g. "scene_generate", "model_gen"
  provider    TEXT,                       -- which vendor was called
  metadata    JSONB,                      -- scene_id, model_id, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Balance query (no mutable balance column)
SELECT SUM(amount) AS balance FROM credit_ledger WHERE user_id = $1;
```

Append-only: never update or delete ledger rows. This prevents race conditions on concurrent operations and gives a complete audit trail.

---

## Subscription and Billing Model

### Tiers

| Tier | Price | Monthly Credits | Notes |
|------|-------|-----------------|-------|
| Free | $0 | 100 | Core features, experience only |
| Basic | $9/mo | 500 | Standard support |
| Pro | $29/mo | 2,000 | High-quality model generation enabled |
| Enterprise | Custom | Custom | API access, private deployment option |

- Credits roll over up to 3 months (no expiry cliff each month).
- Extra credits purchasable outside subscription (one-time top-up).
- Subscription managed via **Stripe** (subscriptions + one-time charges).

### Implementation Notes

- Stripe webhook updates `credit_ledger` with subscription renewal credits.
- One-time top-up also writes to `credit_ledger`.
- Each API call deducts credits atomically before dispatch; if balance insufficient, operation is rejected before any vendor API is called.

---

## 3D Model Workflow Integration (Path B)

See also: `doc/research.md` for the A/B/C path comparison.

**Recommended primary workflow:**

1. User describes or uploads reference image
2. `ModelGenRouter` dispatches to Meshy.ai / Rodin / Hunyuan
3. Generated GLB URL returned → stored and referenced via `metadata.modelUrl`
4. IBL baked from the Marble scene's HDR environment is applied to the model material in Three.js to improve visual integration with the Gaussian Splat background
5. Model placed in scene via existing click-to-place flow

**Path C (2D inpainting) use cases only:**
- Static decorative elements (paintings, distant backdrops, signage)
- Non-interactive background atmosphere
- Never for objects that require click interaction, NPC navigation, or physics

---

## Implementation Roadmap

### Phase 0 (now): Data first
- Add `credit_ledger` table to schema
- Log every vendor API call with estimated credit cost
- No billing, no user-facing credits — just collect real cost distribution data

### Phase 1: Credit system
- Implement `CapabilityRouter` abstraction over existing providers
- Expose credit balance in UI
- Gate high-cost operations behind credit check
- Free tier: seed all users with 100 credits

### Phase 2: Payments
- Integrate Stripe
- Subscription tiers + one-time top-up
- Stripe webhook → `credit_ledger`

### Phase 3: Provider selection
- Advanced settings: let Pro users pin preferred vendor per capability
- Quality tier selector (fast / balanced / quality)
- Per-operation cost estimate shown before confirmation
