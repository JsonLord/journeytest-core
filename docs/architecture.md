---
type: Architecture
title: Laya Journey Service Architecture
description: Defines the shared JourneyService boundary and browser-runtime ownership.
tags: [journeytest, architecture, laya]
timestamp: 2026-09-27T00:00:00Z
source_files:
  - src/journey/service.ts
  - src/journey/runner.ts
  - src/journey/types.ts
---

# Laya Journey Service Architecture

`JourneyService` is the application boundary for future CLI, HTTP, Gradio, and
MCP adapters. It owns journey records, cancellation, results, and events. Each
run delegates to `JourneyRunner`, which exclusively owns the browser lifecycle,
observations, safe action execution, screenshots, termination, and
`JourneyResult v1` persistence.

The runner depends only on `JourneyAgent.decide(observation, state, context)`.
`ScriptedAgent` and `MockAgent` make the whole service path deterministic. A
future `LayaAgent` fits the same boundary: Laya selects a typed operation and an
index from JourneyTest's offered candidates, while JourneyTest resolves the
index and executes it. Model-produced selectors, code, and arbitrary navigation
are never executed.

The original authored-journey `runJourney` and Pi director remain available.
Gate A establishes the new service-oriented path without silently changing
existing CLI behavior.

## Runtime admission and lifecycle

The service defaults to one active browser journey and ten queued journeys.
`MAX_CONCURRENT_JOURNEYS` and `MAX_QUEUED_JOURNEYS` can tighten those bounds.
Admission is reserved during creation: accepted requests receive `202`, while a
full active-plus-queued budget receives structured `429 CAPACITY_EXCEEDED`.
This avoids accepting work that later fails invisibly in the detached runner.

Slots are handed directly from a finishing run to the oldest waiter, so a new
request cannot race a queued request and exceed the active limit. Status
responses expose `queued_at`, `started_at`, `queue_wait_ms`, and cancellation
timestamps. Readiness reports the active/queued/browser-slot counters; capacity
fullness does not make the process unready while bounded queueing remains a
supported service state.

The runner owns one driver per journey and pairs driver start/close and trace
start/stop in `finally`. A requested trace is advertised only after successful
finalization. Cancellation is propagated with `AbortSignal`, emits
`journey.cancel_requested` and `journey.cancelled`, reaches a terminal
`cancelled` service state, clears session credentials, and releases its slot.
The production runtime intentionally defaults to serialization because its
agent-browser invocation does not assign per-journey shared-tab labels; raising
the active limit is an operator opt-in rather than a claim of browser isolation.

All controlled API errors use an `{error: {code, message, retryable}}` envelope.
Artifacts are served only from result-declared paths with explicit binary MIME
type and length. The Python public proxy buffers (rather than streams) upstream
bodies, preserving byte content, status, content type, disposition, and cache
policy; it maps upstream connection failures to structured 502 and upstream
deadlines to structured 504.
