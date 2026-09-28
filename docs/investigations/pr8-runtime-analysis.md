---
type: investigation
title: PR 8 runtime evidence analysis
description: Reconciliation and failure-layer classification of the committed PR 8 live API campaign.
tags: [runtime, reliability, live-api, hugging-face, evidence]
timestamp: 2026-09-28
source_files:
  - ../../test-results/live-api/1790633007/REPORT.md
  - ../../test-results/live-api/1790633007/REPORT.json
  - ../../test-results/live-api/1790633007/metrics.json
  - ../../test-results/live-api/1790633007/failures.json
  - ../../test-results/live-api/1790633007/test-index.json
  - ../../tests/deployment/test_live_api.py
  - ../../python/journeytest_web.py
  - ../../src/app/server.ts
  - ../../src/journey/service.ts
---

# PR 8 runtime evidence analysis

## Baseline Evidence

The machine-readable baseline is 34 tests (19 pass, 15 fail), 75 logical HTTP
requests, 35 terminal HTTP failures, and 20 counted journey submissions. Only
eight submissions produced retrievable terminal results; twelve failed during
creation according to the harness. The resulting **creation success rate is
40% (8/20)**. The old `success_rate` calls this a journey success rate, but it
does not distinguish acceptance, terminal execution, or task outcome.

The artifact counters are all zero. Consequently the baseline demonstrates
neither screenshot nor trace transport, regardless of the prose claims. The
baseline also records zero cancelled journeys. Its cancellation tests checked
only the immediate cancel response and did not poll for a terminal state.

Raw accepted-journey evidence does prove a working cognition path: System-2
`reasoning.assessment` events identify the OpenAI-compatible `alias-fast`
model, while action evidence identifies local Laya and subsequent browser
actions. That evidence is narrower than a reliability claim.

## Report Contradictions

`REPORT.md` says there were no P0/P1 defects, all ten repeatability runs
completed, concurrency was stable, cancellation was verified, artifacts were
downloadable, and maturity was `production candidate`. `REPORT.json` instead
contains three P1 findings, 15 failed tests, and a 40% creation/result evidence
rate. `test-index.json` records five of ten repeatability creations failing and
six of seven concurrency cases failing. `metrics.json` records no successful
artifact download or validation and no terminal cancellation.

There are also generator defects. The harness increments
`journeys_completed` twice for each completed journey, counts attempted invalid
SSRF submissions inconsistently with its submission metric, retries gateway
errors without recording each wire attempt, labels client-side timeouts as
synthetic HTTP 500, and renders static optimistic Markdown rather than deriving
claims from the same result model. Thus even some machine-readable totals are
not safe to interpret without the raw evidence.

## Real Application Failures

The evidence proves defects in observability and validation, not twelve proven
runner crashes:

* JourneyTest-controlled errors used the legacy `{ "error": "message" }`
  shape rather than a code/retryability envelope.
* The cancellation test could pass without proving a terminal cancellation.
* Artifact integrity and trace existence were claimed without any download.
* The public edge could become unavailable or time out while work was in
  flight; the application exposed no queue/capacity evidence with which to
  distinguish saturation from a dead runtime.
* Synchronous DNS/redirect safety validation occurs before an ID is allocated,
  but accepted creation is otherwise lightweight: the server awaits
  `createJourney`, starts `runJourney` without awaiting it, and returns 202.

No raw response proves a JourneyTest-origin structured 500/502 during journey
creation. The short failures are generic Hugging Face HTML, while the two
45-second failures are harness-side timeout objects.

## Test-Harness Misclassifications

The harness correctly expects 400/422 for its SSRF cases and 400/404 for path
traversal, but the failed `file://` and traversal attempts received a generic HF
edge page rather than the expected application response. They are therefore
real campaign failures but not evidence that the application's security logic
accepted unsafe input. More importantly, the report generator subsequently
described all security controls as verified and emitted no P1 claim in
Markdown, contradicting its own index and findings.

The harness also conflates creation failure, execution failure, and task
failure; turns transport exceptions into status 500; counts retries as one
request; tests cancellation only at acknowledgement time; uses optimistic
static report prose; and does not fetch a trace artifact. Those are
`TEST_HARNESS` defects even when the underlying request also experienced an HF
failure.

## HF Infrastructure Failures

The 502 evidence for API-004, JRN-001, REP-003, REP-004, REP-007, REP-008,
REP-0010, CONC-1-1, CONC-2-1, CONC-2-2, CONC-4-2, SEC-001, and SEC-SSRF-001 is
the branded Hugging Face HTML page saying the error is on Hugging Face's side.
It contains no JourneyTest JSON, stack, journey ID, or runtime event. Those
failures belong to **Layer A (HF edge/proxy)** with high confidence; the
evidence cannot establish whether container load contributed to the edge
failure.

