# SPEC.md --- JourneyTest Core Fork with LocalDecide/Laya, Gradio UI, CLI, API, and Hugging Face Deployment

## 0. Mission

Adapt this **JourneyTest Core fork** into a standalone developer service
for reproducible browser journeys driven by Laya.

The service must provide:

1.  a shared JourneyTest execution core;
2.  a local Laya decision layer;
3.  a Gradio developer UI;
4.  a terminal CLI;
5.  a versioned HTTP API;
6.  automatic local Laya startup in Hugging Face Space deployments;
7.  a clean future integration boundary for AUX;
8.  a clean future MCP boundary without creating a second journey
    engine.

A major implementation input is:

-   `JsonLord/laya-browser-agent` / upstream
    `ChenneyZhuang/laya-browser-agent`

This repository must be audited and reused where appropriate for: - Laya
model backends; - local inference lifecycle; - typed decision
contracts; - browser element-table construction; - answer validation; -
confidence gating; - scoping/chunking; - diagnostics; -
SystemOne-compatible wire formats.

Do **not** replace JourneyTest's own browser execution/runtime with the
`laya-browser-agent` browser loop.

The central invariant is:

``` text
Gradio ─┐
CLI ────┼── JourneyService → JourneyTest Core → JourneyAgent → LayaAdapter
API ────┘                                  │             │
                                           │             ├── localdecide/Laya backend
                                           │             ├── remote SystemOne backend
                                           │             └── mock backend
                                           │
                                           └── isolated browser + evidence
```

JourneyTest remains authoritative for browser lifecycle, execution,
evidence, journey state, termination, and results.

------------------------------------------------------------------------

# 1. Repository Audit

Before changing code:

1.  inspect the JourneyTest Core fork completely;
2.  inspect `JsonLord/laya-browser-agent` completely;
3.  identify current JourneyTest:
    -   runner;
    -   browser driver;
    -   schemas;
    -   event stream;
    -   screenshots/video/trace support;
    -   reporting;
    -   CLI/API/UI;
    -   tests;
    -   Docker/HF setup;
4.  identify in `laya-browser-agent`:
    -   `localdecide.backends`;
    -   model loading;
    -   decision schemas;
    -   element-table representation;
    -   scoping logic;
    -   chunking logic;
    -   confidence gates;
    -   validation;
    -   `doctor`;
    -   `/v1/systemone`;
    -   Playwright/CDP loop;
    -   MCP implementation;
5.  decide what to reuse directly, what to adapt, and what to leave out.

Document:

``` text
docs/architecture.md
docs/laya-integration.md
docs/upstream-sources.md
docs/implementation-notes.md
```

`docs/upstream-sources.md` must record: - repository URL; - exact commit
SHA used as reference; - license; - copied/adapted files or concepts.

------------------------------------------------------------------------

# 2. Architectural Boundary

## JourneyTest owns

``` text
browser lifecycle
isolated browser contexts
navigation
click/type/select/scroll/wait execution
journey state
task termination
timeouts
evidence
screenshots
DOM/a11y snapshots
video/trace if supported
events
JourneyResult
API job lifecycle
```

## Laya / localdecide contributes

``` text
local Laya model loading
MLX/PyTorch backend selection where useful
typed decision contracts
element-table decision format
answer validation
confidence gating
safe index selection
goal-aware scoping
chunking/coarse-to-fine decisions where useful
SystemOne-compatible request/response ideas
diagnostics and smoke-test patterns
```

## Do not import as authoritative runtime

Do not use these as JourneyTest's main engine:

``` text
BrowserDecider.run()
localdecide loop.py
localdecide PlaywrightDriver lifecycle
localdecide MCP server
localdecide CLI
```

They may be used as reference implementations or selectively reused
behind adapters.

------------------------------------------------------------------------

# 3. Shared Journey Service

All interfaces use the same application service:

``` python
class JourneyService:
    async def create_journey(...): ...
    async def run_journey(...): ...
    async def get_journey(...): ...
    async def get_result(...): ...
    async def get_events(...): ...
    async def cancel_journey(...): ...
```

Do not create separate logic for: - Gradio; - CLI; - API.

------------------------------------------------------------------------

# 4. JourneyAgent Boundary

Formalize:

``` python
class JourneyAgent(Protocol):
    async def decide(
        self,
        observation: Observation,
        state: JourneyState,
        context: JourneyContext,
    ) -> AgentDecision:
        ...
```

Implement:

``` text
JourneyAgent
├── LayaAgent
├── ScriptedAgent
└── MockAgent
```

