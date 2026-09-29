# Browser Capability Matrix

| Interaction | Supported in Driver? | Works Live? | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| `CLICK` (link/button) | Yes | Yes | Verified on `PY-001` (`docs.python.org`) and `JRN-001` |
| `CLICK` (`<option>` in dropdown) | No | No | Fails in CDP: `Could not compute box model` |
| `SELECT` (`<select>` dropdown) | Yes | Yes | Native `agent-browser select <target> <value>` supported |
| `TYPE_TEXT` (input/textarea) | Yes | Yes | Requires `decision.value` or `ValueProvider` |
| `SCROLL` | Yes | Yes | Directional and selector-targeted scrolling supported |
| `WAIT` | Yes | Yes | Duration, load state, and selector waiting supported |
| `BACK` | Yes | Yes | History navigation supported via `Alt+ArrowLeft` |
| `screenshot` | Yes | Yes | PNG byte signature & dimension parsing verified |
| `trace` | Yes | Yes | Zip trace archive capture verified |
