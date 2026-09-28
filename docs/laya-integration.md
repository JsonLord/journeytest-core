---
type: Integration
title: Laya Integration
description: Records the Laya adapter contract, safety rules, and current implementation status.
tags: [journeytest, laya, safety]
timestamp: 2026-09-27T00:00:00Z
source_files:
  - src/journey/types.ts
  - src/journey/runner.ts
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

`LayaAgent` applies stable, goal-aware scoping while preserving original
JourneyTest indexes. Candidate questions wider than the configured limit use
client-side coarse-to-fine inference; the chunk count and intermediate winners
are retained in evidence. Browser execution remains in `JourneyRunner`.

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
