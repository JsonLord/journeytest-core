---
type: Provenance
title: Upstream Sources
description: Audited upstream repositories, revisions, licenses, and reuse decisions.
tags: [provenance, laya, upstream]
timestamp: 2026-09-27T00:00:00Z
source_files:
  - src/journey/types.ts
  - src/journey/runner.ts
---

# Upstream Sources

## laya-browser-agent audit

- Fork: `https://github.com/JsonLord/laya-browser-agent`
- Upstream: `https://github.com/ChenneyZhuang/laya-browser-agent`
- Reference commit: `c71b7c7b3319d0b8e5a93eec150af2e6ba5cfc35`
- License: Apache-2.0

The audit covered `localdecide.backends`, `page.py`, `decider.py`, `scope.py`,
`grounding.py`, `loop.py`, `drivers.py`, `serve.py`, `mcp_server.py`, CLI
`doctor`, packaging, fixtures, and contract/live/serve/MCP tests.

No upstream source file is copied in Gate A. The following concepts are adapted:

- a numbered element table mapping only to executor-owned references;
- a closed operation choice and separate target choice;
- strict answer/choice/probability validation and confidence gating;
- goal-aware scoping to about 20 elements before coarse-to-fine chunking;
- keeping model selection separate from text value provision;
- SystemOne `/v1/systemone` compatibility as the remote boundary.

Gate B should reuse the backend package directly if its Python package boundary
proves stable. Otherwise it should adapt only the smallest bridge and preserve
Apache-2.0 notices. The upstream `BrowserDecider.run`, Playwright/CDP driver and
loop, CLI, server lifecycle, and MCP server are deliberately excluded because
they would compete with JourneyTest ownership.

## Gate B runtime observation

The audited fork's `browser-legacy` alias currently requests the `v10s`
subfolder, but the live `cklxx/laya-browser` repository exposed `v17s` during
the comparison. The alias therefore returned a missing-subfolder error. The
comparison explicitly loaded `cklxx/laya-browser` with subfolder `v17s`; no
fallback or result substitution was performed.