The JourneyRunner depends on this protocol only.

------------------------------------------------------------------------

# 5. Laya Backend Boundary

Implement:

``` python
class LayaBackend(Protocol):
    async def start(self) -> None: ...
    async def infer(self, request: LayaInferenceRequest) -> LayaInferenceResponse: ...
    async def health(self) -> LayaHealth: ...
    async def close(self) -> None: ...
```

Required backends:

``` text
LocalDecideEmbeddedBackend
SystemOneRemoteBackend
MockLayaBackend
```

Optionally keep a generic `EmbeddedLayaBackend` alias if useful.

------------------------------------------------------------------------

# 6. Reuse Strategy for laya-browser-agent

Audit `JsonLord/laya-browser-agent` first.

Prefer reuse/adaptation of:

``` text
localdecide.backends
localdecide page/element-table contracts
typed question/answer schemas
validation rules
confidence gating
scope/scoping logic
chunking/coarse-to-fine logic
doctor-style diagnostics
SystemOne wire-format compatibility
```

Important rules:

1.  Do not vendor the entire project blindly.
2.  Do not duplicate code unnecessarily.
3.  Prefer a pinned dependency if its package boundary is stable enough.
4.  If direct dependency is awkward, copy/adapt the smallest modules
    needed and record provenance.
5.  Preserve Apache-2.0 notices for copied/adapted code.
6.  Keep JourneyTest's browser execution separate.

------------------------------------------------------------------------

# 7. Laya Model Candidate

Treat `ichenney/laya-browser-v32b` as the first model candidate to
benchmark because `laya-browser-agent` reports stronger browser-specific
performance than the older checkpoint.

Do not trust benchmark claims blindly.

Implement an internal comparison path where practical:

``` text
candidate A: ichenney/laya-browser-v32b
candidate B: cklxx/laya-browser
```

For v1, choose one default only after a real JourneyTest
smoke/acceptance comparison.

Record: - checkpoint; - revision; - backend; - device; - latency; -
acceptance results.

------------------------------------------------------------------------

# 8. Inference Modes

Support:

``` text
LAYA_MODE=auto|embedded|remote|mock
```

Resolution:

``` text
explicit setting wins

else if Hugging Face Space:
    embedded

else if remote endpoint configured:
    remote

else:
    embedded
```

Never silently fall back from broken real inference to `mock`.

------------------------------------------------------------------------

# 9. Embedded Laya

Embedded mode must:

-   load once per service process;
-   reuse the model/session;
-   not reload per journey;
-   not reload per step;
-   support safe concurrent calls;
-   expose health/readiness;
-   clean up on shutdown.

Use `laya-browser-agent` backend logic where compatible: - PyTorch for
Linux/HF Space; - MLX may remain supported locally on Apple Silicon if
easy.

Configuration:

``` text
LAYA_MODEL_REPO
LAYA_MODEL_PATH
LAYA_MODEL_REVISION
LAYA_BACKEND
LAYA_DEVICE
LAYA_TIMEOUT_SECONDS
```

If files come from Hugging Face Hub, use normal HF cache behavior.

------------------------------------------------------------------------

# 10. SystemOne Remote Backend

Support remote SystemOne-compatible inference:

``` text
POST /v1/systemone
```

Configuration:

``` text
LAYA_REMOTE_URL
LAYA_REMOTE_API_KEY
LAYA_REMOTE_TIMEOUT
```

This enables JourneyTest to talk to: - another localdecide deployment; -
a dedicated remote Laya service; - compatible decision services.

JourneyTest Core must not care where inference runs.

------------------------------------------------------------------------

# 11. Observation and Element Table

JourneyTest produces the browser observation.

Then `LayaAgent` converts that observation into the compact decision
representation.

Observation may include:

``` text
URL
page title
viewport
visible text summary
interactive elements
roles
accessible names
enabled state
current values
previous action/result
```

Laya-facing decision input should use a numbered/stable element table
inspired by `laya-browser-agent`.

Example:

``` text
[0] link    "Pricing"
[1] button  "Start free trial"
[2] link    "Documentation"
```

Each offered element maps back to a JourneyTest-owned element reference.

The model must never return arbitrary selectors or executable code.

------------------------------------------------------------------------

# 12. Scoping

Reuse or adapt `laya-browser-agent` goal-aware scoping.

Reason: - decision quality drops with excessive element counts; -
latency also grows with large candidate tables.

Create a configurable scope:

``` text
LAYA_MAX_ELEMENTS
LAYA_SCOPE_STRATEGY
```

Start with a conservative default around the range demonstrated
effective by `laya-browser-agent`, then validate empirically.

