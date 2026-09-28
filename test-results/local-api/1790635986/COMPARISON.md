# PR 8 live baseline vs local post-fix campaign

The local campaign used the real `JourneyService`, `JourneyRunner`, Node API
router, admission queue, artifact router, cancellation path, and report
generator. It used a deterministic stub browser driver and deterministic stub
agent; embedded Laya and cloud System-2 were not invoked. Therefore local
results demonstrate control-plane behavior, not Hugging Face edge stability or
live cognition reliability.

| Metric | PR #8 Live Baseline | Local Post-Fix | Interpretation |
|---|---:|---:|---|
| HTTP logical requests | 75 | 120 | `TEST_HARNESS_FIX`: the local count includes full terminal cancellation and artifact checks; retries/wire attempts are also separately recorded. |
| HTTP failures | 35 | 5 | `TEST_HARNESS_FIX`: all five local non-2xx responses are expected negative security/not-found cases, not defects. The live number mixed expected 4xx, HF HTML, and transport failures. |
| Journeys submitted | 20 | 21 | `TEST_HARNESS_FIX`: cancellation creation is now counted. |
| Journeys accepted | 8 inferred | 21 | `CODE_IMPROVEMENT` for deterministic admission plus `LOCAL_ENVIRONMENT_ADVANTAGE`; 100% local does not prove HF acceptance. |
| Journeys completed (task path) | 8 reported (counter semantics defective) | 19 | `TEST_HARNESS_FIX`: completed excludes one intentional timeout failure and one terminal cancellation. |
| Journeys failed | 12 creation failures | 1 intentional timeout | `HF_INFRASTRUCTURE` plus `TEST_HARNESS_FIX`; baseline generic HF pages are not runner failures. |
| Journey creation success rate | 40% inferred (8/20) | 100% (21/21) | `LOCAL_ENVIRONMENT_ADVANTAGE` and `CODE_IMPROVEMENT`; bounded admission is deterministic locally. |
| Journey execution terminal rate | not separable | 100% (21/21) | `TEST_HARNESS_FIX`; every accepted local journey reached completed, failed, or cancelled. |
| Task success rate | not separable; old “success” 40% | 90.48% (19/21) | `TEST_HARNESS_FIX`; intentional timeout and cancellation are not task successes. |
| Journey duration p50 / p95 | 18.90s / 51.01s | 2.00s / 4.01s | `LOCAL_ENVIRONMENT_ADVANTAGE`; local values include two-second polling and stubbed cognition/browser work. |
| Laya calls | 4 | 21 stub-agent calls | `LOCAL_ENVIRONMENT_ADVANTAGE`; local counter follows the compatibility agent path and is not live Laya evidence. |
| Reasoning calls | 5 | 0 | `LOCAL_ENVIRONMENT_ADVANTAGE`; System-2 was unavailable/not invoked locally and remains proven only by PR 8 accepted-run events. |
| Artifact validation | 0 | 2/2 downloads valid | `CODE_IMPROVEMENT` and `TEST_HARNESS_FIX`; bytes, MIME type, size, and SHA-256 were recorded. |
| Screenshot validation | 0 | 1 valid PNG, 1x1 | `CODE_IMPROVEMENT`; valid magic and dimensions were parsed without OCR. |
| Trace validation | 0 | 1 valid JSON trace | `CODE_IMPROVEMENT`; non-empty JSON and SHA-256 were recorded. |
| Cancellation validation | 0 terminal cancellations | 1 terminal cancellation | `CODE_IMPROVEMENT` and `TEST_HARNESS_FIX`; final state and events were checked, not only acknowledgement. |
| Concurrency behavior | 1/7 cases accepted; two client timeouts | 7/7 terminal across 1/2/4 submissions | `CODE_IMPROVEMENT` plus `LOCAL_ENVIRONMENT_ADVANTAGE`; one active slot and FIFO queue produced no random errors. |

## Conclusions

The local control plane is deterministic at one active journey with a bounded
FIFO queue. All 34 harness tests passed, all 21 submissions were accepted and
terminal, artifact bytes validated, cancellation became terminal, and expected
negative responses were counted as passes. No application or infrastructure
failure was observed locally.

The comparison cannot show that the Hugging Face edge will stop returning its
generic HTML error page, that the Space container remains available under the
same campaign, or that real agent-browser/Laya/alias-fast latency and memory fit
the queue policy. A new authorized HF run should use the corrected harness,
retain edge response headers/server logs, validate artifact bytes, poll
cancellation to terminal, and run the 1/2/4 matrix against the default one
active slot.