CONC-4-1 and CONC-4-4 are 45-second `urlopen` timeouts synthesized by the
harness as HTTP 500. They are transport/infrastructure observations, not HTTP
responses and not attributable to a precise layer from the committed data.

## Failure Classification

Layer A is the HF edge/proxy, Layer B is JourneyTest API/runtime, and Layer C is
journey semantics. “Observed body” is abbreviated; evidence files retain the
full body. Statuses for raw-body-only evidence are taken from `test-index.json`
because the old harness did not save response metadata beside those bodies.

| Test ID | HTTP status | Content type | Observed body | Classification | Layer | Confidence | Likely component | Supporting evidence path |
|---|---:|---|---|---|---|---|---|---|
| API-004 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/API-004.json` |
| JRN-001 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/JRN-001_create_res.json` |
| SEC-001 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge before security route | `responses/SEC-001_path_traversal.json` |
| SEC-SSRF-001 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge before URL validation | `security/SEC-SSRF-001.json` |
| REP-003 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/REP-003_create_res.json` |
| REP-004 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/REP-004_create_res.json` |
| REP-007 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/REP-007_create_res.json` |
| REP-008 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/REP-008_create_res.json` |
| REP-0010 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/REP-0010_create_res.json` |
| CONC-1-1 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/CONC-1-1_create_res.json` |
| CONC-2-1 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/CONC-2-1_create_res.json` |
| CONC-2-2 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/CONC-2-2_create_res.json` |
| CONC-4-1 | synthetic 500 | application/json (synthetic) | `<urlopen error timed out>` | UNKNOWN | A/B unknown | medium | network, edge, or saturated process | `responses/CONC-4-1_create_res.json` |
| CONC-4-2 | 502 | text/html | Branded HF 500 page | EXTERNAL_INFRASTRUCTURE | A | high | HF edge | `responses/CONC-4-2_create_res.json` |
| CONC-4-4 | synthetic 500 | application/json (synthetic) | `<urlopen error timed out>` | UNKNOWN | A/B unknown | medium | network, edge, or saturated process | `responses/CONC-4-4_create_res.json` |
| JRN-005 | 404 | application/json | `Unknown journey invalid-uuid-1234` | EXPECTED_NEGATIVE_TEST | B | high | JourneyService lookup | `responses/JRN-005_cancel_unknown.json` |
| SEC-SSRF-002 | 400 | application/json | private/loopback address rejected | EXPECTED_NEGATIVE_TEST | B | high | network safety validator | `security/SEC-SSRF-002.json` |
| SEC-SSRF-003 | 400 | application/json | link-local metadata address rejected | EXPECTED_NEGATIVE_TEST | B | high | network safety validator | `security/SEC-SSRF-003.json` |

No Layer C failure is established: accepted runs may end blocked or at a step
limit, but the old harness did not model task outcome separately and its listed
failures are all pre-acceptance or expected negatives.

## Unverified Claims

The baseline does not verify terminal cancellation, screenshot bytes, trace
bytes, four-way safe concurrency, ten-run repeatability, resource cleanup,
queue behavior, readiness under saturation, or recovery after a failed
journey. It also cannot identify whether an HF page resulted from an edge-only
incident, container unavailability, event-loop starvation, or process death.

## Cognition Pipeline Evidence

Accepted-run events contain non-zero-latency `reasoning.assessment` records for
provider `journeytest-openai-compatible` and model `alias-fast`. Result steps
contain `system1Backend: local_laya`, a Laya backend identifier, and executed
browser operations. System-1 and System-2 therefore both operated in at least
some live runs. Nothing in the failed creation responses reaches Layer C or
implicates cognition as the material cause.

## Initial Hypotheses

1. The generic short 502s arose before a JourneyTest response reached the
   client. They are primarily HF edge/container availability evidence.
2. The 45-second concurrent timeouts may reflect event-loop or shared browser
   pressure, but the baseline lacks server logs and admission metrics needed to
   choose among edge, proxy, and runtime saturation.
3. The Node endpoint is already asynchronous after safety validation; moving
   browser/model initialization out of POST is not the missing fix.
4. The runtime needs explicit active/queued limits because the browser driver
   shares browser/tab/recording state; deterministic serialization is safer
   than unbounded execution.
5. The Python proxy's fixed timeout and broad exception-to-502 mapping erase
   useful distinctions. Binary buffering may preserve bytes but streaming and
   hop-by-hop/header semantics require audit.
6. The largest demonstrated defect is evidence quality: independent counters,
   explicit expected-negative assertions, infrastructure classification, and a
   consistency-checked report are required before assigning maturity.
