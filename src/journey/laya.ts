import { z } from "zod";
import { AgentDecisionSchema, type AgentDecision, type JourneyAgent, type JourneyContext, type JourneyState, type Observation } from "./types.js";

export interface LayaInferenceRequest { model?: string; state: unknown; questions: Record<string, LayaQuestion> }
export interface LayaInferenceResponse { answers: Record<string, unknown>; backend: string; latencyMs: number; model?: string }
export interface LayaHealth { ok: boolean; backend?: string; detail?: string }
export interface LayaBackend {
  start(): Promise<void>;
  infer(request: LayaInferenceRequest, signal?: AbortSignal): Promise<LayaInferenceResponse>;
  health(): Promise<LayaHealth>;
  close(): Promise<void>;
}

interface LayaQuestion { type: "choice"; instructions: unknown; criteria: Record<string, string> }
const ChoiceAnswerSchema = z.object({ choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number().optional(), coarse_to_fine: z.object({ chunks: z.number().int().positive(), winners: z.array(z.string()) }).optional() }).passthrough();
const WireResponseSchema = z.object({ answers: z.record(z.string(), z.unknown()), backend: z.string().optional(), latency_ms: z.number().int().nonnegative().optional(), model: z.string().optional() }).passthrough();

export interface SystemOneRemoteBackendOptions { endpoint: string; apiKey?: string; timeoutMs?: number; model?: string; fetch?: typeof globalThis.fetch }
export class SystemOneRemoteBackend implements LayaBackend {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  constructor(private readonly options: SystemOneRemoteBackendOptions) { this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 60_000; }
  async start() { const health = await this.health(); if (!health.ok) throw new Error(health.detail ?? "SystemOne backend is unavailable"); }
  async health(): Promise<LayaHealth> {
    try { const response = await this.fetcher(new URL("/healthz", this.options.endpoint)); const body = await response.json() as { backend?: string; error?: string }; return { ok: response.ok, backend: body.backend, detail: body.error }; }
    catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
  }
  async infer(request: LayaInferenceRequest, signal?: AbortSignal): Promise<LayaInferenceResponse> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error(`SystemOne request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const started = Date.now();
    try {
      const response = await this.fetcher(this.options.endpoint, { method: "POST", headers: { "content-type": "application/json", ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) }, body: JSON.stringify({ model: request.model ?? this.options.model ?? "local", state: request.state, questions: request.questions }), signal: controller.signal });
      const text = await response.text(); if (!response.ok) throw new Error(`SystemOne HTTP ${response.status}: ${text.slice(0, 400)}`);
      const payload = WireResponseSchema.parse(JSON.parse(text));
      return { answers: payload.answers, backend: payload.backend ?? "systemone-remote", latencyMs: payload.latency_ms ?? Date.now() - started, model: payload.model };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", forwardAbort); }
  }
  async close() {}
}

export interface LayaAgentOptions { backend: LayaBackend; model?: string; revision?: string; maxElements?: number; maxOptionsPerQuestion?: number }
const OPERATION_DESCRIPTIONS: Record<string, string> = { CLICK: "Click an offered element.", TYPE_TEXT: "Enter a provided value in an offered field.", SELECT: "Select a provided observed option.", SCROLL: "Scroll down.", WAIT: "Wait for a missing or disabled control.", DONE: "The entire goal is visibly satisfied.", BLOCKED: "No supported operation can make progress." };
export class LayaAgent implements JourneyAgent {
  readonly name = "laya"; readonly backend = "systemone"; readonly model?: string; readonly revision?: string;
  private readonly maxElements: number; private readonly maxOptions: number;
  constructor(private readonly options: LayaAgentOptions) { this.model = options.model; this.revision = options.revision; this.maxElements = Math.max(1, options.maxElements ?? 20); this.maxOptions = Math.max(2, options.maxOptionsPerQuestion ?? 20); }
  async decide(observation: Observation, state: JourneyState, context: JourneyContext): Promise<AgentDecision> {
    const effectiveGoal = context.subgoal ? `Goal: ${context.goal}\n\nCurrent subgoal: ${context.subgoal}` : context.goal;
    const scoped = scopeElements(observation, effectiveGoal, this.maxElements);
    const questions = buildQuestions(scoped, effectiveGoal);
    const modelState = { page: { url: observation.url, title: observation.title, text: (observation.visibleText ?? "").slice(0, 1200) }, recent_actions: state.previousDecision ? [{ action: state.previousDecision.operation, text: state.previousResult }] : [] };
    const response = await inferWithChunks(this.options.backend, { model: this.model, state: modelState, questions }, this.maxOptions, context.signal);
    const operationAnswer = validateChoice("operation", questions.operation, response.answers.operation);
    const operation = normalizeOperation(operationAnswer.choice);
    let sourceIndex: number | undefined; let confidence = operationAnswer.confidence; const chunking = collectChunking(response.answers);
    if (["CLICK", "TYPE_TEXT", "SELECT"].includes(operation)) {
      const name = `${operation.toLowerCase()}_target`; const answer = validateChoice(name, questions[name], response.answers[name]);
      sourceIndex = Number(answer.choice); confidence = Math.min(confidence, answer.confidence);
    }
    return AgentDecisionSchema.parse({ operation, elementIndex: sourceIndex, confidence, probability: confidence, diagnostics: { offeredIndices: observation.elements.map((_, index) => index), scopedIndices: scoped.map(item => item.index), chunking, backend: response.backend, inferenceMs: response.latencyMs } });
  }
}

async function inferWithChunks(backend: LayaBackend, request: LayaInferenceRequest, limit: number, signal?: AbortSignal): Promise<LayaInferenceResponse> {
  const wide = Object.entries(request.questions).filter(([name, question]) => name !== "operation" && Object.keys(question.criteria).length > Math.max(2, limit));
  if (!wide.length) return backend.infer(request, signal);
  const direct = Object.fromEntries(Object.entries(request.questions).filter(([name, question]) => name === "operation" || Object.keys(question.criteria).length <= Math.max(2, limit)));
  const answers: Record<string, unknown> = {}; let latencyMs = 0; let backendName = "systemone"; let model: string | undefined;
  if (Object.keys(direct).length) { const response = await backend.infer({ ...request, questions: direct }, signal); Object.assign(answers, response.answers); latencyMs += response.latencyMs; backendName = response.backend; model = response.model; }
  for (const [name, question] of wide) {
    const entries = Object.entries(question.criteria); const chunks = Array.from({ length: Math.ceil(entries.length / limit) }, (_, index) => entries.slice(index * limit, (index + 1) * limit)); const winners: Array<{ key: string; answer: ReturnType<typeof validateChoice> }> = [];
    for (let index = 0; index < chunks.length; index++) { const chunkQuestion = { ...question, criteria: Object.fromEntries(chunks[index]) }; const response = await backend.infer({ ...request, questions: { [name]: chunkQuestion } }, signal); latencyMs += response.latencyMs; backendName = response.backend; model = response.model; const answer = validateChoice(name, chunkQuestion, response.answers[name]); winners.push({ key: answer.choice, answer }); }
    const finalQuestion = { ...question, criteria: Object.fromEntries(winners.map(winner => [winner.key, question.criteria[winner.key]])) }; const finalResponse = await backend.infer({ ...request, questions: { [name]: finalQuestion } }, signal); latencyMs += finalResponse.latencyMs; backendName = finalResponse.backend; model = finalResponse.model; const final = validateChoice(name, finalQuestion, finalResponse.answers[name]);
    const probabilities: Record<string, number> = {};
    winners.forEach((winner, chunkIndex) => { const weight = final.probabilities[winner.key] ?? 0; for (const [key] of chunks[chunkIndex]) probabilities[key] = weight * (winner.answer.probabilities[key] ?? 0); });
    const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0) || 1; for (const key of Object.keys(probabilities)) probabilities[key] /= total;
    const choice = Object.keys(probabilities).reduce((best, key) => probabilities[key] > probabilities[best] ? key : best);
    answers[name] = { ...final, choice, probabilities, confidence: probabilities[choice], coarse_to_fine: { chunks: chunks.length, winners: winners.map(winner => winner.key) } };
  }
  return { answers, latencyMs, backend: backendName, model };
}

function normalizeOperation(operation: string): AgentDecision["operation"] { if (operation === "SCROLL_DOWN" || operation === "SCROLL_UP") return "SCROLL"; return operation as AgentDecision["operation"]; }
function buildQuestions(scoped: ScopedElement[], goal: string): Record<string, LayaQuestion> {
  const available = new Set(scoped.flatMap(item => item.element.operations)); const operations = Object.fromEntries(Object.entries(OPERATION_DESCRIPTIONS).filter(([key]) => !["CLICK", "TYPE_TEXT", "SELECT"].includes(key) || available.has(key as never)));
  const questions: Record<string, LayaQuestion> = { operation: { type: "choice", criteria: operations, instructions: { goal, rules: "Choose one safe operation from the offered set. DONE only when every requirement is visibly satisfied." } } };
  for (const operation of ["CLICK", "TYPE_TEXT", "SELECT"] as const) { const targets = scoped.filter(item => item.element.operations.includes(operation)); if (targets.length) questions[`${operation.toLowerCase()}_target`] = { type: "choice", criteria: Object.fromEntries(targets.map(item => [String(item.index), describe(item)])), instructions: { goal, operation, rules: "Choose only an offered element index." } }; }
  return questions;
}
function validateChoice(name: string, question: LayaQuestion | undefined, input: unknown) {
  if (!question) throw new Error(`Unexpected answer for unavailable question ${name}`); const answer = ChoiceAnswerSchema.parse(input); const keys = Object.keys(question.criteria); const probabilityKeys = Object.keys(answer.probabilities);
  if (!keys.includes(answer.choice) || keys.length !== probabilityKeys.length || keys.some(key => !probabilityKeys.includes(key))) throw new Error(`${name}: answer does not cover exactly the offered choices`);
  const values = Object.values(answer.probabilities); if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.02) throw new Error(`${name}: invalid probabilities`);
  const chosenProbability = answer.probabilities[answer.choice]; if (chosenProbability < Math.max(...values) - 1e-6) throw new Error(`${name}: choice is not the probability argmax`);
  const confidence = answer.confidence ?? chosenProbability; if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`${name}: invalid confidence`); return { ...answer, confidence };
}
interface ScopedElement { index: number; element: Observation["elements"][number] }
export function scopeElements(observation: Observation, goal: string, maxElements = 20): ScopedElement[] {
  const stop = new Set(["the", "and", "for", "click", "open", "page", "link", "button", "with", "into"]); const tokens = (goal.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(token => token.length > 2 && !stop.has(token));
  return observation.elements.map((element, index) => ({ element, index })).filter(item => item.element.enabled).sort((a, b) => score(b) - score(a) || a.index - b.index).slice(0, Math.max(1, maxElements));
  function score(item: ScopedElement) { const name = item.element.name.toLowerCase(); return tokens.filter(token => name.includes(token)).length * 100 + (item.element.operations.includes("TYPE_TEXT") ? 10 : 0); }
}
function describe(item: ScopedElement) { const e = item.element; return `[${item.index}] ${e.name.slice(0, 60)} (${e.role})${e.value ? ` = ${JSON.stringify(e.value.slice(0, 30))}` : ""}${e.selected !== undefined ? ` selected=${e.selected}` : ""}`; }
function collectChunking(answers: Record<string, unknown>) { return Object.entries(answers).flatMap(([question, raw]) => { const parsed = ChoiceAnswerSchema.safeParse(raw); const value = parsed.success ? parsed.data.coarse_to_fine : undefined; return value ? [{ question, chunks: value.chunks, winners: value.winners }] : []; }); }
