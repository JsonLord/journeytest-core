import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { waitForGradioReadiness } from "../src/cli.js";

const python = process.env.JOURNEYTEST_PYTHON ?? "python3";
let hasGradio = false;
try { execFileSync(python, ["-c", "import gradio, fastapi"], { stdio: "ignore" }); hasGradio = true; } catch {}

describe("Gradio startup", () => {
  it("declares every credential component before callback registration", () => { const source = readFileSync("python/journeytest_web.py", "utf8"); const registration = source.indexOf("run.click(run_journey"); expect(registration).toBeGreaterThan(0); for (const name of ["openai_key", "anthropic_key", "gemini_key", "hosted_key", "vision_key", "spark_key"]) expect(source.indexOf(`${name} = gr.Textbox`)).toBeLessThan(registration); });
  it.runIf(hasGradio)("constructs all controls, registers callbacks, and generates config without launching Uvicorn", () => {
    const script = `import importlib.util, json\ns=importlib.util.spec_from_file_location('journeytest_web','python/journeytest_web.py')\nm=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nd=m.build_ui(); c=d.get_config_file(); labels=[x.get('props',{}).get('label') for x in c['components']]\nrequired=['OpenAI — not configured','Anthropic — not configured','Gemini — not configured','Hosted Laya — not configured','Laya Vision — not configured','Spark auth — not configured']\nassert all(x in labels for x in required), labels\nassert len(c['dependencies']) >= 4\nprint(json.dumps({'components':len(c['components']),'dependencies':len(c['dependencies'])}))`;
    expect(execFileSync(python, ["-c", script], { cwd: process.cwd(), encoding: "utf8" })).toContain('"dependencies"');
  });
  it("fails immediately when the Gradio child exits before readiness", async () => {
    const child = new EventEmitter(); const started = Date.now();
    const waiting = waitForGradioReadiness("http://unused", 60_000, child as never, () => new Promise(() => undefined));
    child.emit("exit", 1, null);
    await expect(waiting).rejects.toThrow("Gradio process exited before readiness (exit code 1)");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
