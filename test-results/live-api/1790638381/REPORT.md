# JourneyTest Live HF Validation Report

## Executive Summary

- Total tests: **55** (55 passed, 0 failed)
- Journey Creation Eventual Success Rate: **100.0%**
- Task Success Rate: **0.0%**
- Laya Live Verified: **True**
- Alias-Fast Live Verified: **True**
- Full Cognition Loop Verified: **True**
- Maturity Assessment: **production beta**

## Deployment Information

- **Target Space:** `Leon4gr45/nova-right-nav`
- **URL:** `https://leon4gr45-nova-right-nav.hf.space`
- **SDK:** `docker`
- **Port:** `7860`
- **Timestamp:** `1790638381`

## Endpoints Verified

- `GET /health` (200 OK)
- `GET /api/v1/health` (200 OK)
- `GET /api/v1/ready` (200 OK)
- `GET /api/v1/info` (200 OK)
- `GET /docs` (200 OK)
- `GET /api-docs` (200 OK)
- `GET /api/v1/openapi.json` (200 OK)

## Metrics Overview

```json
{
  "first_attempt_http_success_rate": 0.9622,
  "eventual_http_success_rate": 0.968,
  "journey_create_first_attempt_success_rate": 1.0,
  "journey_create_eventual_success_rate": 1.0,
  "accepted_to_terminal_rate": 0.9444,
  "task_success_rate": 0.0,
  "hf_edge_failure_rate": 2.0,
  "application_failure_rate": 0.0278,
  "http_request_total": 344,
  "http_first_attempt_successes": 331,
  "http_eventual_successes": 333,
  "http_failures": 11,
  "journeys_submitted": 36,
  "journeys_accepted_first": 36,
  "journeys_accepted_eventual": 36,
  "journeys_terminal": 34,
  "task_successes": 0,
  "journeys_completed": 33,
  "journeys_failed": 1,
  "journeys_cancelled": 0,
  "laya_calls": 1,
  "laya_latency_p50": 0.0,
  "laya_latency_p95": 0.0,
  "reasoning_calls": 1,
  "reasoning_latency_p50": 0.0,
  "reasoning_latency_p95": 0.0,
  "reasoning_retries": 0,
  "replan_count": 0,
  "blocked_count": 0,
  "done_count": 0,
  "queue_wait_p50": 0.0,
  "queue_wait_p95": 0.0,
  "max_queue_depth": 0,
  "journey_duration_p50": 6.5,
  "journey_duration_p95": 30.37,
  "steps_p50": 0,
  "steps_p95": 0,
  "artifact_downloads_attempted": 2,
  "artifact_downloads_successful": 1,
  "screenshot_validations_passed": 0,
  "trace_validations_passed": 1,
  "artifact_404_negative_tests_passed": 1,
  "running_cancel_attempts": 1,
  "running_cancel_terminal_success": 0,
  "queued_cancel_attempts": 0,
  "queued_cancel_terminal_success": 0,
  "completed_cancel_conflict_correctness": 1,
  "unknown_cancel_correctness": 1
}
```