Important: - goal-relevant controls should not be discarded casually; -
preserve enough context for navigation; - record offered candidate set
in evidence.

------------------------------------------------------------------------

# 13. Chunking / Coarse-to-Fine

If candidate count exceeds the safe scope:

1.  scope first;
2.  only then use chunking/coarse-to-fine.

Borrow `laya-browser-agent`'s approach where useful.

Record: - chunk count; - intermediate winners; - final confidence.

Do not hide this from evidence/debugging.

------------------------------------------------------------------------

# 14. Confidence Gating

Laya outputs must be confidence-aware.

Possible outcomes:

``` text
OK
LOW_CONFIDENCE
INVALID
TIMEOUT
ERROR
```

JourneyTest decides policy.

For Phase 1:

-   do not execute malformed output;
-   do not execute unsupported options;
-   do not execute invalid element indexes;
-   allow configurable confidence threshold;
-   preserve low-confidence events as evidence.

This is important because later AUX may treat low confidence as a
friction signal.

------------------------------------------------------------------------

# 15. Text Entry

Decision models choose **what** to type into, but may not generate
free-form text.

Therefore separate:

``` text
action selection
text generation/value resolution
```

Implement a `TextProvider` abstraction.

Initial implementations:

``` text
GoalTextProvider
StaticTextProvider
MockTextProvider
```

If the goal explicitly includes a string to type, the provider may
extract it.

Do not add a large LLM dependency just to satisfy basic text entry in
Phase 1.

Later AUX/persona logic can provide text values.

------------------------------------------------------------------------

# 16. Structured Decisions

Initial action vocabulary:

``` text
CLICK
TYPE_TEXT
SELECT
SCROLL
WAIT
BACK
NAVIGATE
DONE
BLOCKED
```

JourneyTest maps these to its own internal actions.

Example:

``` json
{
  "operation": "CLICK",
  "element_index": 4,
  "confidence": 0.88
}
```

JourneyTest then resolves index `4` to its own browser element
reference.

Never allow model output to become: - JavaScript; - selector text; -
shell command; - arbitrary URL fetch.

------------------------------------------------------------------------

# 17. Journey Loop

Authoritative loop remains JourneyTest:

``` text
initialize journey
      ↓
create isolated browser context
      ↓
navigate
      ↓
JourneyTest observation
      ↓
LayaAgent → localdecide decision layer
      ↓
validate
      ↓
JourneyTest action execution
      ↓
record evidence
      ↓
repeat
```

Termination:

``` text
DONE
BLOCKED
success condition
timeout
max steps
browser failure
policy violation
cancellation
```

------------------------------------------------------------------------

# 18. Evidence

Capture at minimum:

``` text
step
timestamp
URL
candidate element table
Laya operation
selected element index
confidence
validation result
execution result
timings
screenshot
browser error
termination
```

This becomes critical later for AUX.

Potential future friction signals:

``` text
low confidence
repeat action
backtrack
BLOCKED
action failure
long dwell/inference
repeated candidate ambiguity
```

Do not implement AUX analysis yet; just preserve the evidence.

------------------------------------------------------------------------

# 19. JourneyResult v1

Stable public contract.

Include:

``` json
{
  "schema_version": "1",
  "journey_id": "...",
  "status": "...",
  "goal": "...",
  "start_url": "...",
  "final_url": "...",
  "duration_ms": 0,
  "step_count": 0,
  "termination": {},
  "steps": [],
  "events": [],
  "artifacts": {},
  "metrics": {},
  "context": {},
  "agent": {
    "type": "laya",
    "backend": "embedded",
    "model": "...",
    "revision": "..."
  }
}
```

Do not expose internal Python objects.

------------------------------------------------------------------------

# 20. Terminal CLI

Required commands:

``` bash
journeytest run
journeytest ui
journeytest serve
journeytest space
journeytest doctor
journeytest info
```

Example:

``` bash
journeytest run \
  --url https://example.com \
  --goal "Open the pricing page" \
  --laya-mode embedded
```

Options:

``` text
--url
--goal
--context
--context-file
--max-steps
--timeout
--screenshots
--trace
--allowed-domain
--laya-mode
--json
--output
--verbose
```

Default terminal output:

``` text
[01] OBSERVE  13 candidates
[02] LAYA     CLICK [4] "Pricing" p=0.91
[03] ACTION   success 183ms
[04] NAV      /pricing
[05] LAYA     DONE p=0.96

✓ Completed
```

No chain-of-thought.

------------------------------------------------------------------------

