import { resolve } from "node:path";
import { AgentBrowserDriver } from "../drivers/agent-browser/index.js";
import { JourneyRunner, JourneyService, LayaAgent, SystemOneRemoteBackend } from "../journey/index.js";
import { nonnegativeEnv, positiveEnv } from "./config.js";
export interface RuntimeOptions { outputDir?: string; endpoint?: string; model?: string; revision?: string }
export function createJourneyRuntime(options: RuntimeOptions = {}) {
  const endpoint = options.endpoint ?? process.env.LAYA_REMOTE_URL ?? "http://127.0.0.1:8791/v1/systemone";
  const backend = new SystemOneRemoteBackend({ endpoint, apiKey: process.env.LAYA_REMOTE_API_KEY, timeoutMs: Number(process.env.LAYA_REMOTE_TIMEOUT ?? 60_000), model: options.model ?? process.env.LAYA_MODEL_REPO ?? "ichenney/laya-browser-v32b" });
  const service = new JourneyService(() => new JourneyRunner({ outputDir: resolve(options.outputDir ?? process.env.JOURNEYTEST_OUTPUT ?? "runs"), driver: new AgentBrowserDriver(), agent: new LayaAgent({ backend, model: options.model ?? process.env.LAYA_MODEL_REPO ?? "ichenney/laya-browser-v32b", revision: options.revision ?? process.env.LAYA_MODEL_REVISION, maxElements: Number(process.env.LAYA_MAX_ELEMENTS ?? 20), maxOptionsPerQuestion: Number(process.env.LAYA_MAX_OPTIONS ?? 20) }) }), { maxConcurrent: positiveEnv("MAX_CONCURRENT_JOURNEYS", 1), maxQueued: nonnegativeEnv("MAX_QUEUED_JOURNEYS", 10) });
  return { service, backend, endpoint };
}
