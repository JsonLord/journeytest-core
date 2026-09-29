# Behavioral Research Backlog

## High-Value Future Improvements
1. **Laya Confidence Calibration:** Train confidence thresholding on out-of-domain actions vs. in-domain actions.
2. **Form Control Value Derivation:** Enhance System-2 subgoal parsing to automatically inject required values into `decision.value` for `TYPE_TEXT` and `SELECT` actions when `ValueProvider` is omitted.
3. **Dropdown Option Normalization:** In `observe()` element extraction, map `<option>` elements to `SELECT` operations on parent `<select>` elements rather than raw `CLICK` on option nodes.
4. **DOM + Screenshot Visual Grounding:** Combine DOM snapshot candidates with visual bounding boxes for complex canvas or shadow-DOM components.
