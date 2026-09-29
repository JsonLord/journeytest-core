# Behavioral Failure Forensics Report

## Overview
A step-by-step reconstruction of representative qualification journey executions was conducted on test run evidence from Hugging Face Space `Leon4gr45/nova-right-nav`.

## Reconstructed Journeys & Causal Sequences

### 1. `PY-001` (Python Documentation Discovery) - Positive Control
- **Goal:** Find Python documentation
- **Step 1:** URL `https://www.python.org/`. Laya selected `CLICK` on candidate index 24 (`docs.python.org`) with confidence `0.7515`.
- **Step 2:** URL `https://docs.python.org/3/`. Pre-action deterministic goal evaluation matched `"Python Documentation"` on page load and exited immediately with `DONE`.
- **Status:** PASSED (`status: completed`).

### 2. `TAOS-001` (TAOS Pricing Discovery)
- **Goal:** Find the pricing information
- **Causal Sequence:** Initial page `https://taoshq.com/` loaded. Browser screenshot capture command timed out (`SIGTERM`) during slow asset rendering.
- **Primary Component:** `ACTION_EXECUTION` / `BROWSER_DRIVER`.
- **Root Cause:** Screenshot timeout during heavy page render.

### 3. `HEROKU-001` (The Internet Dropdown Selection)
- **Goal:** Select Option 1 from dropdown
- **Causal Sequence:** Page `https://the-internet.herokuapp.com/dropdown` loaded. Laya selected `CLICK` on `<option value="1">Option 1</option>` (`ref: e5`). CDP error: `DOM.getBoxModel: Could not compute box model`.
- **Primary Component:** `FORM_CONTROL_HANDLING` / `ACTION_EXECUTION`.
- **Root Cause:** Option elements inside native `<select>` dropdowns do not have individual layout boxes in Chrome CDP. Choosing `CLICK` on `<option>` fails box-model calculation; selecting the parent `<select>` or using native `select` command is required.

### 4. `WIKI-001` (Wikipedia AI Search)
- **Goal:** Search for Artificial intelligence
- **Causal Sequence:** Page `https://en.wikipedia.org/wiki/Main_Page` loaded. Laya selected `TYPE_TEXT` on search input. JourneyRunner failed with `TYPE_TEXT requires a configured ValueProvider` because `options.valueProvider` was missing and `decision.value` was not populated from goal/subgoal.
- **Primary Component:** `GOAL_TO_VALUE_TRANSFORMATION` / `SYSTEM1_SELECTION`.
- **Root Cause:** Missing value resolution for `TYPE_TEXT` operations when `ValueProvider` is omitted.

### 5. `JRN-001` (Deterministic Example Domain Journey)
- **Goal:** Verify Example Domain text on page
- **Causal Sequence:** Page `https://example.com/` loaded. Page already contained `"Example Domain"`. System 1 selected `CLICK` on "Learn More" (navigating to `iana.org`), triggering `URL host is not in allowed domains`.
- **Primary Component:** `PRE_ACTION_GOAL_CHECK` / `NAVIGATION_POLICY`.
- **Root Cause:** Absence of pre-action goal evaluation on initial observation allowed redundant clicks.

### 6. `JRN-002` (Max steps termination test)
- **Goal:** Verify text Example Domain (`maxSteps: 1`)
- **Causal Sequence:** Journey executed 1 step and stopped with `max_steps` termination.
- **Primary Component:** `TEST_DEFINITION` / `TERMINATION_LOGIC`.
- **Root Cause:** Test accounting bug recorded `max_steps` termination as a behavioral failure when `expected_status` was set to `completed`.
