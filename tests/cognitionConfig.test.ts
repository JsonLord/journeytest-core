import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cognitionConfigStatus, loadRuntimeCognitionConfig, saveLocalCognitionConfig } from "../src/app/cognitionConfig.js";
import { applySessionCredentialOverrides } from "../src/app/runtime.js";

describe("runtime cognition configuration", () => {
  it("applies defaults, .env, .env.local, process environment, then runtime override", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cognition-config-"));
    await writeFile(join(cwd, ".env"), "COGNITION_PROFILE=local-cloud\nCLOUD_MAX_ATTEMPTS=2\n");
    await writeFile(join(cwd, ".env.local"), "COGNITION_PROFILE=dual-laya-cloud\nCLOUD_MAX_ATTEMPTS=3\n");
    const config = loadRuntimeCognitionConfig({ cwd, env: { COGNITION_PROFILE: "local-spark-cloud", CLOUD_MAX_ATTEMPTS: "4", SPARK_OPENAI_BASE_URL: "http://spark.test/v1", LAYA_HOSTED_BASE_URL: "https://hosted.test", REASONING_PROVIDER: "openai", REASONING_MODEL: "test", CLOUD_REASONING_ENABLED: "true" }, overrides: { COGNITION_PROFILE: "dual-laya-spark-cloud", CLOUD_MAX_ATTEMPTS: 5 } });
    expect(config.profile).toBe("dual-laya-spark-cloud"); expect(config.cloud.maxAttempts).toBe(5); expect(config.source.envFiles).toHaveLength(2);
  });
  it("handles absent files and rejects malformed values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cognition-empty-")); expect(loadRuntimeCognitionConfig({ cwd, env: {} }).source.envFiles).toEqual([]);
    expect(() => loadRuntimeCognitionConfig({ cwd, env: { LAYA_HOSTED_ENABLED: "perhaps" } })).toThrow("LAYA_HOSTED_ENABLED must be true or false");
  });
  it("atomically preserves unknown local keys with restrictive permissions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cognition-save-")); await writeFile(join(cwd, ".env.local"), "UNRELATED=keep\nCOGNITION_PROFILE=local-cloud\n");
    saveLocalCognitionConfig({ COGNITION_PROFILE: "dual-laya-cloud", OPENAI_API_KEY: "secret value" }, { cwd, env: {} });
    const text = await readFile(join(cwd, ".env.local"), "utf8"); expect(text).toContain("UNRELATED=keep"); expect(text).toContain("COGNITION_PROFILE=dual-laya-cloud"); expect(text).toContain('OPENAI_API_KEY="secret value"'); expect((await stat(join(cwd, ".env.local"))).mode & 0o777).toBe(0o600);
  });
  it("never exposes secret values in status and refuses Space persistence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cognition-space-")); const config = loadRuntimeCognitionConfig({ cwd, env: { SPACE_ID: "owner/app", OPENAI_API_KEY: "super-secret" } }); const output = JSON.stringify(cognitionConfigStatus(config)); expect(output).not.toContain("super-secret"); expect(output).toContain('"openai":true'); expect(() => saveLocalCognitionConfig({ OPENAI_API_KEY: "x" }, { cwd, env: { SPACE_ID: "owner/app" } })).toThrow("environment-only");
  });
});

