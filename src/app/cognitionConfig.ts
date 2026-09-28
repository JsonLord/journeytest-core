import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { isHuggingFaceSpace } from "./config.js";

export const CognitionProfileSchema = z.enum(["local-cloud", "local-spark-cloud", "dual-laya-cloud", "dual-laya-spark-cloud"]);
export type CognitionProfile = z.infer<typeof CognitionProfileSchema>;
const OptionalUrl = z.string().url().optional();
const BackendSchema = z.object({ enabled: z.boolean(), baseUrl: OptionalUrl, apiKey: z.string().optional(), timeoutMs: z.number().int().positive() }).strict();
export const RuntimeCognitionConfigSchema = z.object({
  profile: CognitionProfileSchema,
  source: z.object({ cwd: z.string(), envFiles: z.array(z.string()), deployment: z.enum(["localhost", "hugging-face"]) }).strict(),
  localLaya: z.object({ mode: z.enum(["auto", "remote", "embedded", "mock"]), endpoint: z.string().url(), model: z.string(), revision: z.string().optional(), timeoutMs: z.number().int().positive() }).strict(),
  hostedLaya: BackendSchema.extend({ fallback: z.boolean(), verifyLowConfidenceBelow: z.number().min(0).max(1), verifyOnNoProgress: z.boolean() }).strict(),
  layaVision: BackendSchema.extend({ explicit: z.boolean() }).strict(),
  spark: BackendSchema.extend({ model: z.string().min(1), maxAttempts: z.number().int().min(1).max(3) }).strict(),
  cloud: z.object({ enabled: z.boolean(), provider: z.string().min(1).optional(), model: z.string().min(1).optional(), thinkingLevel: z.enum(["low", "medium", "high"]), maxAttempts: z.number().int().min(1).max(5), timeoutMs: z.number().int().positive(), retryBaseMs: z.number().int().nonnegative(), terminalVerification: z.boolean() }).strict(),
  checkpointEveryNSteps: z.number().int().nonnegative(), noProgressSteps: z.number().int().positive(),
  credentials: z.object({ openai: z.string().optional(), anthropic: z.string().optional(), gemini: z.string().optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.hostedLaya.enabled && !value.hostedLaya.baseUrl) ctx.addIssue({ code: "custom", path: ["hostedLaya", "baseUrl"], message: "LAYA_HOSTED_BASE_URL is required when hosted Laya is enabled" });
  if (value.layaVision.enabled && !value.layaVision.baseUrl) ctx.addIssue({ code: "custom", path: ["layaVision", "baseUrl"], message: "LAYA_VISION_BASE_URL is required when Vision is enabled" });
  if (value.spark.enabled && !value.spark.baseUrl) ctx.addIssue({ code: "custom", path: ["spark", "baseUrl"], message: "SPARK_OPENAI_BASE_URL is required when Spark is enabled" });
  if (value.cloud.enabled && (!value.cloud.provider || !value.cloud.model)) ctx.addIssue({ code: "custom", path: ["cloud"], message: "REASONING_PROVIDER and REASONING_MODEL are required when cloud reasoning is enabled" });
});
export type RuntimeCognitionConfig = z.infer<typeof RuntimeCognitionConfigSchema>;
export type RuntimeCognitionOverrides = Partial<Record<string, string | number | boolean | undefined>>;

const SECRET_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "LAYA_HOSTED_API_KEY", "LAYA_VISION_API_KEY", "SPARK_OPENAI_API_KEY"] as const;
export function loadRuntimeCognitionConfig(options: { cwd?: string; env?: NodeJS.ProcessEnv; overrides?: RuntimeCognitionOverrides } = {}): RuntimeCognitionConfig {
  const cwd = resolve(options.cwd ?? process.cwd()); const processEnv = options.env ?? process.env;
  const base = readEnvFile(join(cwd, ".env")); const local = readEnvFile(join(cwd, ".env.local"));
  const merged: Record<string, string | undefined> = { ...base.values, ...local.values, ...processEnv };
  for (const [key, value] of Object.entries(options.overrides ?? {})) if (value !== undefined) merged[key] = String(value);
  const bool = (name: string, fallback: boolean) => parseBoolean(name, merged[name], fallback); const number = (name: string, fallback: number) => parseNumber(name, merged[name], fallback);
  const sparkEnabled = bool("SPARK_REASONING_ENABLED", Boolean(merged.SPARK_OPENAI_BASE_URL));
  const profile = CognitionProfileSchema.parse(merged.COGNITION_PROFILE ?? (sparkEnabled ? "local-spark-cloud" : "local-cloud"));
  return RuntimeCognitionConfigSchema.parse({
    profile, source: { cwd, envFiles: [base, local].filter(x => x.loaded).map(x => x.path), deployment: isHuggingFaceSpace(processEnv) ? "hugging-face" : "localhost" },
    localLaya: { mode: merged.LAYA_MODE ?? "auto", endpoint: merged.LAYA_REMOTE_URL ?? "http://127.0.0.1:8791/v1/systemone", model: merged.LAYA_MODEL_REPO ?? "ichenney/laya-browser-v32b", revision: empty(merged.LAYA_MODEL_REVISION), timeoutMs: number("LAYA_REMOTE_TIMEOUT", 60_000) },
    hostedLaya: { enabled: bool("LAYA_HOSTED_ENABLED", profile.startsWith("dual-laya")), baseUrl: empty(merged.LAYA_HOSTED_BASE_URL), apiKey: empty(merged.LAYA_HOSTED_API_KEY), timeoutMs: number("LAYA_HOSTED_TIMEOUT_MS", 30_000), fallback: bool("LAYA_HOSTED_FALLBACK_ENABLED", profile.startsWith("dual-laya")), verifyLowConfidenceBelow: Number(merged.LAYA_HOSTED_VERIFY_BELOW ?? 0), verifyOnNoProgress: bool("LAYA_HOSTED_VERIFY_NO_PROGRESS", false) },
    layaVision: { enabled: bool("LAYA_VISION_ENABLED", false), baseUrl: empty(merged.LAYA_VISION_BASE_URL), apiKey: empty(merged.LAYA_VISION_API_KEY), timeoutMs: number("LAYA_VISION_TIMEOUT_MS", 30_000), explicit: bool("LAYA_VISION_EXPLICIT", false) },
    spark: { enabled: sparkEnabled && profile.includes("spark"), baseUrl: empty(merged.SPARK_OPENAI_BASE_URL), apiKey: empty(merged.SPARK_OPENAI_API_KEY), timeoutMs: number("SPARK_TIMEOUT_MS", 30_000), model: merged.SPARK_MODEL ?? "spark-x2.5-1.7b", maxAttempts: number("SPARK_MAX_ATTEMPTS", 2) },
    cloud: { enabled: bool("CLOUD_REASONING_ENABLED", Boolean(merged.REASONING_PROVIDER && merged.REASONING_MODEL)), provider: empty(merged.REASONING_PROVIDER), model: empty(merged.REASONING_MODEL), thinkingLevel: merged.REASONING_THINKING_LEVEL ?? "low", maxAttempts: number("CLOUD_MAX_ATTEMPTS", 3), timeoutMs: number("CLOUD_TIMEOUT_MS", 60_000), retryBaseMs: number("CLOUD_RETRY_BASE_MS", 250), terminalVerification: bool("CLOUD_TERMINAL_VERIFICATION", profile === "dual-laya-spark-cloud") },
    checkpointEveryNSteps: number("REASONING_CHECKPOINT_EVERY_N_STEPS", 0), noProgressSteps: number("REASONING_NO_PROGRESS_STEPS", 3),
    credentials: { openai: empty(merged.OPENAI_API_KEY), anthropic: empty(merged.ANTHROPIC_API_KEY), gemini: empty(merged.GEMINI_API_KEY) },
  });
}
function empty(value: string | undefined) { return value?.trim() ? value : undefined; }
function parseBoolean(name: string, value: string | undefined, fallback: boolean) { if (value === undefined || value === "") return fallback; if (/^(1|true|yes|on)$/i.test(value)) return true; if (/^(0|false|no|off)$/i.test(value)) return false; throw new Error(`${name} must be true or false`); }
function parseNumber(name: string, value: string | undefined, fallback: number) { if (value === undefined || value === "") return fallback; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`); return parsed; }
function readEnvFile(path: string) { if (!existsSync(path)) return { path, loaded: false, values: {} as Record<string, string> }; const values: Record<string, string> = {}; for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith("#")) continue; const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!match) throw new Error(`Invalid dotenv line in ${path}: ${raw}`); let value = match[2].trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).replace(/\\n/g, "\n"); values[match[1]] = value; } return { path, loaded: true, values }; }

export function cognitionConfigStatus(config: RuntimeCognitionConfig) { const host = (url?: string) => url ? new URL(url).host : undefined; return { source: config.source, cognitionProfile: config.profile, enabledBackends: { localLaya: true, hostedLaya: config.hostedLaya.enabled, layaVision: config.layaVision.enabled, spark: config.spark.enabled, cloud: config.cloud.enabled }, endpoints: { localLaya: host(config.localLaya.endpoint), hostedLaya: host(config.hostedLaya.baseUrl), layaVision: host(config.layaVision.baseUrl), spark: host(config.spark.baseUrl) }, credentials: { openai: Boolean(config.credentials.openai), anthropic: Boolean(config.credentials.anthropic), gemini: Boolean(config.credentials.gemini), hostedLaya: Boolean(config.hostedLaya.apiKey), layaVision: Boolean(config.layaVision.apiKey), spark: config.spark.apiKey ? "configured" : "not-required-or-unconfigured" } }; }
export function saveLocalCognitionConfig(updates: Record<string, string>, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) { if (isHuggingFaceSpace(options.env ?? process.env)) throw new Error("Hugging Face Space configuration is environment-only; use Space Settings → Repository secrets"); const cwd = resolve(options.cwd ?? process.cwd()); const path = join(cwd, ".env.local"); const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : []; const pending = new Map(Object.entries(updates)); const output = existing.map(line => { const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]; if (!key || !pending.has(key)) return line; const value = pending.get(key)!; pending.delete(key); return `${key}=${dotenvQuote(value)}`; }); for (const [key, value] of pending) output.push(`${key}=${dotenvQuote(value)}`); const temp = join(dirname(path), `.env.local.${process.pid}.tmp`); writeFileSync(temp, `${output.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, path); chmodSync(path, 0o600); return path; }
function dotenvQuote(value: string) { return /^[A-Za-z0-9_./:@-]*$/.test(value) ? value : JSON.stringify(value); }
export function secretEnvironmentNames() { return [...SECRET_NAMES]; }
