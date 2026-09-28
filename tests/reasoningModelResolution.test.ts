import { describe, expect, it } from "vitest";
import { inspectReasoningModel, resolveReasoningModel } from "../src/directors/pi/modelResolution.js";
import { cognitionConfigStatus, loadRuntimeCognitionConfig } from "../src/app/cognitionConfig.js";
import { createJourneyRuntime } from "../src/app/runtime.js";

function config(env: NodeJS.ProcessEnv) { return loadRuntimeCognitionConfig({ env }); }
describe("Pi reasoning model resolution", () => {
  it("resolves an installed OpenAI provider/model pair", () => { const model = resolveReasoningModel("openai", "gpt-4.1-mini"); expect(model).toMatchObject({ provider: "openai", id: "gpt-4.1-mini" }); });
  it("rejects a known provider with an unknown model explicitly", () => { expect(() => resolveReasoningModel("openai", "not-a-pi-model")).toThrow(/Unsupported reasoning model configuration:[\s\S]*provider=openai[\s\S]*model=not-a-pi-model/); });
  it("rejects an unknown provider explicitly", () => { expect(() => resolveReasoningModel("not-a-provider", "model")).toThrow(/Supported providers:/); });
  it("does not resolve or construct Pi when cloud reasoning is disabled", () => { const value = config({ CLOUD_REASONING_ENABLED: "false", REASONING_PROVIDER: "invalid", REASONING_MODEL: "invalid" }); expect(inspectReasoningModel("invalid", "invalid").modelResolved).toBe(false); expect(() => createJourneyRuntime({ config: value })).not.toThrow(); });
  it("fails startup clearly when the selected provider credential is missing", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "gpt-4.1-mini" }); expect(() => createJourneyRuntime({ config: value })).toThrow("Missing reasoning credential: OPENAI_API_KEY"); });
  it("constructs the cloud controller for a valid configuration", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "test-secret" }); expect(() => createJourneyRuntime({ config: value })).not.toThrow(); expect(cognitionConfigStatus(value, {}).reasoning).toMatchObject({ enabled: true, provider: "openai", model: "gpt-4.1-mini", model_resolved: true, credential_configured: true }); expect(JSON.stringify(cognitionConfigStatus(value, {}))).not.toContain("test-secret"); });
  it("ignores OPENAI_MODEL and OPENAI_BASE_URL for the Pi cloud path", () => { const value = config({ CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "test", OPENAI_MODEL: "wrong", OPENAI_BASE_URL: "https://wrong.example/v1" }); expect(value.cloud.model).toBe("gpt-4.1-mini"); expect(value.cloud.openAiCompatibleUrl).toBeUndefined(); });
});
