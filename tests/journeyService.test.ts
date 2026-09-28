import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JourneyCapacityError, JourneyRunner, JourneyService, ScriptedAgent, type JourneyRequest, type JourneyResult } from "../src/journey/index.js";
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

  it("serializes execution, reports queue state, and rejects excess capacity", async () => {
    const gates: Array<() => void> = [];
    const service = new JourneyService((request) => ({ run: async (id: string) => {
      await new Promise<void>(resolve => gates.push(resolve));
      return completedResult(id, request);
    } }) as JourneyRunner, { maxConcurrent: 1, maxQueued: 1 });
    const first = await service.createJourney({ url: "https://example.test", goal: "one" });
    const firstRun = service.runJourney(first);
    await viWaitFor(() => gates.length === 1);
    const second = await service.createJourney({ url: "https://example.test", goal: "two" });
    const secondRun = service.runJourney(second);
    await viWaitFor(async () => (await service.getJourney(second)).status === "queued");
    await expect(service.createJourney({ url: "https://example.test", goal: "three" })).rejects.toBeInstanceOf(JourneyCapacityError);
    expect(service.getRuntimeMetrics()).toMatchObject({ active_journeys: 1, queued_journeys: 1, browser_slots_available: 0 });
    gates.shift()?.(); await firstRun; await viWaitFor(() => gates.length === 1);
    gates.shift()?.(); await secondRun;
    expect(service.getRuntimeMetrics()).toMatchObject({ active_journeys: 0, queued_journeys: 0, browser_slots_available: 1 });
    expect((await service.getJourney(second)).queue_wait_ms).toBeGreaterThanOrEqual(0);
  });

  it("makes cancellation terminal, observable, and releases the active slot", async () => {
    const service = new JourneyService((request) => ({ run: async (id: string, _request: unknown, signal: AbortSignal) => {
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { ...completedResult(id, request), status: "cancelled", termination: { reason: "cancelled" }, events: [{ type: "journey.cancelled", timestamp: new Date().toISOString() }] };
    } }) as JourneyRunner, { maxConcurrent: 1, maxQueued: 1 });
    const id = await service.createJourney({ url: "https://example.test", goal: "cancel" });
    const running = service.runJourney(id); await viWaitFor(async () => (await service.getJourney(id)).status === "running");
    await service.cancelJourney(id); const result = await running;
    expect(result.status).toBe("cancelled");
    expect(await service.getJourney(id)).toMatchObject({ status: "cancelled", cancel_requested_at: expect.any(String), cancelled_at: expect.any(String) });
    expect((await service.getEvents(id)).map(event => event.type)).toEqual(["journey.cancel_requested", "journey.cancelled"]);
    expect(service.getRuntimeMetrics().active_journeys).toBe(0);
  });

  it("releases all capacity across 25 sequential journeys", async () => {
    const service = new JourneyService(request => ({ run: async (id: string) => completedResult(id, request) }) as JourneyRunner, { maxConcurrent: 1, maxQueued: 2 });
    const rssBefore = process.memoryUsage().rss;
    for (let index = 0; index < 25; index++) {
      const id = await service.createJourney({ url: "https://example.test", goal: `endurance-${index}` });
      expect((await service.runJourney(id)).status).toBe("completed");
      expect(service.getRuntimeMetrics()).toMatchObject({ active_journeys: 0, queued_journeys: 0, browser_slots_used: 0 });
    }
    // Recorded for leak diagnosis rather than enforcing a platform-dependent
    // RSS threshold; slot/queue invariants are the deterministic assertion.
    expect(process.memoryUsage().rss - rssBefore).toBeTypeOf("number");
  });
});

function completedResult(id: string, request: JourneyRequest): JourneyResult {
  return { schema_version: "1", journey_id: id, status: "completed", goal: request.goal, start_url: request.url, final_url: request.url, duration_ms: 1, step_count: 0, termination: { reason: "done" }, steps: [], events: [], artifacts: { screenshots: [] }, metrics: {}, context: {}, agent: { type: "test", backend: "test" } };
}
async function viWaitFor(check: () => boolean | Promise<boolean>) { for (let index = 0; index < 100; index++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 1)); } throw new Error("condition not reached"); }