# 21. JourneyTest Doctor

Incorporate useful ideas from `localdecide doctor`.

`journeytest doctor` checks:

``` text
environment
Python/runtime
browser executable
browser launch
Laya dependency
Laya checkpoint
backend
model load
single decision smoke test
artifact path
API dependencies
Space detection
```

On Space/Linux, show selected PyTorch/device backend.

------------------------------------------------------------------------

# 22. Gradio UI

Standalone Gradio developer UI.

Inputs:

``` text
URL
Goal
Max steps
Timeout
Capture screenshots
Capture trace
Laya mode
```

Advanced:

``` text
Context JSON
Allowed domains
confidence threshold
model/checkpoint if allowed
```

Running view:

``` text
journey ID
status
step
URL
candidate count
latest Laya action
confidence
latest screenshot
event feed
```

Results:

``` text
status
termination
duration
steps
timeline
screenshots
metrics
raw JourneyResult JSON
```

Developer tab:

``` text
API URL
curl example
Python example
Laya backend/model
health/readiness
```

------------------------------------------------------------------------

# 23. API

Expose:

``` text
GET  /api/v1/health
GET  /api/v1/ready
GET  /api/v1/info

POST /api/v1/journeys
GET  /api/v1/journeys/{id}
GET  /api/v1/journeys/{id}/result
GET  /api/v1/journeys/{id}/events
GET  /api/v1/journeys/{id}/artifacts/{artifact_id}
POST /api/v1/journeys/{id}/cancel
```

Use asynchronous jobs for public API calls.

------------------------------------------------------------------------

# 24. Gradio + API Composition

Serve both from one application/port.

Preferred:

``` text
/            Gradio
/api/v1/*    API
/docs        API docs
```

If FastAPI is used:

``` python
app = FastAPI()
app.include_router(...)
app = gr.mount_gradio_app(app, demo, path="/")
```

Do not run separate competing servers.

------------------------------------------------------------------------

# 25. Hugging Face Space Auto-Boot

Target command:

``` bash
journeytest space
```

Startup:

``` text
detect Space
   ↓
resolve LAYA_MODE=embedded
   ↓
load localdecide/Laya backend
   ↓
prewarm one decision if configured
   ↓
browser health check
   ↓
mount API
   ↓
mount Gradio
   ↓
listen 0.0.0.0:7860
```

No second manual model service should be necessary.

Use the local Python backend directly unless a real technical reason
requires a child process.

------------------------------------------------------------------------

# 26. Space Configuration

Default for Hugging Face:

``` text
LAYA_MODE=auto
LAYA_BACKEND=torch
MAX_CONCURRENT_JOURNEYS=1
```

Allow later configuration for more concurrency.

Expose readiness only once: - model loaded; - browser usable; - service
can accept jobs.

------------------------------------------------------------------------

# 27. Resource Limits

Support:

``` text
MAX_CONCURRENT_JOURNEYS
MAX_QUEUED_JOURNEYS
DEFAULT_MAX_STEPS
ABSOLUTE_MAX_STEPS
DEFAULT_JOURNEY_TIMEOUT
ABSOLUTE_JOURNEY_TIMEOUT
ARTIFACT_TTL_SECONDS
```

Start conservative.

Do not load one model per journey.

------------------------------------------------------------------------

# 28. Security

Each journey: - fresh browser context; - no shared cookies/storage; -
cleanup on completion/failure.

Reject: - `file://` - `javascript:` - `data:` - localhost; - loopback; -
private networks; - link-local; - metadata endpoints.

Validate redirects too.

Model may only choose from constrained action candidates.

------------------------------------------------------------------------

# 29. Tests

## JourneyTest unit tests

``` text
request validation
JourneyResult
termination
URL policy
artifact safety
CLI parsing
configuration
Space detection
```

## localdecide contract tests

Reuse/adapt test ideas for:

``` text
answer validation
invalid probabilities
invalid choice
confidence gates
element resolution
scoping
chunking
BLOCKED/DONE
```

## deterministic browser fixtures

Build local fixture pages for: - click; - type; - select; -
navigation; - scroll; - back; - DONE; - BLOCKED; - ambiguous choices.

## real Laya smoke

Separate heavyweight test:

``` text
JourneyTest browser observation
→ Laya element table
→ actual model decision
→ validated JourneyTest action
→ action executed
→ JourneyResult
```

## model comparison smoke

Where feasible compare: - `ichenney/laya-browser-v32b` -
`cklxx/laya-browser`

on the same fixture battery.

Do not claim the new checkpoint is better without actual results.

------------------------------------------------------------------------

