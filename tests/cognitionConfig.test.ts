import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cognitionConfigStatus, loadRuntimeCognitionConfig, saveLocalCognitionConfig } from "../src/app/cognitionConfig.js";

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
