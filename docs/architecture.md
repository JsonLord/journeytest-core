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

