import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, type KnownProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { z } from "zod";
import { extractJsonObject } from "../utils/text.js";
import type { AgentDecision, Observation } from "./types.js";

export const SuccessCriterionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_contains"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("url_equals"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("visible_text"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("selector_present"), value: z.string().min(1) }).strict(),
]);
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;

export const ReasoningStateSchema = z.object({
  goal: z.string().min(1),
  success_criteria: z.array(SuccessCriterionSchema).max(12),
  subgoal: z.string().min(1).max(500).optional(),
}).strict();
export type ReasoningState = z.infer<typeof ReasoningStateSchema>;

export const ReasoningAssessmentSchema = z.object({
  decision: z.enum(["CONTINUE", "REPLAN", "DONE", "BLOCKED"]),
  goal_satisfied: z.boolean(), blocked: z.boolean(),
  progress: z.enum(["none", "partial", "complete"]),
  next_subgoal: z.string().min(1).max(500).optional(),
  reason_code: z.string().min(1).max(100), confidence: z.number().min(0).max(1),
  rationale: z.string().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "DONE" && !value.goal_satisfied) ctx.addIssue({ code: "custom", message: "DONE requires goal_satisfied" });
  if (value.decision === "BLOCKED" && !value.blocked) ctx.addIssue({ code: "custom", message: "BLOCKED requires blocked" });
});
export type ReasoningAssessment = z.infer<typeof ReasoningAssessmentSchema>;

export const ReasoningVerdictSchema = z.object({
  goal_satisfied: z.boolean(), blocked: z.boolean(), confidence: z.number().min(0).max(1),
  criteria: z.array(z.object({ criterion: SuccessCriterionSchema, satisfied: z.boolean().nullable(), evidence: z.string().max(500) }).strict()),
  reason_code: z.string().min(1).max(100), rationale: z.string().max(500).optional(),
}).strict();
export type ReasoningVerdict = z.infer<typeof ReasoningVerdictSchema>;

export type ReasoningTrigger = "termination_candidate" | "stuck" | "action_failure" | "low_confidence" | "periodic" | "finalize";
export interface ReasoningInitContext { goal: string; successCriteria: SuccessCriterion[]; context: Record<string, unknown>; signal: AbortSignal }
export interface ReasoningAssessmentInput { state: ReasoningState; trigger: ReasoningTrigger; observation: Observation; recentActions: Array<{ decision: AgentDecision; result?: string }>; layaDecision?: AgentDecision; progress: { urlChanged: boolean; repeatedActionCount: number; noProgressSteps: number }; signal: AbortSignal }
export interface ReasoningFinalInput extends ReasoningAssessmentInput { termination: { reason: string; message?: string }; assessment?: ReasoningAssessment }
export interface ReasoningCallMetadata { provider: string; model: string; latencyMs: number; tokens?: number; cost?: number; attempts?: number; retryEvents?: Array<{ backend: string; attempt: number; failureClass?: string; latencyMs: number; success: boolean }>; escalated?: boolean; escalationReason?: string }
export interface ReasoningResponse<T> { value: T; metadata: ReasoningCallMetadata }
export interface ReasoningController {
  readonly provider: string; readonly model: string;
  initialize(context: ReasoningInitContext): Promise<ReasoningResponse<ReasoningState>>;
  assess(input: ReasoningAssessmentInput): Promise<ReasoningResponse<ReasoningAssessment>>;
  finalize(input: ReasoningFinalInput): Promise<ReasoningResponse<ReasoningVerdict>>;
}

export function resolveReasoningModel(provider?: string, modelId?: string): Model<any> {
  if (!provider || !modelId) {
    throw new Error(`Reasoning provider and model must both be specified (got provider=${provider ?? "undefined"}, model=${modelId ?? "undefined"}).`);
  }
  const model = getModel(provider as KnownProvider, modelId as never);
  if (!model) {
    throw new Error(
      `Unsupported reasoning model configuration: provider=${provider} model=${modelId}\nThe installed pi-ai version does not expose this provider/model pair.`
    );
  }
  return model;
}

