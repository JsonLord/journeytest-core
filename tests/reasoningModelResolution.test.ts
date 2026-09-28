import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createOpenAICompatibleModel, inspectReasoningModel, resolveReasoningModel } from "../src/directors/pi/modelResolution.js";
import { cognitionConfigStatus, loadRuntimeCognitionConfig } from "../src/app/cognitionConfig.js";
import { createJourneyRuntime } from "../src/app/runtime.js";
import { PiReasoningController } from "../src/journey/reasoning.js";

function config(env: NodeJS.ProcessEnv) { return loadRuntimeCognitionConfig({ env }); }
describe("Pi reasoning model resolution", () => {
  it("resolves an installed OpenAI provider/model pair", () => { const model = resolveReasoningModel("openai", "gpt-4.1-mini"); expect(model).toMatchObject({ provider: "openai", id: "gpt-4.1-mini" }); });
  it("rejects a known provider with an unknown model explicitly", () => { expect(() => resolveReasoningModel("openai", "not-a-pi-model")).toThrow(/Unsupported reasoning model configuration:[\s\S]*provider=openai[\s\S]*model=not-a-pi-model/); });
  it("rejects an unknown provider explicitly", () => { expect(() => resolveReasoningModel("not-a-provider", "model")).toThrow(/Supported providers:/); });
  it("does not resolve or construct Pi when cloud reasoning is disabled", () => { const value = config({ CLOUD_REASONING_ENABLED: "false", REASONING_PROVIDER: "invalid", REASONING_MODEL: "invalid" }); expect(inspectReasoningModel("invalid", "invalid").modelResolved).toBe(false); expect(() => createJourneyRuntime({ config: value })).not.toThrow(); });
  it("fails startup clearly when the selected provider credential is missing", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "gpt-4.1-mini" }); expect(() => createJourneyRuntime({ config: value })).toThrow("Missing reasoning credential: OPENAI_API_KEY"); });
  it("constructs the cloud controller for a valid configuration", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "test-secret" }); expect(() => createJourneyRuntime({ config: value })).not.toThrow(); expect(cognitionConfigStatus(value, {}).reasoning).toMatchObject({ enabled: true, provider: "openai", model: "gpt-4.1-mini", model_resolved: true, credential_configured: true }); expect(JSON.stringify(cognitionConfigStatus(value, {}))).not.toContain("test-secret"); });
  it("selects custom OpenAI-compatible mode without a registry lookup", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", OPENAI_BASE_URL: "https://compatible.example/v1", OPENAI_MODEL: "not-in-pi-registry" }); expect(value.cloud).toMatchObject({ transport: "openai-compatible", model: "not-in-pi-registry", openAiCompatibleUrl: "https://compatible.example/v1" }); expect(() => createJourneyRuntime({ config: value })).not.toThrow(); });
  it("constructs conservative custom Pi model metadata", () => { expect(createOpenAICompatibleModel({ baseUrl: "https://compatible.example/v1", modelId: "arbitrary-model" })).toMatchObject({ provider: "journeytest-openai-compatible", api: "openai-completions", id: "arbitrary-model", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 4096, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }); });
  it("sends the configured key through Pi and validates a structured response", async () => {
    let authorization: string | undefined;
    const server = createServer((request, response) => { authorization = request.headers.authorization; response.writeHead(200, { "content-type": "text/event-stream" }); response.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "arbitrary-model", choices: [{ index: 0, delta: { role: "assistant", content: '{"goal":"Open pricing","success_criteria":[]}' }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try { const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test address"); const controller = new PiReasoningController({ model: createOpenAICompatibleModel({ baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId: "arbitrary-model" }), getApiKey: () => "endpoint-token" }); const result = await controller.initialize({ goal: "Open pricing", successCriteria: [], context: {}, signal: new AbortController().signal }); expect(result.value).toEqual({ goal: "Open pricing", success_criteria: [] }); expect(authorization).toBe("Bearer endpoint-token"); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it("requires OPENAI_MODEL when OPENAI_BASE_URL selects compatible mode", () => { expect(() => config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", OPENAI_BASE_URL: "https://compatible.example/v1" })).toThrow("OPENAI_BASE_URL is configured but OPENAI_MODEL is missing"); });
});
