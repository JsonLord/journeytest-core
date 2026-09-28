import { z } from "zod";
import type { RuntimeCognitionConfig } from "../app/cognitionConfig.js";
import type { AgentDecision, JourneyContext, JourneyState, Observation } from "./types.js";
import { ReasoningAssessmentSchema, ReasoningStateSchema, ReasoningVerdictSchema, type ReasoningAssessmentInput, type ReasoningController, type ReasoningFinalInput, type ReasoningInitContext, type ReasoningResponse, type ReasoningState, type ReasoningVerdict } from "./reasoning.js";
import type { JourneyAgent } from "./types.js";

export interface LayaComparison { local: Pick<AgentDecision, "operation" | "elementIndex" | "confidence">; hosted: Pick<AgentDecision, "operation" | "elementIndex" | "confidence">; agreement: boolean }
export interface CognitionEvidence { system1Backend?: "local_laya" | "hosted_laya" | "laya_vision"; visionUsed?: boolean; layaComparison?: LayaComparison; system2Backend?: "spark" | "cloud" | "deterministic"; cloudEscalated?: boolean; escalationReason?: string; cloudAttempts?: number; retryEvents?: RetryEvent[] }
export interface ActionRoutingInput { observation: Observation; state: JourneyState; context: JourneyContext; verify?: boolean; noProgress?: boolean }
export interface ActionRoutingResult { decision: AgentDecision; evidence: CognitionEvidence }
export interface CognitionRouter {
  readonly profile: RuntimeCognitionConfig["profile"];
  initializeJourney(input: ReasoningInitContext): Promise<ReasoningResponse<ReasoningState>>;
  chooseAction(input: ActionRoutingInput): Promise<ActionRoutingResult>;
  assessJourney(input: ReasoningAssessmentInput): Promise<ReasoningResponse<z.infer<typeof ReasoningAssessmentSchema>>>;
  finalizeJourney(input: ReasoningFinalInput): Promise<ReasoningResponse<ReasoningVerdict>>;
}