export interface PiReasoningControllerOptions { provider?: Provider; modelId?: string; model?: Model<any>; thinkingLevel?: "low" | "medium" | "high"; getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined }
export class PiReasoningController implements ReasoningController {
  readonly provider: string; readonly model: string;
  private readonly piModel: Model<any>; private readonly thinkingLevel: "low" | "medium" | "high"; private retryInstruction?: string;
  constructor(private readonly options: PiReasoningControllerOptions) {
    this.piModel = options.model ?? resolveReasoningModel(options.provider, options.modelId);
    this.provider = this.piModel.provider; this.model = this.piModel.id; this.thinkingLevel = options.thinkingLevel ?? "medium";
    console.error(`Reasoning provider: ${this.provider}`);
    console.error(`Reasoning model: ${this.model}`);
  }
  async initialize(context: ReasoningInitContext) {
    const response = await this.prompt(ReasoningStateSchema, `Interpret the goal into explicit, cheaply observable success criteria and a compact initial subgoal. Preserve caller criteria exactly and add only strongly implied criteria.\n${JSON.stringify({ goal: context.goal, caller_success_criteria: context.successCriteria, context: context.context })}`, context.signal);
    const criteria = [...context.successCriteria, ...response.value.success_criteria.filter(candidate => !context.successCriteria.some(item => item.type === candidate.type && item.value === candidate.value))];
    return { ...response, value: ReasoningStateSchema.parse({ ...response.value, goal: context.goal, success_criteria: criteria }) };
  }
  assess(input: ReasoningAssessmentInput) { return this.prompt(ReasoningAssessmentSchema, `Assess journey progress. Return a journey-level decision only; never return browser commands. DONE only with evidence the whole goal is satisfied. BLOCKED only after reasonable exploration proves no supported progress. REPLAN when a different subgoal is useful.\n${JSON.stringify(compactInput(input))}`, input.signal); }
  finalize(input: ReasoningFinalInput) { return this.prompt(ReasoningVerdictSchema, `Return the final structured journey verdict from the evidence. Do not expose chain-of-thought; rationale must be short and public.\n${JSON.stringify({ ...compactInput(input), termination: input.termination, assessment: input.assessment })}`, input.signal); }
  setRetryInstruction(instruction: string) { this.retryInstruction = instruction; }
  private async prompt<T>(schema: z.ZodType<T>, prompt: string, signal: AbortSignal): Promise<ReasoningResponse<T>> {
    const started = Date.now();
    const agent = new Agent({ initialState: { systemPrompt: "You are JourneyTest's System-2 supervisor. Respond with one JSON object matching the requested shape. You can assess evidence but cannot execute actions.", model: this.piModel, thinkingLevel: this.thinkingLevel, tools: [] }, getApiKey: this.options.getApiKey, toolExecution: "sequential" });
    const abort = () => agent.abort(); signal.addEventListener("abort", abort, { once: true });
    const retryInstruction = this.retryInstruction; this.retryInstruction = undefined;
    try { await agent.prompt(`${prompt}\nRequired JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}${retryInstruction ? `\nRetry instruction: ${retryInstruction}` : ""}`); } finally { signal.removeEventListener("abort", abort); }
    if (agent.state.errorMessage) throw new Error(`Pi reasoning provider error: ${agent.state.errorMessage}`);
    const message = [...agent.state.messages].reverse().find(item => item.role === "assistant");
    const text = message?.role === "assistant" ? message.content.filter(item => item.type === "text").map(item => item.text).join("\n") : "";
    return { value: schema.parse(extractJsonObject(text)), metadata: { provider: this.provider, model: this.model, latencyMs: Date.now() - started } };
  }
}

function compactInput(input: ReasoningAssessmentInput) {
  return { goal: input.state.goal, success_criteria: input.state.success_criteria, subgoal: input.state.subgoal, trigger: input.trigger, page: { url: input.observation.url, title: input.observation.title, visible_text: input.observation.visibleText?.slice(0, 3000), controls: input.observation.elements.slice(0, 30).map(({ role, name, enabled, value }) => ({ role, name, enabled, value })) }, recent_actions: input.recentActions.slice(-5), laya_decision: input.layaDecision, progress: input.progress };
}

export function evaluateSuccessCriteria(criteria: SuccessCriterion[], observation: Observation): { result: "yes" | "no" | "ambiguous"; criteria: Array<{ criterion: SuccessCriterion; satisfied: boolean | null; evidence: string }> } {
  if (!criteria.length) return { result: "ambiguous", criteria: [] };
  const checked = criteria.map(criterion => {
    if (criterion.type === "selector_present") { const satisfied = observation.elements.some(element => element.ref === criterion.value); return { criterion, satisfied, evidence: `observed element ref: ${JSON.stringify(criterion.value)}` }; }
    const actual = criterion.type.startsWith("url_") ? observation.url : observation.visibleText ?? "";
    const satisfied = criterion.type === "url_equals" ? actual === criterion.value : actual.toLocaleLowerCase().includes(criterion.value.toLocaleLowerCase());
    return { criterion, satisfied, evidence: `${criterion.type}: ${JSON.stringify(criterion.value)}` };
  });
  const known = checked.filter(item => item.satisfied !== null);
  return { result: known.some(item => item.satisfied === false) ? "no" : known.length === checked.length ? "yes" : "ambiguous", criteria: checked };
}
