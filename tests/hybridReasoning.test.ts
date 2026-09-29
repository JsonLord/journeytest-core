import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrowserDriver } from "../src/drivers/types.js";
import { JourneyRunner, ScriptedAgent, type ReasoningAssessment, type ReasoningController, type ReasoningResponse, type ReasoningState, type ReasoningVerdict } from "../src/journey/index.js";

function driver(url = "https://example.test/", text = "Home Pricing"): BrowserDriver {
  let currentUrl = url;
  return { start: async () => undefined, close: async () => undefined, open: async value => { currentUrl = value; return { summary: "opened" }; }, snapshot: async () => ({ summary: "snapshot", stdout: text }), click: async () => ({ summary: "clicked" }), fill: async () => ({ summary: "filled" }), type: async () => ({ summary: "typed" }), press: async () => ({ summary: "pressed" }), scroll: async () => ({ summary: "scrolled" }), wait: async () => ({ summary: "waited" }), screenshot: async () => ({ summary: "shot" }), startRecording: async () => ({ summary: "recording" }), stopRecording: async () => ({ summary: "stopped" }), scrollIntoView: async () => ({ summary: "view" }), hover: async () => ({ summary: "hover" }), dragAndDrop: async () => ({ summary: "drag" }), upload: async () => ({ summary: "upload" }), download: async () => ({ summary: "download" }), getElementBox: async () => ({ summary: "box" }), getViewport: async () => ({ summary: "viewport" }), getUrl: async () => currentUrl, getTitle: async () => "Fixture" };
}
class Reasoner implements ReasoningController {
  provider = "mock"; model = "deterministic"; calls: string[] = [];
  constructor(private assessment: ReasoningAssessment) {}
  async initialize(input: Parameters<ReasoningController["initialize"]>[0]): Promise<ReasoningResponse<ReasoningState>> { this.calls.push("initialize"); return response({ goal: input.goal, success_criteria: input.successCriteria, subgoal: "Find another route" }); }
  async assess(): Promise<ReasoningResponse<ReasoningAssessment>> { this.calls.push("assess"); return response(this.assessment); }
  async finalize(): Promise<ReasoningResponse<ReasoningVerdict>> { this.calls.push("finalize"); return response({ goal_satisfied: this.assessment.goal_satisfied, blocked: this.assessment.blocked, confidence: this.assessment.confidence, criteria: [], reason_code: this.assessment.reason_code }); }
}
function response<T>(value: T): ReasoningResponse<T> { return { value, metadata: { provider: "mock", model: "deterministic", latencyMs: 2 } }; }
async function run(name: string, d: BrowserDriver, decisions: ConstructorParameters<typeof ScriptedAgent>[0], reasoner: Reasoner, extra: Record<string, unknown> = {}) { return new JourneyRunner({ outputDir: await mkdtemp(join(tmpdir(), "hybrid-")), driver: d, agent: new ScriptedAgent(decisions), reasoningController: reasoner, noProgressThreshold: 2 }).run(name, { url: "https://example.test/", goal: "Open pricing page", screenshots: false, maxSteps: 4, ...extra }); }

describe("hybrid journey reasoning", () => {
  it("confirms obvious DONE deterministically without an assessment cloud call", async () => {
    const reasoner = new Reasoner({ decision: "CONTINUE", goal_satisfied: false, blocked: false, progress: "partial", reason_code: "unused", confidence: 1 });
    const result = await run("done", driver("https://example.test/pricing", "Pricing"), [{ operation: "DONE", confidence: 1 }], reasoner, { url: "https://example.test/pricing", successCriteria: [{ type: "url_contains", value: "/pricing" }, { type: "visible_text", value: "Pricing" }] });
    expect(result.status).toBe("completed"); expect(reasoner.calls).toEqual(["initialize"]); expect(result.metrics.reasoning_calls).toBe(1); expect(result.events.at(-1)?.data).toMatchObject({ deterministic_criteria_avoided_call: true });
  });
  it("finishes from observable criteria before Laya can take an unnecessary action", async () => {
    const reasoner = new Reasoner({ decision: "CONTINUE", goal_satisfied: false, blocked: false, progress: "partial", reason_code: "unused", confidence: 1 });
    const result = await run("already-done", driver("https://example.test/pricing", "Pricing"), [], reasoner, { url: "https://example.test/pricing", successCriteria: [{ type: "url_contains", value: "/pricing" }, { type: "visible_text", value: "Pricing" }] });
    expect(result.status).toBe("completed"); expect(result.steps).toHaveLength(1); expect(result.steps[0].decision).toBeUndefined(); expect(result.reasoning?.verdict?.reason_code).toBe("deterministic_criteria_met");
  });
  it("overrides a premature Laya DONE with CONTINUE", async () => {
    const reasoner = new Reasoner({ decision: "CONTINUE", goal_satisfied: false, blocked: false, progress: "partial", next_subgoal: "Use the Pricing navigation link", reason_code: "target_not_reached", confidence: .99 });
    const result = await run("continue", driver(), [{ operation: "DONE", confidence: 1 }, { operation: "WAIT", confidence: 1 }, { operation: "DONE", confidence: 1 }], reasoner, { maxSteps: 2 });
    expect(result.steps).toHaveLength(2); expect(result.steps[1].decision?.operation).toBe("WAIT"); expect(result.reasoning?.state.subgoal).toBe("Use the Pricing navigation link");
  });
  it("lets System 2 confirm BLOCKED when Laya misses termination", async () => {
    const reasoner = new Reasoner({ decision: "BLOCKED", goal_satisfied: false, blocked: true, progress: "none", reason_code: "control_absent_after_exploration", confidence: .95 });
    const result = await run("blocked", driver("https://example.test/", "No matching controls"), [{ operation: "WAIT", confidence: 1 }, { operation: "WAIT", confidence: 1 }], reasoner);
    expect(result.status).toBe("blocked"); expect(reasoner.calls).toEqual(["initialize", "assess", "finalize"]);
  });
  it("requests REPLAN on repeated non-progress and passes the new subgoal to Laya context", async () => {
    const reasoner = new Reasoner({ decision: "REPLAN", goal_satisfied: false, blocked: false, progress: "none", next_subgoal: "Try the primary navigation instead", reason_code: "repeated_target", confidence: .9 });
    const result = await run("replan", driver(), [{ operation: "WAIT", confidence: 1 }, { operation: "WAIT", confidence: 1 }, { operation: "BLOCKED", confidence: 1 }], reasoner, { maxSteps: 2 });
    expect(reasoner.calls).toContain("assess"); expect(result.reasoning?.state.subgoal).toBe("Try the primary navigation instead"); expect(result.events.some(event => (event.data as { decision?: string }).decision === "REPLAN")).toBe(true);
  });
});
