---
type: Integration
title: Laya Integration
description: Records the hybrid Laya and Pi reasoning architecture, adapter contract, and safety rules.
tags: [journeytest, laya, reasoning, pi, safety]
timestamp: 2026-09-28T00:00:00Z
source_files:
  - src/journey/types.ts
  - src/journey/runner.ts
  - src/journey/reasoning.ts
  - src/directors/pi/piSdkDirector.ts
  - src/app/runtime.ts
---

# Laya Integration

Gate B implements the SystemOne remote path to a real `localdecide` server.
An observation contains the URL, title, visible snapshot text, and interactive
elements with stable JourneyTest-owned references. The evidence stored for each
step includes the complete numbered candidate set, typed decision, confidence,
validation outcome, execution result, screenshot path, and timings.

Decisions use a closed operation vocabulary. Click, text, and select operations
must name an offered non-negative element index. Runtime validation rejects
malformed decisions and out-of-range indexes; the confidence gate refuses low
confidence executable operations. `DONE` and `BLOCKED` may stop safely below the
threshold. `NAVIGATE` cannot execute a model-provided URL.

`SystemOneRemoteBackend` implements lifecycle, health, authorization, abort, and
timeout behavior. It sends `{model, state, questions}` to `/v1/systemone` and
requires `{answers}` plus optional `backend`, `model`, and `latency_ms` fields.
Non-success HTTP responses, invalid JSON, missing answers, malformed choices,
probability mismatch, non-argmax choices, invalid indexes, and low-confidence
actions all fail closed.

`LayaAgent` is the fast System-1 action selector. It applies stable, goal-aware scoping while preserving original
JourneyTest indexes. Candidate questions wider than the configured limit use
client-side coarse-to-fine inference; the chunk count and intermediate winners
are retained in evidence. Browser execution remains in `JourneyRunner`. Although
the Laya wire contract retains `DONE` and `BLOCKED`, an enabled reasoning layer
does not accept either as an authoritative journey verdict.

## Hybrid reasoning supervision

`JourneyRunner` can receive a `ReasoningController`. It initializes a validated
goal state, assesses only termination candidates, deterministic stuck or
low-confidence signals, and optional periodic checkpoints, and produces a
structured final verdict. A returned `next_subgoal` is compact advisory context:
Laya receives the original goal plus that subgoal on its next selection. The
reasoner receives bounded visible text, controls, and the five most recent
actions—not an unbounded trace and not browser or shell tools.

Explicit `url_contains`, `url_equals`, `visible_text`, and element-ref
`selector_present` success criteria run before cloud assessment. Proven success
confirms `DONE` at zero additional reasoning calls; a failed criterion rejects premature `DONE`.
Repeated identical actions or unchanged observations trigger recovery after
`REASONING_NO_PROGRESS_STEPS` (default 3). Periodic reasoning is disabled by
default; set `REASONING_CHECKPOINT_EVERY_N_STEPS` to a positive interval.

The Pi implementation deliberately reuses the director's `pi-ai` `getModel`
provider/model resolution, Pi Agent SDK request lifecycle, thinking levels, and
optional `getApiKey(provider)` callback. The existing `PiSdkDirector` remains
responsible for the authored `UserJourney` path: browser tool orchestration,
tester profiles, pass/fail/blocker criterion validation, artifact recording,
and the rich `AgentVerdict`. Those browser tools and authored-journey prompt are
legacy-path-specific and are not exposed to the supervisor. Reusable pieces are
provider/model selection, API-key callback behavior, JSON extraction, strict
schema validation, and the public-rationale-only verdict pattern.

Service configuration is:

```text
REASONING_MODE=off|pi                    # default: off
REASONING_PROVIDER=anthropic             # any provider supported by installed pi-ai
REASONING_MODEL=<provider model id>
REASONING_THINKING_LEVEL=low|medium|high # default: medium
REASONING_CHECKPOINT_EVERY_N_STEPS=0     # default: disabled
REASONING_NO_PROGRESS_STEPS=3
```

Pi uses its existing provider authentication conventions. API-key providers
read the provider environment variables supported by `pi-ai` (for example
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`); embedders can pass
the same `getApiKey(provider)` callback used by `PiSdkDirector`. No key is stored
in a result. With `REASONING_MODE=off`, the service remains offline-compatible
and explicitly uses historical Laya-only termination behavior.

`JourneyResult.reasoning`, reasoning events, and metrics separate execution
termination from the validated verdict. Evidence records trigger, provider,
model, latency, decision, confidence, reason code, next subgoal, and whether a
deterministic check avoided a call. Metrics include `laya_calls`,
`laya_total_ms`, `reasoning_calls`, `reasoning_total_ms`, and token/cost fields
when the provider exposes them. Hidden reasoning is never persisted.

The real smoke used `localdecide serve` with `laya-torch` on CPU and
`ichenney/laya-browser-v32b` (`v32b`, revision
`161d54d6000913ff279b0afd1ac77faef8685a9b`). Cold startup plus the first
request took 19.8 seconds, the measured process RSS after loading was about
2.18 GiB, and the two real journey inferences took 973 ms and 622 ms (median
797.5 ms). The model selected `CLICK` index 1 at
confidence 0.9695 from Home, Pricing, and Documentation. JourneyTest resolved
that to agent-browser reference `e3`, clicked it, captured a screenshot, then
accepted `DONE` on the pricing page. The result completed in 9.6 seconds.

The retained `0.15` confidence threshold was not changed. Four small contract
fixtures produced v32b confidences 0.9996, 1.0, 1.0, and 1.0; the last was an
incorrect `CLICK` instead of `DONE`, demonstrating that confidence is not
correctness. The real browser `DONE` confidence was 0.6027. More fixtures are
needed before changing the threshold.

The same four-case contract battery was run against `cklxx/laya-browser`
revision `ac29aefbc3a9b541f270e122e2e36d7e7081adaa`, subfolder `v17s`. Both
models passed click, type-target, and select-target selection and missed the
synthetic DONE case. Median reported inference was 747.5 ms for v32b and
534.5 ms for v17s. On 5, 20, and 25 click candidates both chose the expected
target; at 25, JourneyTest's two-chunk coarse-to-fine path was used. These are
observations from a small CPU fixture set, not a general superiority claim.