describe("profile-aware credentials", () => {
  it("requires only the selected cloud provider credential in diagnostics", () => {
    const openai = loadRuntimeCognitionConfig({ env: { CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", REASONING_MODEL: "model", ANTHROPIC_API_KEY: "wrong" } });
    expect(cognitionConfigStatus(openai, {}).credentialDiagnostics.required).toEqual(["OPENAI_API_KEY"]);
    const disabled = loadRuntimeCognitionConfig({ env: { CLOUD_REASONING_ENABLED: "false" } });
    expect(cognitionConfigStatus(disabled, {}).credentialDiagnostics.required).toEqual([]);
  });
  it("does not require keys for disabled or unauthenticated optional endpoints", () => {
    const config = loadRuntimeCognitionConfig({ env: { COGNITION_PROFILE: "local-spark-cloud", SPARK_OPENAI_BASE_URL: "http://spark.test/v1", SPARK_REASONING_ENABLED: "true", CLOUD_REASONING_ENABLED: "false", LAYA_HOSTED_ENABLED: "false", LAYA_VISION_ENABLED: "false" } });
    expect(config.spark.apiKey).toBeUndefined(); expect(cognitionConfigStatus(config, {}).credentialDiagnostics.required).toEqual([]);
  });
  it("allows enabled hosted and Vision endpoints without keys unless auth is explicitly required", () => {
    const optional = loadRuntimeCognitionConfig({ env: { COGNITION_PROFILE: "dual-laya-cloud", LAYA_HOSTED_BASE_URL: "https://hosted.test", LAYA_VISION_ENABLED: "true", LAYA_VISION_BASE_URL: "https://vision.test", CLOUD_REASONING_ENABLED: "false" } });
    expect(optional.hostedLaya.apiKey).toBeUndefined(); expect(optional.layaVision.apiKey).toBeUndefined();
    expect(() => loadRuntimeCognitionConfig({ env: { COGNITION_PROFILE: "dual-laya-cloud", LAYA_HOSTED_BASE_URL: "https://hosted.test", LAYA_HOSTED_AUTH_REQUIRED: "true", CLOUD_REASONING_ENABLED: "false" } })).toThrow("LAYA_HOSTED_API_KEY");
  });
  it("reports HF_TOKEN as optional when absent and configured when present", () => {
    const absent = loadRuntimeCognitionConfig({ env: { SPACE_ID: "test/journeytest" } });
    expect(cognitionConfigStatus(absent, { SPACE_ID: "test/journeytest" }).credentialDiagnostics).toMatchObject({ huggingFaceToken: "optional-unconfigured", warnings: [expect.stringContaining("public Hugging Face resources")] });
    expect(cognitionConfigStatus(absent, { SPACE_ID: "test/journeytest", HF_TOKEN: "secret" }).credentialDiagnostics).toMatchObject({ huggingFaceToken: "configured", warnings: [] });
  });
});

describe("session credential normalization", () => {
  it("preserves environment credentials for empty session values and overrides only non-empty values", () => {
    const config = loadRuntimeCognitionConfig({ env: { OPENAI_API_KEY: "environment-key" } });
    expect(applySessionCredentialOverrides(config, { OPENAI_API_KEY: "   " })).toBe(config);
    expect(applySessionCredentialOverrides(config, { OPENAI_API_KEY: " session-key " }).credentials.openai).toBe("session-key");
  });
});

describe("OpenAI-compatible Space configuration", () => {
  it("loads the endpoint and OPENAI_API_KEY from native Space environment values", () => {
    const config = loadRuntimeCognitionConfig({ env: { SPACE_ID: "test/journeytest", CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "openai", OPENAI_BASE_URL: "https://inference.example/v1", OPENAI_MODEL: "custom-model", OPENAI_API_KEY: "space-secret" } });
    expect(config.cloud.transport).toBe("openai-compatible"); expect(config.cloud.model).toBe("custom-model"); expect(config.cloud.openAiCompatibleUrl).toBe("https://inference.example/v1"); expect(config.credentials.openai).toBe("space-secret"); const status = cognitionConfigStatus(config, { SPACE_ID: "test/journeytest" }); expect(status.endpoints.openAiCompatible).toBe("inference.example"); expect(JSON.stringify(status)).not.toContain("space-secret"); expect(status.credentialDiagnostics.required).toEqual([]);
  });
  it("requires only OPENAI_API_KEY diagnostics when a compatible URL is selected", () => { const config = loadRuntimeCognitionConfig({ env: { CLOUD_REASONING_ENABLED: "true", REASONING_PROVIDER: "anthropic", OPENAI_BASE_URL: "https://inference.example/v1", OPENAI_MODEL: "custom-model", OPENAI_AUTH_REQUIRED: "true", ANTHROPIC_API_KEY: "not-used" } }); expect(cognitionConfigStatus(config, {}).credentialDiagnostics.required).toEqual(["OPENAI_API_KEY"]); });
});
