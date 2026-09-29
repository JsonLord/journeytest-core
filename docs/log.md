# Documentation Log

## 2026-09-29

- Hardened the Hugging Face deployment runbook with token-safe authentication,
  remote-inventory and clean-sync steps, bounded log monitoring, deployed-SHA
  verification, public readiness checks, and an explicit no-token evidence
  boundary.

## 2026-09-28

- Reconciled the contradictory PR 8 live campaign, classified edge, runtime,
  expected-negative, and harness evidence, and documented remaining HF-only
  uncertainty.
- Hardened service admission, FIFO slot handoff, cancellation observability,
  structured API errors, artifact metadata, proxy failure mapping, and the
  deployment harness's metrics and evidence consistency.

- Corrected Pi cloud transport selection so `OPENAI_BASE_URL` and
  `OPENAI_MODEL` construct an internal OpenAI Chat Completions model without a
  bundled-registry lookup, while preserving registry mode when the URL is absent.
- Replaced undefined Pi model dereferences with registry-backed provider/model
  validation, fail-fast cloud credential checks, safe info/doctor diagnostics,
  and an opt-in live reasoning smoke.
- Added `OPENAI_COMPATIBLE_URL` cloud reasoning support using `OPENAI_API_KEY`, including Hugging Face Space environment/secret discovery and secret-free endpoint status.

- Fixed Space UI startup by declaring every credential control before callback
  registration, added import-safe Gradio construction tests, made credential
  diagnostics profile/provider/auth aware, normalized session secrets, and made
  Python child exit fail readiness immediately.
- Added one validated dotenv-aware cognition configuration, four routing profiles, conditional hosted Laya and Vision, OpenAI-compatible Spark reasoning, structurally triggered Pi cloud escalation, bounded observable retries, safe CLI/API metadata, per-journey profile overrides, and deployment-aware Gradio settings.

- Tightened requested-trace semantics so a failed trace finalization produces a
  structured `trace_error` instead of a completed result without its artifact.
- Expanded OpenAPI request/response schemas, made doctor model smoke perform a
  real inference, and pinned Space Python dependencies with CPU-only PyTorch.

- Added optional Pi-backed System-2 supervision around the Laya System-1 action
  selector, deterministic success checks, event-driven replanning and
  termination confirmation, compact subgoals, structured verdict evidence, and
  separate Laya/reasoning cost and latency metrics.
- Corrected the isolated Laya benchmark response parsing and aggregation so
  missing answers or latency cannot be counted as valid successful warm runs.

## 2026-09-27

- Audited the JourneyTest and `laya-browser-agent` architectures and recorded
  the exact upstream revision, license, selective reuse plan, and exclusions.
- Documented the shared JourneyService, JourneyAgent boundary, JourneyResult v1,
  evidence and confidence safety rules, and the implementation plan for Gates
  A through F.
- Added the remote SystemOne backend, Laya agent, goal-aware scoping,
  coarse-to-fine diagnostics, enriched observations, deterministic value
  provider boundary, and safe SELECT execution.
- Recorded a real CPU `ichenney/laya-browser-v32b` JourneyTest browser run and a
  small same-fixture comparison with `cklxx/laya-browser` `v17s`.
- Added thin CLI, asynchronous HTTP API, Gradio/FastAPI composition, bounded
  JourneyService concurrency, managed localdecide lifecycle, URL and artifact
  security, doctor/info commands, and a Hugging Face Docker Space path.
- Hardened deployment metadata and diagnostics, added real agent-browser CDP
  trace artifacts, a stable public OpenAPI contract, official API examples,
  redirect/DNS SSRF regression coverage, and container health configuration.

## 2026-06-29

- Initialized the OKF documentation bundle under `docs/`.
- Added concept pages for product overview, feature catalog, architecture,
  authoring, running, lifecycle, and artifacts.
- Added project agent guidance requiring docs updates when behavior,
  configuration, generated artifacts, schemas, extension points, examples, or
  workflows change.
- Documented Vercel `skills` CLI installation for the bundled
  `journeytest-author` agent skill, the `node_modules` sync path, and the
  rationale for avoiding an npm `postinstall` prompt.
- Added VitePress configuration and a GitHub Pages Actions workflow for the
  hosted documentation site.
- Added release automation documentation for Conventional Commits,
  semantic-release version calculation, generated changelogs, GitHub releases,
  npm publishing, and the one-time `v0.1.1` bootstrap tag.
- Updated video documentation to describe journey-scoped `video.webm` recording
  instead of action clip stitching.