export interface DefaultCognitionRouterOptions { config: RuntimeCognitionConfig; localLaya: JourneyAgent; hostedLaya?: JourneyAgent; vision?: JourneyAgent; spark?: ReasoningController; cloud?: ReasoningController }
export class DefaultCognitionRouter implements CognitionRouter {
  readonly profile; private replanWithoutProgress = 0;
  constructor(private readonly options: DefaultCognitionRouterOptions) { this.profile = options.config.profile; }
  async initializeJourney(input: ReasoningInitContext) { const primary = this.sparkEnabled() ? this.options.spark : this.options.cloud; if (!primary) return localResponse({ goal: input.goal, success_criteria: input.successCriteria }); try { return await primary.initialize(input); } catch (error) { if (primary === this.options.spark && this.options.cloud) return this.options.cloud.initialize(input); throw error; } }
  async chooseAction(input: ActionRoutingInput): Promise<ActionRoutingResult> {
    let local: AgentDecision;
    try { local = await this.options.localLaya.decide(input.observation, input.state, input.context); }
    catch (error) { if (this.options.hostedLaya && this.options.config.hostedLaya.enabled && this.options.config.hostedLaya.fallback) return { decision: await this.options.hostedLaya.decide(input.observation, input.state, input.context), evidence: { system1Backend: "hosted_laya", escalationReason: classifyFailure(error) } }; throw error; }
    const inadequate = input.observation.elements.length === 0 || !(input.observation.visibleText ?? "").trim();
    if (this.options.vision && this.options.config.layaVision.enabled && (inadequate || this.options.config.layaVision.explicit)) return { decision: await this.options.vision.decide(input.observation, input.state, input.context), evidence: { system1Backend: "laya_vision", visionUsed: true } };
    const dual = this.profile.startsWith("dual-laya"); const verify = dual && Boolean(this.options.hostedLaya) && (input.verify || (this.options.config.hostedLaya.verifyLowConfidenceBelow > 0 && local.confidence < this.options.config.hostedLaya.verifyLowConfidenceBelow) || (input.noProgress && this.options.config.hostedLaya.verifyOnNoProgress));
    if (!verify) return { decision: local, evidence: { system1Backend: "local_laya", visionUsed: false } };
    const hosted = await this.options.hostedLaya!.decide(input.observation, input.state, input.context); const agreement = hosted.operation === local.operation && hosted.elementIndex === local.elementIndex;
    return { decision: local, evidence: { system1Backend: "local_laya", visionUsed: false, layaComparison: { local: summarize(local), hosted: summarize(hosted), agreement } } };
  }
  async assessJourney(input: ReasoningAssessmentInput) {
    if (!this.sparkEnabled() || !this.options.spark) return this.requireCloud().assess(input);
    try {
      const result = await this.options.spark.assess(input); const reason = this.sparkEscalation(result.value, input);
      if (!reason) { this.replanWithoutProgress = result.value.decision === "REPLAN" && input.progress.noProgressSteps > 0 ? this.replanWithoutProgress + 1 : 0; return result; }
      return withEscalation(await this.requireCloud().assess(input), reason);
    } catch (error) { return withEscalation(await this.requireCloud().assess(input), `spark_${classifyFailure(error)}`); }
  }
  async finalizeJourney(input: ReasoningFinalInput) { if (this.options.config.cloud.terminalVerification && this.options.cloud) return this.options.cloud.finalize(input); if (this.sparkEnabled() && this.options.spark) { try { return await this.options.spark.finalize(input); } catch { /* escalate */ } } return this.requireCloud().finalize(input); }
  private sparkEnabled() { return this.profile.includes("spark") && this.options.config.spark.enabled; }
  private requireCloud() { if (!this.options.cloud || !this.options.config.cloud.enabled) throw new ReasoningRoutingError("cloud_unavailable", "Cloud reasoning is required for escalation but is not configured"); return this.options.cloud; }
  private sparkEscalation(value: z.infer<typeof ReasoningAssessmentSchema>, input: ReasoningAssessmentInput) { if (value.decision === "DONE" && input.state.success_criteria.length === 0) return "spark_done_without_deterministic_proof"; if (value.decision === "BLOCKED" && input.observation.elements.some(x => x.enabled)) return "spark_blocked_with_viable_controls"; if (value.decision === "REPLAN" && input.progress.noProgressSteps > 0 && this.replanWithoutProgress >= 1) return "spark_replan_loop"; if (this.options.config.cloud.terminalVerification && ["DONE", "BLOCKED"].includes(value.decision)) return "high_assurance_terminal_verification"; return undefined; }
}
function summarize(value: AgentDecision) { return { operation: value.operation, elementIndex: value.elementIndex, confidence: value.confidence }; }
function localResponse(value: ReasoningState): ReasoningResponse<ReasoningState> { return { value: ReasoningStateSchema.parse(value), metadata: { provider: "deterministic", model: "caller-criteria", latencyMs: 0 } }; }
function withEscalation<T>(response: ReasoningResponse<T>, reason: string): ReasoningResponse<T> { return { ...response, metadata: { ...response.metadata, escalated: true, escalationReason: reason } as typeof response.metadata }; }
export class ReasoningRoutingError extends Error { constructor(readonly category: string, message: string, readonly attempts: RetryEvent[] = []) { super(message); } }
export type FailureClass = "transport" | "structured_output" | "ambiguous" | "configuration";
export interface RetryEvent { backend: string; attempt: number; failureClass?: FailureClass; latencyMs: number; success: boolean }
export interface RetryOptions { backend: string; maxAttempts: number; timeoutMs: number; retryBaseMs: number; jitter?: () => number }
export class RetryingReasoningController implements ReasoningController {
  readonly provider; readonly model; readonly attempts: RetryEvent[] = [];
  constructor(private readonly inner: ReasoningController, private readonly options: RetryOptions) { this.provider = inner.provider; this.model = inner.model; }
  initialize(input: ReasoningInitContext) { return this.run(() => this.inner.initialize(input), input.signal); }
  assess(input: ReasoningAssessmentInput) { return this.run(() => this.inner.assess(input), input.signal); }
  finalize(input: ReasoningFinalInput) { return this.run(() => this.inner.finalize(input), input.signal); }
  private async run<T>(call: () => Promise<ReasoningResponse<T>>, signal: AbortSignal) { const failures: RetryEvent[] = []; for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) { const started = Date.now(); try { const response = await withTimeout(call(), this.options.timeoutMs, signal); const ambiguous = isAmbiguous(response.value); if (ambiguous && attempt < this.options.maxAttempts) { const event: RetryEvent = { backend: this.options.backend, attempt, failureClass: "ambiguous", latencyMs: Date.now() - started, success: false }; failures.push(event); this.attempts.push(event); setRetryInstruction(this.inner, "Verify the previous decision against the supplied observable evidence. Return only the required schema."); const jitter = Math.floor((this.options.jitter?.() ?? Math.random()) * Math.min(100, this.options.retryBaseMs)); await delay(this.options.retryBaseMs * 2 ** (attempt - 1) + jitter, signal); continue; } const event = { backend: this.options.backend, attempt, latencyMs: Date.now() - started, success: true }; this.attempts.push(event); return { ...response, metadata: { ...response.metadata, attempts: attempt, retryEvents: [...failures, event] } }; } catch (error) { const event: RetryEvent = { backend: this.options.backend, attempt, failureClass: classifyFailureClass(error), latencyMs: Date.now() - started, success: false }; failures.push(event); this.attempts.push(event); if (attempt === this.options.maxAttempts) throw new ReasoningRoutingError(event.failureClass!, `Reasoning failed after ${attempt} attempts (${event.failureClass})`, failures); setRetryInstruction(this.inner, "Repair the previous structured-output failure. Return only valid JSON matching the required schema."); const jitter = Math.floor((this.options.jitter?.() ?? Math.random()) * Math.min(100, this.options.retryBaseMs)); await delay(this.options.retryBaseMs * 2 ** (attempt - 1) + jitter, signal); } } throw new Error("unreachable"); }
}
async function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal) { const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true }); let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms); controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); })]); } finally { clearTimeout(timer!); signal.removeEventListener("abort", abort); } }
function delay(ms: number, signal: AbortSignal) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true }); }); }
function classifyFailureClass(error: unknown): FailureClass { if (error instanceof z.ZodError || /JSON|schema|enum|structured|parse/i.test(String(error))) return "structured_output"; if (/timeout|fetch|network|ECONN|429|5\d\d/i.test(String(error))) return "transport"; return "configuration"; }
function classifyFailure(error: unknown) { return classifyFailureClass(error); }

function isAmbiguous(value: unknown) { if (!value || typeof value !== "object") return false; const item = value as { reason_code?: unknown; progress?: unknown }; return typeof item.reason_code === "string" && /ambiguous|uncertain|insufficient_evidence/i.test(item.reason_code); }
function setRetryInstruction(controller: ReasoningController, instruction: string) { const repairable = controller as ReasoningController & { setRetryInstruction?: (value: string) => void }; repairable.setRetryInstruction?.(instruction); }
