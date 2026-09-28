import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JourneyRunner, JourneyService, ScriptedAgent } from "../src/journey/index.js";
import type { BrowserDriver } from "../src/drivers/types.js";

function fakeDriver(): BrowserDriver {
  let url = "https://example.test/";
  const calls: string[] = [];
  return {
    start: async () => undefined, close: async () => undefined,
    startTrace: async path => ({ summary: `trace ${path}` }), stopTrace: async path => { await writeFile(path, '{"traceEvents":[]}'); return { summary: "traced", details: { path } }; },
    open: async value => { url = value; return { summary: "opened" }; },
    snapshot: async () => ({ summary: "snapshot", stdout: '[ref=pricing] link "Pricing"' }),
    click: async target => { calls.push(target); url = "https://example.test/pricing"; return { summary: "clicked" }; },
    fill: async () => ({ summary: "filled" }), type: async () => ({ summary: "typed" }), press: async () => ({ summary: "pressed" }),
    scroll: async () => ({ summary: "scrolled" }), wait: async () => ({ summary: "waited" }), screenshot: async options => ({ summary: "shot", details: { path: options.path } }),
    startRecording: async () => ({ summary: "recording" }), stopRecording: async () => ({ summary: "stopped" }), scrollIntoView: async () => ({ summary: "view" }), hover: async () => ({ summary: "hover" }), dragAndDrop: async () => ({ summary: "drag" }), upload: async () => ({ summary: "upload" }), download: async options => ({ summary: "download", details: { path: options.path } }), getElementBox: async () => ({ summary: "box", details: { x: 0, y: 0, width: 1, height: 1 } }), getViewport: async () => ({ summary: "viewport", details: { width: 800, height: 600 } }),
    getUrl: async () => url, getTitle: async () => "Fixture",
  };
}

describe("JourneyService", () => {
  it("runs a deterministic journey through the shared service", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "journey-service-"));
    const service = new JourneyService(() => new JourneyRunner({ outputDir, driver: fakeDriver(), agent: new ScriptedAgent([{ operation: "CLICK", elementIndex: 0, confidence: 0.9 }, { operation: "DONE", confidence: 1 }]) }));
    const id = await service.createJourney({ url: "https://example.test", goal: "Open pricing" });
    const result = await service.runJourney(id);
    expect(result.status).toBe("completed");
    expect(result.schema_version).toBe("1");
    expect(result.steps[0].candidates[0]).toMatchObject({ ref: "pricing", name: "Pricing" });
    expect(result.final_url).toBe("https://example.test/pricing");
    expect(JSON.parse(await readFile(result.artifacts.result!, "utf8"))).toEqual(result);
  });

  it("fails closed without executing a low-confidence action", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "journey-service-"));
    const runner = new JourneyRunner({ outputDir, driver: fakeDriver(), agent: new ScriptedAgent([{ operation: "CLICK", elementIndex: 0, confidence: 0.1 }]) });
    const result = await runner.run("low", { url: "https://example.test", goal: "Open pricing", confidenceThreshold: 0.5 });
    expect(result.termination.reason).toBe("low_confidence");
    expect(result.steps[0].execution).toBeUndefined();
  });

  it("captures a real driver trace artifact when requested", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "journey-service-"));
    const result = await new JourneyRunner({ outputDir, driver: fakeDriver(), agent: new ScriptedAgent([{ operation: "DONE", confidence: 1 }]) }).run("trace", { url: "https://example.test", goal: "Finish", trace: true });
    expect(result.artifacts.trace).toBeTruthy(); expect(JSON.parse(await readFile(result.artifacts.trace!, "utf8"))).toEqual({ traceEvents: [] });
  });

  it("fails the journey when a requested trace cannot be finalized", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "journey-service-")); const driver = fakeDriver(); driver.stopTrace = async () => { throw new Error("trace stop failed"); };
    const result = await new JourneyRunner({ outputDir, driver, agent: new ScriptedAgent([{ operation: "DONE", confidence: 1 }]) }).run("trace-fail", { url: "https://example.test", goal: "Finish", trace: true });
    expect(result.status).toBe("error"); expect(result.termination).toEqual({ reason: "trace_error", message: "trace stop failed" }); expect(result.artifacts.trace).toBeUndefined();
  });
});
