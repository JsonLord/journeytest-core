import { resolve } from "node:path";
import { AgentBrowserDriver } from "../drivers/agent-browser/index.js";
import { DefaultCognitionRouter, JourneyRunner, JourneyService, LayaAgent, OpenAICompatibleReasoningController, PiReasoningController, RetryingReasoningController, SystemOneRemoteBackend } from "../journey/index.js";
import { loadRuntimeCognitionConfig, RuntimeCognitionConfigSchema, type RuntimeCognitionConfig, type RuntimeCognitionOverrides } from "./cognitionConfig.js";
import { nonnegativeEnv, positiveEnv } from "./config.js";
export interface RuntimeOptions { outputDir?: string; endpoint?: string; model?: string; revision?: string; config?: RuntimeCognitionConfig; cognitionOverrides?: RuntimeCognitionOverrides; cwd?: string }
export function createJourneyRuntime(options: RuntimeOptions = {}) {
  const config = options.config ?? loadRuntimeCognitionConfig({ cwd: options.cwd, overrides: options.cognitionOverrides });
  const endpoint = options.endpoint ?? config.localLaya.endpoint;
  const primary = createCognitionComponents(config, endpoint, options);
  const service = new JourneyService((request, sessionSecrets) => {
    const selectedProfile = request.cognitionProfile ?? config.profile;
    const needsOverride = selectedProfile !== config.profile || Boolean(request.cognitionOptions);
    const secretCredentials = { openai: sessionSecrets.OPENAI_API_KEY ?? config.credentials.openai, anthropic: sessionSecrets.ANTHROPIC_API_KEY ?? config.credentials.anthropic, gemini: sessionSecrets.GEMINI_API_KEY ?? config.credentials.gemini };
    const effective = (needsOverride || Object.keys(sessionSecrets).length > 0) ? RuntimeCognitionConfigSchema.parse({ ...config, profile: selectedProfile, credentials: secretCredentials, hostedLaya: { ...config.hostedLaya, apiKey: sessionSecrets.LAYA_HOSTED_API_KEY ?? config.hostedLaya.apiKey, enabled: selectedProfile.startsWith("dual-laya") && Boolean(config.hostedLaya.baseUrl), verifyLowConfidenceBelow: request.cognitionOptions?.hostedVerification ? 1 : config.hostedLaya.verifyLowConfidenceBelow }, layaVision: { ...config.layaVision, apiKey: sessionSecrets.LAYA_VISION_API_KEY ?? config.layaVision.apiKey, enabled: request.cognitionOptions?.vision ?? config.layaVision.enabled }, spark: { ...config.spark, apiKey: sessionSecrets.SPARK_OPENAI_API_KEY ?? config.spark.apiKey, enabled: selectedProfile.includes("spark") && Boolean(config.spark.baseUrl) }, cloud: { ...config.cloud, terminalVerification: request.cognitionOptions?.cloudTerminalVerification ?? config.cloud.terminalVerification } }) : config;
    const components = effective === config ? primary : createCognitionComponents(effective, endpoint, options);
    return new JourneyRunner({ outputDir: resolve(options.outputDir ?? process.env.JOURNEYTEST_OUTPUT ?? "runs"), driver: new AgentBrowserDriver(), ...(components.reasoningAvailable ? { cognitionRouter: components.router } : { agent: components.localAgent }), reasoningCheckpointEveryNSteps: effective.checkpointEveryNSteps || undefined, noProgressThreshold: effective.noProgressSteps });
  }, { maxConcurrent: positiveEnv("MAX_CONCURRENT_JOURNEYS", 1), maxQueued: nonnegativeEnv("MAX_QUEUED_JOURNEYS", 10) });
  return { service, backend: primary.backend, hostedBackend: primary.hostedBackend, visionBackend: primary.visionBackend, cognitionRouter: primary.router, config, endpoint };
}
function createCognitionComponents(config: RuntimeCognitionConfig, endpoint: string, options: RuntimeOptions) {
  const backend = new SystemOneRemoteBackend({ endpoint, timeoutMs: config.localLaya.timeoutMs, model: options.model ?? config.localLaya.model });
  const localAgent = new LayaAgent({ backend, model: options.model ?? config.localLaya.model, revision: options.revision ?? config.localLaya.revision, maxElements: Number(process.env.LAYA_MAX_ELEMENTS ?? 20), maxOptionsPerQuestion: Number(process.env.LAYA_MAX_OPTIONS ?? 20) });
  const hostedBackend = config.hostedLaya.enabled && config.hostedLaya.baseUrl ? new SystemOneRemoteBackend({ endpoint: systemOneUrl(config.hostedLaya.baseUrl), apiKey: config.hostedLaya.apiKey, timeoutMs: config.hostedLaya.timeoutMs, model: config.localLaya.model }) : undefined;
  const hostedAgent = hostedBackend ? new LayaAgent({ backend: hostedBackend, model: config.localLaya.model }) : undefined;
  const visionBackend = config.layaVision.enabled && config.layaVision.baseUrl ? new SystemOneRemoteBackend({ endpoint: systemOneUrl(config.layaVision.baseUrl), apiKey: config.layaVision.apiKey, timeoutMs: config.layaVision.timeoutMs, model: config.localLaya.model }) : undefined;
  const visionAgent = visionBackend ? new LayaAgent({ backend: visionBackend, model: config.localLaya.model }) : undefined;
  const sparkBase = config.spark.enabled && config.spark.baseUrl ? new OpenAICompatibleReasoningController({ baseUrl: config.spark.baseUrl, apiKey: config.spark.apiKey, model: config.spark.model, timeoutMs: config.spark.timeoutMs }) : undefined;
  const spark = sparkBase ? new RetryingReasoningController(sparkBase, { backend: "spark", maxAttempts: config.spark.maxAttempts, timeoutMs: config.spark.timeoutMs, retryBaseMs: 100 }) : undefined;
  const cloudBase = config.cloud.enabled ? new PiReasoningController({ provider: config.cloud.provider as never, modelId: config.cloud.model!, thinkingLevel: config.cloud.thinkingLevel, getApiKey: provider => apiKeyFor(provider, config) }) : undefined;
  const cloud = cloudBase ? new RetryingReasoningController(cloudBase, { backend: "cloud", maxAttempts: config.cloud.maxAttempts, timeoutMs: config.cloud.timeoutMs, retryBaseMs: config.cloud.retryBaseMs }) : undefined;
  return { backend, hostedBackend, visionBackend, localAgent, reasoningAvailable: Boolean(spark || cloud), router: new DefaultCognitionRouter({ config, localLaya: localAgent, hostedLaya: hostedAgent, vision: visionAgent, spark, cloud }) };
}
function systemOneUrl(base: string) { const url = new URL(base); if (!url.pathname || url.pathname === "/") url.pathname = "/v1/systemone"; return url.toString(); }
function apiKeyFor(provider: string, config: RuntimeCognitionConfig) { if (/anthropic/i.test(provider)) return config.credentials.anthropic; if (/gemini|google/i.test(provider)) return config.credentials.gemini; if (/openai/i.test(provider)) return config.credentials.openai; return undefined; }
