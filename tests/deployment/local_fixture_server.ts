import { writeFile } from "node:fs/promises";
import { createApiServer } from "../../src/app/server.js";
import { JourneyRunner, JourneyService, type JourneyAgent, type LayaBackend } from "../../src/journey/index.js";
import type { BrowserDriver } from "../../src/drivers/types.js";

const port = Number(process.env.PORT ?? 7861);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
// The campaign exercises URL validation without depending on outbound network
// access. DNS/private-address checks still execute before this redirect probe.
globalThis.fetch = async () => new Response(null, { status: 200 });

function driver(): BrowserDriver {
  let url = "https://example.com";
  return {
    start: async () => undefined, close: async () => undefined,
    startTrace: async () => ({ summary: "trace started" }), stopTrace: async path => { await writeFile(path, '{"traceEvents":[]}'); return { summary: "trace stopped", details: { path } }; },
    open: async value => { url = value; return { summary: "opened" }; }, snapshot: async () => ({ summary: "snapshot", stdout: '[ref=more] link "More information"' }),
    click: async () => ({ summary: "clicked" }), fill: async () => ({ summary: "filled" }), type: async () => ({ summary: "typed" }), press: async () => ({ summary: "pressed" }), scroll: async () => ({ summary: "scrolled" }), wait: async () => ({ summary: "waited" }),
    screenshot: async options => { await writeFile(options.path, png); return { summary: "shot", details: { path: options.path } }; }, startRecording: async () => ({ summary: "recording" }), stopRecording: async () => ({ summary: "stopped" }), scrollIntoView: async () => ({ summary: "view" }), hover: async () => ({ summary: "hover" }), dragAndDrop: async () => ({ summary: "drag" }), upload: async () => ({ summary: "upload" }), download: async options => ({ summary: "download", details: { path: options.path } }), getElementBox: async () => ({ summary: "box", details: { x: 0, y: 0, width: 1, height: 1 } }), getViewport: async () => ({ summary: "viewport", details: { width: 800, height: 600 } }), getUrl: async () => url, getTitle: async () => "Fixture",
  };
}

function agent(goal: string): JourneyAgent {
  let step = 0;
  return { name: "local-campaign-fixture", backend: "deterministic-stub", async decide(_observation, _state, context) {
    step++;
    if (goal === "Navigate around Example Domain") {
      if (!context.signal.aborted) await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("cancelled");
    }
    if (goal === "Navigate endlessly") await new Promise(resolve => setTimeout(resolve, 2100));
    if (goal === "Verify Example Domain text on page" && step === 1) return { operation: "CLICK", elementIndex: 0, confidence: 1 };
    return { operation: "DONE", confidence: 1 };
  } };
}

const service = new JourneyService(request => new JourneyRunner({ outputDir: "test-results/local-api/runtime-runs", driver: driver(), agent: agent(request.goal) }), { maxConcurrent: 1, maxQueued: 10 });
const backend: LayaBackend = { start: async () => undefined, close: async () => undefined, health: async () => ({ ok: true, backend: "local-campaign-stub" }), infer: async () => ({ answers: {}, backend: "local-campaign-stub", latencyMs: 0 }) };
const server = createApiServer({ service, backend, model: "unchanged-not-invoked", cognitionStatus: { campaign: "local", browser: "stubbed", system1: "stubbed", system2: "unavailable" } });
server.listen(port, "127.0.0.1", () => process.stdout.write(`local fixture API listening on ${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