# 30. Performance Metrics

Record:

``` text
observation_ms
scope_ms
inference_ms
validation_ms
action_ms
screenshot_ms
step_ms
journey_ms
candidate_count
```

Report model startup separately from steady-state inference.

------------------------------------------------------------------------

# 31. AUX Integration

AUX later calls JourneyTest over HTTP.

AUX sends:

``` text
URL
goal
context/persona metadata
options
```

JourneyTest returns:

``` text
JourneyResult v1
events
artifacts
```

AUX later owns: - friction analysis; - Eyeson; - UX knowledge; -
redesign; - cohort aggregation; - statistics; - retesting.

Do not add those here.

------------------------------------------------------------------------

# 32. Future MCP

Do not build a second runtime.

Future MCP wraps `JourneyService`.

Likely tools:

``` text
journey_create
journey_status
journey_result
journey_events
journey_artifact
journey_cancel
```

The existing `localdecide-mcp` is useful reference material only.

------------------------------------------------------------------------

# 33. Implementation Gates

## Gate A --- Audit + shared JourneyTest core

Deliver: - repo audit; - JourneyService; - JourneyAgent protocol; -
Mock/Scripted agent; - JourneyResult v1 skeleton.

Gate: \> deterministic journey runs end-to-end through JourneyService.

## Gate B --- localdecide/Laya integration

Deliver: - audit of `laya-browser-agent`; - backend integration; -
element-table adapter; - validation; - confidence gate; - scoping; -
real Laya smoke.

Gate: \> real JourneyTest observation produces and executes a valid Laya
decision.

## Gate C --- CLI

Gate: \> `journeytest run` executes a real journey and writes
JourneyResult.

## Gate D --- API

Gate: \> remote client can submit and retrieve a journey.

## Gate E --- Gradio

Gate: \> developer can run and inspect a real journey in browser UI.

## Gate F --- Hugging Face Space

Gate: \> fresh Space auto-loads Laya, initializes Chromium, exposes
UI+API, and completes a real journey.

------------------------------------------------------------------------

# 34. Definition of Done

Done only when:

-   JourneyTest remains authoritative browser runtime;
-   `laya-browser-agent` is used selectively, not wholesale;
-   provenance is documented;
-   local embedded Laya works;
-   remote SystemOne mode works;
-   model loads once;
-   element-table mapping is safe;
-   scoping works;
-   invalid/low-confidence output is handled safely;
-   CLI works;
-   API works;
-   Gradio works;
-   Space auto-boot works;
-   browser sessions are isolated;
-   JourneyResult v1 is stable;
-   evidence includes Laya confidence/candidates;
-   deterministic tests pass;
-   real Laya smoke is clearly reported;
-   AUX is still external;
-   MCP can later wrap the same JourneyService.

------------------------------------------------------------------------

# 35. Codex Working Rules

1.  Inspect both repositories before implementing.
2.  Do not reinvent functionality already cleanly provided by
    `laya-browser-agent`.
3.  Do not import its browser loop as JourneyTest's authoritative
    runtime.
4.  Preserve JourneyTest's own evidence and journey abstractions.
5.  Pin upstream versions/commits.
6.  Preserve license/provenance.
7.  Do not fabricate model APIs.
8.  Test real Laya separately from mocks.
9.  Do not silently fall back to mock.
10. Do not expose chain-of-thought.
11. Fail closed on invalid model actions.
12. Keep Gradio/CLI/API thin.
13. Run tests after each gate.
14. Run `git diff --check`.
15. Report exact deviations from this spec.

------------------------------------------------------------------------

# 36. Completion Report

Report:

``` text
1. JourneyTest architecture discovered
2. laya-browser-agent architecture discovered
3. What was reused directly
4. What was adapted
5. What was deliberately not reused
6. Final architecture
7. Files changed
8. Model/checkpoint used
9. Backend used
10. Scoping/chunking behavior
11. CLI status
12. API status
13. Gradio status
14. Space status
15. JourneyResult v1 status
16. Security controls
17. Tests and exact results
18. Real-Laya smoke result
19. Model comparison results if run
20. Known limitations
21. AUX integration contract
22. Future MCP boundary
```

Primary acceptance criterion:

> A fresh deployment of the JourneyTest Core fork can automatically boot
> local Laya in a Hugging Face Space, expose a Gradio UI and `/api/v1`,
> let Laya choose safe typed actions from JourneyTest-generated browser
> observations, execute those actions in isolated JourneyTest browser
> sessions, and return a stable JourneyResult v1 suitable for later AUX
> consumption.
