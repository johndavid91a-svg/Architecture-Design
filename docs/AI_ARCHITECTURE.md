# AI architecture

## Control flow

```
  user instruction + selected scope
              │
              ▼
    ┌───────────────────┐
    │ AI DESIGN DIRECTOR│  decomposes into tasks, flags which need
    └─────────┬─────────┘  architectural approval, asks for clarifications
              │
   ┌──────────┼──────────┬─────────────┬──────────────┐
   ▼          ▼          ▼             ▼              ▼
Architect  Interior   Exterior    Space Opt.    Material Spec.
   │          │          │             │              │
   │          └──────────┴─────────────┴──────────────┘
   │                     │
   │                     ▼
   │            design-layer proposal
   │                     │
   │                     ▼
   │       ┌──────────────────────────────┐
   │       │ clearance validation         │  fits? blocks a door?
   │       │ geometry fingerprint check   │  moved a wall?
   │       └──────┬───────────────┬───────┘
   │              │               │
   │            pass            fail
   │              │               │
   │              ▼               ▼
   │           applied      correction brief ──┐
   │                             ▲             │
   │                             └─────────────┘
   │                              re-prompt with measurements
   ▼
architectural proposal ──▶ NEVER auto-applied. Goes to the user for
                           approval, labelled as requiring review by a
                           qualified architect or engineer.
```

An agent never writes to the twin. It returns a proposal; the proposal is
validated; only a proposal that survives validation is applied.

Contracts: `packages/core/src/ai/contracts.ts`.

## Why validation, not prompting

A model asked for "a premium reception" will specify a 3.6 m desk for a 3 m room.
Not occasionally — reliably, because it is reasoning about what a premium
reception looks like, not about whether the furniture fits.

Prompting reduces the rate. It does not reach zero, and the failures that get
through are the expensive ones, because they look plausible. So the geometry is
checked:

- **Clearance validation** (`design/clearance.ts`) — does it fit inside the room
  polygon, does it pass into a wall, does it obstruct a door, does it stand in an
  escape route, does it overlap other furniture, does its working clearance fit
- **Geometry fingerprint** (`model/guard.ts`) — did the response change the base
  architecture

Both return measurements, not verdicts. A failure produces a correction brief
naming the item, the measured distance and the required distance, which converges
far faster than asking the model to try again — and leaves a record of what was
wrong.

Every brief ends with: *"Do not resolve these by changing room dimensions. The
architecture is fixed; change the furniture selection, size, quantity or position
instead."*

## Ground rules given to every agent

Verbatim in `AGENT_GROUND_RULES`. The two that carry the most weight:

**Rule 3 — escape routes.** Never obstruct a door, and never obstruct anything
marked as an emergency exit. Escape routes outrank every layout preference
without exception. This is also enforced in code: an item within the required
clearance of a designated exit is an `error`, never a `warning`.

**Rule 6 — no numbers.** Never state a price, a cost, a saving or a quantity. The
agents do not have pricing data. A number an agent invents is indistinguishable
from a real one to the user reading it, and it would arrive wrapped in confident
design rationale. Quantities come from the takeoff engine and costs from the
estimation engine, both deterministic and both auditable.

This is why `ValueEngineeringSuggestion.estimatedSaving` is optional: the agent
proposes a substitution, and the saving is computed from real prices afterwards.
An agent asserting a saving is fabricating a price by another route.

## The architect is different

`ArchitecturalProposal` is the one agent output that touches geometry, and it is
never applied automatically. Its type carries
`requiresProfessionalReview: true` as a literal — present so it cannot be
forgotten at a call site — along with the assumptions made and the structural
elements the proposal assumes stay put.

The flow is: propose → show the user → user authorises with
`professionalReviewAcknowledged` → the guard permits the change. A change
authorised without that acknowledgement is still refused.

## Themes as constraints

A theme is handed to an agent as prose, not JSON (`themeToBrief`). Negative
constraints carry most of the value — "avoid literal rocket imagery, chrome, blue
LED strip used as decoration" — and models follow prohibitions written as
sentences far more reliably than prohibitions encoded as fields.

## Scope

The user selects building, floor, room or exterior before typing. Scope is part
of the request, so "make this room more luxurious" cannot quietly restyle the
building. Floor-level design reads `Floor.purpose`, which is what lets one
building have a GIS department on one floor and executive management on another
without the instruction having to restate it.

## Reference images and brand

`BrandContext` carries logo, website, palette and guidelines text.
`DesignRequest.referenceImages` carries local file paths. Both are inputs to the
design brief. A reference image is analysed for its design language — palette,
materials, lighting, hierarchy — and that language is applied within the actual
room dimensions. It is not reproduced as an image.

## Implementation status

Contracts, ground rules, theme briefs, clearance validation and the integrity
guard are implemented and tested. The model calls are not wired up.

That ordering is deliberate. The validators are what make agent output safe to
apply, and building them first means the first agent call lands into a system
that can already reject a bad answer. Wiring a model in and adding validation
afterwards produces a period where wrong designs reach the twin, and the twin is
what the user's cost estimate is built on.
