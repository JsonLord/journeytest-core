import { describe, expect, it } from "vitest";
import { resolveReasoningModel, PiReasoningController } from "../src/journey/reasoning.js";
import { loadRuntimeCognitionConfig, cognitionConfigStatus } from "../src/app/cognitionConfig.js";
import { createJourneyRuntime } from "../src/app/runtime.js";

describe("cloud reasoning model resolution and startup validation", () => {
  it("valid provider + valid model resolves to model object", () => {
    const model = resolveReasoningModel("openai", "gpt-4o-mini");
    expect(model).toBeDefined();
    expect(model.provider).toBe("openai");
    expect(model.id).toBe("gpt-4o-mini");
  });

  it("valid provider + unknown model throws explicit configuration error", () => {
    expect(() => resolveReasoningModel("openai", "non-existent-model")).toThrow(
      "Unsupported reasoning model configuration: provider=openai model=non-existent-model"
    );
  });

  it("unknown provider throws explicit configuration error", () => {
    expect(() => resolveReasoningModel("unknown-provider", "gpt-4o-mini")).toThrow(
      "Unsupported reasoning model configuration: provider=unknown-provider model=gpt-4o-mini"
    );
  });

  it("cloud reasoning disabled -> no Pi model construction", () => {
    const config = loadRuntimeCognitionConfig({
      env: { CLOUD_REASONING_ENABLED: "false" }
    });
    expect(config.cloud.enabled).toBe(false);
    const runtime = createJourneyRuntime({ config });
    expect(runtime.cognitionRouter).toBeDefined();
  });

  it("cloud reasoning enabled + missing credential -> clear credential error at runtime construction", () => {
    const config = loadRuntimeCognitionConfig({
      env: {
        CLOUD_REASONING_ENABLED: "true",
        REASONING_PROVIDER: "openai",
        REASONING_MODEL: "gpt-4o-mini"
      }
    });
    expect(() => createJourneyRuntime({ config })).toThrow(
      "Cloud reasoning credential missing: OPENAI_API_KEY is required when CLOUD_REASONING_ENABLED=true"
    );
  });

  it("cloud reasoning enabled + valid config -> controller constructs successfully", () => {
    const config = loadRuntimeCognitionConfig({
      env: {
        CLOUD_REASONING_ENABLED: "true",
        REASONING_PROVIDER: "openai",
        REASONING_MODEL: "gpt-4o-mini",
        OPENAI_API_KEY: "sk-test-key-12345"
      }
    });
    const controller = new PiReasoningController({
      provider: config.cloud.provider as never,
      modelId: config.cloud.model!,
      getApiKey: () => config.credentials.openai
    });
    expect(controller.provider).toBe("openai");
    expect(controller.model).toBe("gpt-4o-mini");
  });

  it("status diagnostics never expose secret API keys", () => {
    const secretKey = "sk-proj-super-secret-key-999";
    const config = loadRuntimeCognitionConfig({
      env: {
        CLOUD_REASONING_ENABLED: "true",
        REASONING_PROVIDER: "openai",
        REASONING_MODEL: "gpt-4o-mini",
        OPENAI_API_KEY: secretKey,
        ANTHROPIC_API_KEY: "sk-ant-secret",
        GEMINI_API_KEY: "gemini-secret"
      }
    });
    const statusStr = JSON.stringify(cognitionConfigStatus(config));
    expect(statusStr).not.toContain("sk-proj-super-secret-key-999");
    expect(statusStr).not.toContain("sk-ant-secret");
    expect(statusStr).not.toContain("gemini-secret");
    expect(statusStr).toContain('"credential_configured":true');
  });
});
