import { describe, expect, it } from "vitest";
import { LayaAgent, SystemOneRemoteBackend, scopeElements, type LayaBackend, type LayaInferenceRequest } from "../src/journey/laya.js";
import type { Observation } from "../src/journey/types.js";

const observation: Observation = { url: "https://example.test", title: "Fixture", visibleText: "Choose Pricing", elements: [
  { ref: "home", role: "link", name: "Home", enabled: true, operations: ["CLICK"] },
  { ref: "pricing", role: "link", name: "Pricing", enabled: true, operations: ["CLICK"] },
  { ref: "disabled", role: "button", name: "Pricing disabled", enabled: false, operations: ["CLICK"] },
] };

function answer(question: LayaInferenceRequest["questions"][string]) {
  const keys = Object.keys(question.criteria); const chosen = keys.find(key => question.criteria[key].includes("Pricing")) ?? keys[0];
  return { choice: chosen, probabilities: Object.fromEntries(keys.map(key => [key, key === chosen ? 1 : 0])), confidence: 1 };
}

describe("SystemOneRemoteBackend", () => {
  it("sends the exact SystemOne request and parses its response", async () => {
    let sent: unknown;
    const backend = new SystemOneRemoteBackend({ endpoint: "http://local.test/v1/systemone", model: "browser", fetch: async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ answers: { operation: { choice: "DONE", probabilities: { DONE: 1 }, confidence: 1 } }, backend: "laya-torch", latency_ms: 42 })); } });
    const request = { state: { page: {} }, questions: { operation: { type: "choice" as const, instructions: "goal", criteria: { DONE: "done" } } } };
    expect(await backend.infer(request)).toMatchObject({ backend: "laya-torch", latencyMs: 42 });
    expect(sent).toEqual({ model: "browser", ...request });
  });

  it("fails on malformed success responses", async () => {
    const backend = new SystemOneRemoteBackend({ endpoint: "http://local.test/v1/systemone", fetch: async () => new Response("{}") });
    await expect(backend.infer({ state: {}, questions: {} })).rejects.toThrow();
  });
});

describe("LayaAgent", () => {
  it("scopes by goal while retaining original JourneyTest indexes", () => {
    expect(scopeElements(observation, "Open pricing", 1).map(item => item.index)).toEqual([1]);
  });

  it("validates decisions and records client-side coarse-to-fine diagnostics", async () => {
    const calls: LayaInferenceRequest[] = [];
    const backend: LayaBackend = { start: async () => undefined, close: async () => undefined, health: async () => ({ ok: true }), infer: async request => { calls.push(request); return { answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, answer(question)])), backend: "fake-real-contract", latencyMs: 5 }; } };
    const many: Observation = { ...observation, elements: Array.from({ length: 5 }, (_, index) => ({ ref: `e${index}`, role: "link", name: index === 4 ? "Pricing" : `Other ${index}`, enabled: true, operations: ["CLICK" as const] })) };
    const decision = await new LayaAgent({ backend, maxElements: 5, maxOptionsPerQuestion: 2 }).decide(many, { step: 1 }, { journeyId: "j", goal: "Open pricing", metadata: {}, signal: new AbortController().signal });
    expect(decision).toMatchObject({ operation: "CLICK", elementIndex: 4, confidence: 1 });
    expect(decision.diagnostics?.chunking).toEqual([{ question: "click_target", chunks: 3, winners: ["0", "2", "4"] }]);
    expect(calls.length).toBeGreaterThan(2);
  });
});
