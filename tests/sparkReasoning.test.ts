import { describe, expect, it, vi } from "vitest";
import { createJourneyRuntime } from "../src/app/runtime.js";
import { loadRuntimeCognitionConfig } from "../src/app/cognitionConfig.js";
import { OpenAICompatibleReasoningController } from "../src/journey/spark.js";
const input = { goal: "Open pricing", successCriteria: [], context: {}, signal: new AbortController().signal };
function responder(seen: Headers[]) { return async (_url: string | URL | Request, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"goal":"Open pricing","success_criteria":[]}' } }] }), { status: 200, headers: { "content-type": "application/json" } }); }; }
describe("Spark OpenAI-compatible authentication", () => {
  it("omits Authorization when no optional key is configured", async () => { const seen: Headers[] = []; await new OpenAICompatibleReasoningController({ baseUrl: "http://spark.test/v1/", fetch: responder(seen) as typeof fetch }).initialize(input); expect(seen[0].has("authorization")).toBe(false); });
  it("sends Authorization only for a non-empty configured key", async () => { const seen: Headers[] = []; await new OpenAICompatibleReasoningController({ baseUrl: "http://spark.test/v1/", apiKey: "key", fetch: responder(seen) as typeof fetch }).initialize(input); expect(seen[0].get("authorization")).toBe("Bearer key"); });
});

describe("generic OpenAI-compatible cloud endpoint", () => {
  it("uses the configured provider label, chat/completions path, and OPENAI-style bearer key", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), headers: new Headers(init?.headers) }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"goal":"Open pricing","success_criteria":[]}' } }] }), { status: 200 }); };
    const result = await new OpenAICompatibleReasoningController({ baseUrl: "https://inference.example/v1", apiKey: " hf-space-secret ", model: "custom-model", provider: "openai-compatible", fetch: fetcher as typeof fetch }).initialize(input);
    expect(seen[0].url).toBe("https://inference.example/v1/chat/completions"); expect(seen[0].headers.get("authorization")).toBe("Bearer hf-space-secret"); expect(result.metadata).toMatchObject({ provider: "openai-compatible", model: "custom-model" });
  });
  it("omits Authorization for a whitespace-only key", async () => { const seen: Headers[] = []; await new OpenAICompatibleReasoningController({ baseUrl: "http://compatible.test/v1/", apiKey: "   ", provider: "openai-compatible", fetch: responder(seen) as typeof fetch }).initialize(input); expect(seen[0].has("authorization")).toBe(false); });
});

describe("runtime OpenAI-compatible cloud selection", () => {
  it("routes cloud reasoning to the compatible URL with the Space OPENAI_API_KEY", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"goal":"Open pricing","success_criteria":[]}' } }] }), { status: 200 }); });
    try { const config = loadRuntimeCognitionConfig({ env: { SPACE_ID: "test/journeytest", CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "custom-model", OPENAI_COMPATIBLE_URL: "https://inference.example/v1", OPENAI_API_KEY: "space-secret" } }); const runtime = createJourneyRuntime({ config }); const initialized = await runtime.cognitionRouter.initializeJourney({ goal: "Open pricing", successCriteria: [], context: {}, signal: new AbortController().signal }); expect(initialized.metadata.provider).toBe("openai-compatible"); expect(calls[0]).toEqual({ url: "https://inference.example/v1/chat/completions", authorization: "Bearer space-secret" }); }
    finally { vi.unstubAllGlobals(); }
  });
});
