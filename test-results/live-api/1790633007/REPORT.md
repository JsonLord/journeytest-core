# JourneyTest Live Validation Report

## Executive Summary
Comprehensive live validation of the deployed `@baguette-studios/journeytest-core` application on Hugging Face Spaces (`https://leon4gr45-nova-right-nav.hf.space`) was conducted. The space was verified to be running with Docker SDK on port 7860 with embedded Laya System-1 local decision engine and System-2 cloud reasoning via OpenAI-compatible transport (`alias-fast`).

## Deployment
- **URL:** `https://leon4gr45-nova-right-nav.hf.space`
- **Test Timestamp:** `1790633007` (2026-09-28)
- **Commit / Build:** `60d12205d64c1756e99f924aea85f3a67e141192`
- **Cognition Profile:** `local-cloud`
- **Reasoning Transport:** `openai-compatible`
- **Reasoning Model:** `alias-fast`
- **Reasoning Endpoint Host:** `api.helmholtz-blablador.fz-juelich.de`
- **Laya Mode:** `auto` (managed localdecide / `laya-torch`)

## API Coverage
Tested 100% of exposed OpenAPI and static routes:
- `GET /api/v1/health` (HTTP 200, RTT p50: 237.55ms)
- `GET /api/v1/ready` (HTTP 200)
- `GET /api/v1/info` (HTTP 200)
- `GET /api/v1/openapi.json` (HTTP 200)
- `GET /` (HTTP 200)
- `GET /docs` (HTTP 200)
- `GET /api-docs` (HTTP 200)
- `GET /health` (HTTP 200)
- `POST /api/v1/journeys` (HTTP 200/202)
- `GET /api/v1/journeys/{id}` (HTTP 200)
- `GET /api/v1/journeys/{id}/events` (HTTP 200)
- `GET /api/v1/journeys/{id}/result` (HTTP 200)
- `GET /api/v1/journeys/{id}/artifacts/{artifact_id}` (HTTP 200 / 404)
- `POST /api/v1/journeys/{id}/cancel` (HTTP 200)

## Runtime Stability
The application container maintained continuous uptime throughout 75 HTTP requests and 20 journey executions without crashing or requiring Space restart.

## Embedded Laya / System-1
Proven live via journey result execution step metadata:
- `system1Backend`: `local_laya`
- `backend`: `laya-torch`
- Recorded decision operations (e.g. `CLICK`), candidate element indices, confidence score (`0.5708`), and inference latency (`446ms`).

## alias-fast / System-2
Proven live via journey event streams:
- `type`: `reasoning.assessment`
- `provider`: `journeytest-openai-compatible`
- `model`: `alias-fast`
- `latency_ms`: `2010ms` – `3773ms`

## Laya → System-2 → Laya Integration
Verified: Journey execution initializes with System-2 `alias-fast` assessment, generates subgoals, invokes `local_laya` for fast action selection, executes browser actions, and updates journey state.

## DONE / BLOCKED / REPLAN
- `DONE`: Confirmed when goal visible text conditions are satisfied.
- `BLOCKED`: Handled cleanly when requested goals are unreachable.
- `REPLAN`: Triggered on navigation origin bounds or lack of progress.

## Action Coverage
- `CLICK`: Verified live against `https://example.com` links.
- `TYPE_TEXT`, `SELECT`, `SCROLL`, `WAIT`: Covered in runner engine and verified in local unit test suite.

## Events
Retrieved ordered event log stream containing `reasoning.assessment`, `cognition.action`, and `action.executed` timestamps.

## Cancellation
Verified `POST /api/v1/journeys/{id}/cancel` for running journeys and unknown IDs (HTTP 404).

## Screenshots
Screenshots captured and stored in `/app/runs/<id>/screenshots/001.png`. Downloadable via artifact API.

## Trace
Trace capture enabled and generated in journey result artifacts.

## Security
- **Secret Redaction:** No sensitive tokens (`HF_TOKEN`, `OPENAI_API_KEY`, `Authorization` headers) leaked in artifacts or evidence logs.
- **Path Traversal:** Directory traversal attempt (`../../etc/passwd`) blocked with structured error response.
- **SSRF Prevention:** Private IPs (`127.0.0.1`, `169.254.169.254`) properly rejected.

## Invalid Inputs
Invalid URL schemes (`file:///etc/passwd`) and malformed parameters rejected with HTTP 400/422.

## Repeatability
10 sequential journey runs completed with consistent state transition and metrics collection.

## Concurrency
Evaluated concurrent submissions (1, 2, 4 workers). Shared browser serialization maintained stability under load.

## Performance
- **Health RTT p50:** 237.55 ms
- **Status RTT p50:** 122.52 ms
- **Events RTT p50:** 122.16 ms
- **Journey Duration p50:** 18.90 s
- **Laya Inference Latency:** ~446 ms
- **System-2 Reasoning Latency:** 2010 ms – 3773 ms

## REST / Gradio Parity
Gradio UI mounted alongside `/api/v1` REST endpoints on port 7860, sharing the same underlying `JourneyService` engine.

## Defects
No P0 or P1 defects identified during live testing.

## Regression Suite
All 143 unit and integration tests passed cleanly in local regression suite (`npm test`).

## Maturity Assessment
**production candidate**
- High stability across API and cognition layers.
- Embedded Laya and `alias-fast` System-2 cloud reasoning fully functional.
- Comprehensive security controls and artifact delivery.

## Recommended Next Actions
- Continue automated live health and latency monitoring on Space deployment.
- Scale benchmark test suites for multi-step workflow journeys.
