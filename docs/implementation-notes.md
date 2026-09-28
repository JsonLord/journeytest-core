---
type: Implementation Plan
title: Laya Implementation Gates
description: Short audited plan for Gates A through F.
tags: [planning, laya, journey-service]
timestamp: 2026-09-27T00:00:00Z
source_files:
  - spec.md
  - src/journey/service.ts
  - src/journey/runner.ts
---

# Laya Implementation Gates

- **Gate A (implemented):** shared in-memory `JourneyService`, authoritative
  `JourneyRunner`, `JourneyAgent`, deterministic scripted/mock agents, safe
  typed decisions, evidence, cancellation boundary, and `JourneyResult v1`.
- **Gate B (remote vertical slice implemented):** backend lifecycle protocol,
  remote SystemOne backend, `LayaAgent`, goal-aware scope, coarse-to-fine
  evidence, deterministic value providers, enriched observations, and a real
  v32b browser action. Embedded and mock Laya backends remain later Gate B work.
- **Gate C:** make `journeytest run` a thin service client while retaining legacy
  authored-file compatibility; add doctor/info and JSON output.
- **Gate D:** expose asynchronous `/api/v1` jobs over the same service, with URL
  policy, bounded queues, artifact safety, and lifecycle tests.
- **Gate E:** mount a Gradio developer surface on the API application and render
  the service's events/results rather than starting another runner.
- **Gate F:** detect Spaces, resolve `auto` to embedded, load/prewarm once,
  health-check Chromium, and serve the composed UI/API on port 7860.

Gate B's required remote vertical slice is real, not mocked. The four-case
contract battery scored 3/4 for both v32b and the currently published cklxx
`v17s`; both missed the synthetic DONE case. Both selected Pricing correctly at
5, 20, and 25 candidates, with coarse-to-fine used at 25. This small comparison
does not establish general benchmark superiority.

The two pre-existing shared-tab timing tests were rerun individually after Gate
B. They remained reproducibly failing: the stress case exceeded its 10-second
timeout; the latest isolated rerun measured queued release at 651 ms against a
250 ms assertion. Gate B and the interface stages did
not modify that shared-session implementation or relax those assertions.

The deployment-hardening stage installed Docker 29.1.3 and started dockerd with
the userspace `vfs` driver, but this container does not grant mount-namespace
capabilities. Both the legacy builder (`unshare: operation not permitted`) and
BuildKit (`bind mount: operation not permitted`) failed before reading the first
Dockerfile instruction. The image therefore still requires validation in a
Docker-capable host; no local container-boot claim is made.
