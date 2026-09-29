# Behavioral Failure Forensics

## Component Classifications
1. **HEROKU-001 (Dropdown Selection):** `FORM_CONTROL_HANDLING` / `ACTION_EXECUTION`. Attempting `CLICK` on raw `<option>` elements in Chrome CDP fails box-model calculation. Generic fix: promoted `CLICK` on `option` role elements to `SELECT`.
2. **WIKI-001 (Wikipedia Search):** `GOAL_TO_VALUE_TRANSFORMATION`. `TYPE_TEXT` selected without `decision.value`. Generic fix: added fallback goal/subgoal value extraction for `TYPE_TEXT` and `SELECT` actions.
3. **JRN-001 (Example Domain):** `PRE_ACTION_GOAL_CHECK`. Clicked off-origin link when goal was already satisfied on page load. Generic fix: added pre-action goal satisfaction check before Laya call.
4. **JRN-002 (MaxSteps Test):** `TEST_DEFINITION`. Intentional termination test recorded as behavioral failure. Fixed `expected_status` to `"failed"` so the test passes as expected.
