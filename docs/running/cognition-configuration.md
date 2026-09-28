---
type: Operations Guide
title: Cognition Runtime Configuration
description: Configures JourneyTest cognition profiles, local and hosted Laya, Vision, Spark, and cloud reasoning securely.
tags: [configuration, cognition, laya, spark, cloud, security]
timestamp: 2026-09-28T00:00:00Z
source_files:
  - src/app/cognitionConfig.ts
  - src/app/runtime.ts
  - src/journey/cognition.ts
  - src/journey/spark.ts
  - python/journeytest_web.py
---

# Cognition Runtime Configuration

JourneyTest has one validated cognition configuration shared by the CLI, HTTP
service, Gradio UI, and Space runtime. Precedence from highest to lowest is:
runtime/session overrides, process environment, `.env.local`, `.env`, then
application defaults. Missing dotenv files are harmless. Malformed booleans,
numbers, profiles, URLs, and impossible enabled-backend combinations fail with
a validation error.

The profiles are `local-cloud`, `local-spark-cloud`, `dual-laya-cloud`, and
`dual-laya-spark-cloud`. Local Laya remains primary. Dual profiles permit
conditional hosted fallback or verification; they do not duplicate every
inference. Spark profiles assess locally first and structurally escalate invalid,
ambiguous terminal, blocked-with-viable-controls, and repeated-replan cases to
Pi cloud reasoning. Explicit success criteria are still evaluated before either.

## Local setup

```bash
cp .env.example .env.local
# Edit endpoint/model values and credentials.
journeytest ui
```

`.env.local` is ignored by Git. The local Settings panel only writes after the
user selects **Save local configuration**. It atomically preserves unrelated
keys and applies mode `0600`. Password fields are blank on load and status only
reports configured/not configured. `journeytest info --json` likewise reports
hosts and credential booleans, never values. A runtime-only override is:

```bash
journeytest run --url https://example.com --goal "Open pricing" \
  --cognition-profile local-cloud
```

## Hugging Face Spaces

Space detection uses `SPACE_ID`, `SPACE_HOST`, or `SYSTEM=spaces`. Put these in
**Space Variables**: `COGNITION_PROFILE`, `LAYA_MODE`,
`LAYA_HOSTED_ENABLED`, `LAYA_HOSTED_BASE_URL`, `LAYA_VISION_ENABLED`,
`LAYA_VISION_BASE_URL`, `SPARK_REASONING_ENABLED`, `SPARK_OPENAI_BASE_URL`,
`SPARK_MODEL`, `CLOUD_REASONING_ENABLED`, `REASONING_PROVIDER`,
`REASONING_MODEL`, `REASONING_THINKING_LEVEL`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, optional OpenAI compatibility metadata, timeout values, and retry values.

Put these in **Space Secrets**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `LAYA_HOSTED_API_KEY`, `LAYA_VISION_API_KEY`, and
`SPARK_OPENAI_API_KEY`. The running application never mutates Space settings and
does not offer `.env.local` persistence. Session selections are ephemeral; to
persist a credential use **Space → Settings → Repository secrets**.

`HF_TOKEN` is a recommended Space Secret for authenticated model downloads and
needs only the minimum read permission for the configured checkpoint. It is not
required for public, ungated Hub resources; when absent, JourneyTest reports a
warning rather than failing readiness. Native `SPACE_ID`, `SPACE_HOST`, and
`SYSTEM=spaces` markers detect Spaces—there are no `HF_PROFILE` or `HF_SPACE`
requirements.


When `OPENAI_BASE_URL` is set, cloud System 2 constructs a custom Pi model with the internal provider `journeytest-openai-compatible` and the `openai-completions` API. `OPENAI_MODEL` is canonical in this mode and need not exist in Pi’s registry. `OPENAI_API_KEY` is read from local configuration or a Space Secret. `OPENAI_CONTEXT_WINDOW` (default 32768) and `OPENAI_MAX_TOKENS` (default 4096) control metadata; developer-role and reasoning-effort compatibility default off.

Only the selected cloud provider credential is expected: `OPENAI_API_KEY` for
OpenAI, `ANTHROPIC_API_KEY` for Anthropic, or `GEMINI_API_KEY` for Gemini.
Endpoint keys are optional by default. Set `LAYA_HOSTED_AUTH_REQUIRED=true`,
`LAYA_VISION_AUTH_REQUIRED=true`, or `SPARK_AUTH_REQUIRED=true` only when that
enabled endpoint actually requires authentication. Empty and whitespace-only
session fields do not replace environment credentials and never produce an
empty Bearer header.

## Routing and reliability

Hosted and Vision endpoints reuse the typed SystemOne contract and append
`/v1/systemone` when configured with an origin-only base URL. Vision is used
only for an empty/inadequate text/DOM observation or explicit vision mode.
Spark uses OpenAI-compatible `chat/completions` with model
`spark-x2.5-1.7b` by default and strict existing reasoning schemas.

Cloud calls use the existing Pi provider/model and API-key resolution. OpenAI,
Anthropic, Gemini/Google, and other providers exposed by the installed Pi
version remain available. Bounded retries classify transport and structured
output failures, use exponential backoff with jitter, and emit attempt metadata.
Exhaustion raises a structured failure rather than granting Laya authority.
Keys, authorization headers, and provider error bodies are not included in
JourneyResult evidence.

## Pi provider and model resolution

The installed `@earendil-works/pi-ai` version is `0.79.4`. JourneyTest resolves
Pi models against that package's live `getProviders()` and `getModels()`
registry before starting Laya, the browser, or Gradio. The provider identifiers
for the primary cloud paths are `openai`, `anthropic`, and `google` (Gemini).
Model IDs must exactly match the selected provider's installed registry;
`journeytest info --json` reports `model_resolved`, and `journeytest doctor
--json` checks resolution without making a paid request. Use
`--smoke-reasoning` only when an explicit live request is wanted.

For example, `openai/gpt-4.1-mini` is present in the installed registry. This is
verified from the package at test/runtime rather than maintained in a duplicate
hard-coded allowlist. Unsupported pairs fail with the provider, model, failure
category, and registry-derived supported values, never with an undefined-model
property access.

Registry mode is selected when `OPENAI_BASE_URL` is absent and uses `REASONING_PROVIDER` plus `REASONING_MODEL`. OpenAI-compatible mode is selected when `OPENAI_BASE_URL` is present and uses `OPENAI_MODEL`; it bypasses registry lookup. Spark remains separate on `SPARK_OPENAI_BASE_URL`. Diagnostics expose only the endpoint host and never the full URL or API key.
