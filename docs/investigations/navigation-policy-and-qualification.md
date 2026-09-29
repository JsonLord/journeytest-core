# Investigation: Navigation Policy and Qualification Accounting

## 1. Current Architecture Overview

### Current Navigation & SSRF Policy
- In `src/app/security.ts`, network requests are validated via `assertSafeJourneyUrl`, `assertSafeJourneyNetwork`, and `assertSafeRedirectChain`.
- Currently, `allowedDomains` checks if the URL host matches or ends with an allowed domain name.
- Network IP validation (`isBlockedIp`) checks if resolved host IP addresses are loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), or metadata endpoints (`metadata.google.internal`).

### Conflation Issue
- Currently, same-origin/allowed-domain boundary enforcement is coupled with network SSRF/private IP blocking.
- As a result, when an open-world journey (e.g. on `example.com`) attempts to navigate to a valid public web destination like `https://www.iana.org`, the runtime treats the cross-origin transition as a security/allowed-domain violation.

### Current Task-Success Accounting & Test Budget
- `test_live_api.py` calculates `task_success_rate` as `task_successes / total_journeys_submitted`.
- Deliberate termination tests (`maxSteps=1`, `timeoutMs=2000`), cancellation tests, and negative SSRF tests are included in the denominator for task success, artificially lowering the reported behavioral success rate to ~4.7% (1/21) even when all infrastructure, cognitive loops, and security assertions pass.

## 2. Proposed Design

### 1. Explicit `navigationPolicy`
Support four distinct navigation policies:
- `same-origin`: Only the initial origin may be visited.
- `same-site`: Same registrable domain and subdomains (e.g. `python.org` -> `docs.python.org`).
- `public-http`: Any public HTTP/HTTPS destination passing SSRF/private-network IP checks.
- `explicit-allowlist`: Only origins matching `allowedDomains` list.

### 2. Pre-Action Goal Satisfaction Check
In `src/journey/runner.ts`, evaluate deterministic criteria and System-2 goal satisfaction **before** calling Laya action selection on the initial page load and after every step transition. If the goal is already satisfied on page load, exit immediately with `DONE` without performing redundant clicks.

### 3. Correct Task-Success Accounting
In `test_live_api.py` and report generation, classify tests by intent:
- `behavioral`: Open-world synthetic user task journeys.
- `termination`: Explicit bounds checks (`maxSteps`, `timeoutMs`, cancellation).
- `security`: SSRF, private IP, and path traversal rejection tests.
- `runtime`: Surface metadata and health checks.

Calculate `behavioral_task_success_rate` exclusively from `behavioral` journeys.
