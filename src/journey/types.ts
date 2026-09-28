import { z } from "zod";
import { ReasoningAssessmentSchema, ReasoningStateSchema, ReasoningVerdictSchema, SuccessCriterionSchema } from "./reasoning.js";

export const AgentOperationSchema = z.enum([
  "CLICK", "TYPE_TEXT", "SELECT", "SCROLL", "WAIT", "BACK", "NAVIGATE", "DONE", "BLOCKED",
]);

export const InteractiveElementSchema = z.object({
  ref: z.string().min(1),
  role: z.string().min(1),
  name: z.string(),
  enabled: z.boolean().default(true),
  value: z.string().optional(),
  selected: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() }).strict()).optional(),
  operations: z.array(AgentOperationSchema).min(1),
}).strict();

export const ObservationSchema = z.object({
  url: z.string(),
  title: z.string(),
  visibleText: z.string().optional(),
  elements: z.array(InteractiveElementSchema),
}).strict();

export const AgentDecisionSchema = z.object({
  operation: AgentOperationSchema,
  elementIndex: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
  value: z.string().optional(),
  reason: z.string().optional(),
  probability: z.number().min(0).max(1).optional(),
  diagnostics: z.object({
    offeredIndices: z.array(z.number().int().nonnegative()),
    scopedIndices: z.array(z.number().int().nonnegative()),
    chunking: z.array(z.object({ question: z.string(), chunks: z.number().int().positive(), winners: z.array(z.string()) }).strict()),
    backend: z.string(),
    inferenceMs: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict().superRefine((decision, ctx) => {
  if (["CLICK", "TYPE_TEXT", "SELECT"].includes(decision.operation) && decision.elementIndex === undefined) {
    ctx.addIssue({ code: "custom", message: `${decision.operation} requires elementIndex` });
  }
});

export const JourneyRequestSchema = z.object({
  url: z.string().url(),
  goal: z.string().min(1),
  context: z.record(z.string(), z.unknown()).default({}),
  maxSteps: z.number().int().positive().max(100).default(15),
  timeoutMs: z.number().int().positive().default(120_000),
  screenshots: z.boolean().default(true),
  trace: z.boolean().default(false),
  confidenceThreshold: z.number().min(0).max(1).default(0.15),
  successCriteria: z.array(SuccessCriterionSchema).max(12).default([]),
}).strict();

export const JourneyStepSchema = z.object({
  step: z.number().int().positive(),
  timestamp: z.string().datetime(),
  url: z.string(),
  candidates: z.array(z.object({ index: z.number().int().nonnegative(), ref: z.string(), role: z.string(), name: z.string(), operations: z.array(AgentOperationSchema) }).strict()),
  scopedCandidates: z.array(z.number().int().nonnegative()).optional(),
  chunking: z.array(z.object({ question: z.string(), chunks: z.number().int().positive(), winners: z.array(z.string()) }).strict()).optional(),
  decision: AgentDecisionSchema.optional(),
  validation: z.enum(["OK", "LOW_CONFIDENCE", "INVALID", "ERROR"]),
  execution: z.object({ success: z.boolean(), summary: z.string(), durationMs: z.number().int().nonnegative() }).strict().optional(),
  screenshot: z.string().optional(),
  timings: z.object({ observationMs: z.number(), inferenceMs: z.number(), actionMs: z.number(), stepMs: z.number() }).strict(),
}).strict();

export const JourneyResultSchema = z.object({
  schema_version: z.literal("1"), journey_id: z.string(),
  status: z.enum(["completed", "blocked", "error", "cancelled"]),
  goal: z.string(), start_url: z.string(), final_url: z.string(), duration_ms: z.number().int().nonnegative(), step_count: z.number().int().nonnegative(),
  termination: z.object({ reason: z.string(), message: z.string().optional() }).strict(),
  reasoning: z.object({ state: ReasoningStateSchema, verdict: ReasoningVerdictSchema.optional(), last_assessment: ReasoningAssessmentSchema.optional() }).strict().optional(),
  steps: z.array(JourneyStepSchema), events: z.array(z.object({ type: z.string(), timestamp: z.string().datetime(), data: z.unknown().optional() }).strict()),
  artifacts: z.object({ result: z.string().optional(), screenshots: z.array(z.string()), trace: z.string().optional() }).strict(),
  metrics: z.record(z.string(), z.number()), context: z.record(z.string(), z.unknown()),
  agent: z.object({ type: z.string(), backend: z.string(), model: z.string().optional(), revision: z.string().optional() }).strict(),
}).strict();

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type JourneyRequest = z.infer<typeof JourneyRequestSchema>;
export type JourneyResult = z.infer<typeof JourneyResultSchema>;
export type JourneyStep = z.infer<typeof JourneyStepSchema>;

export interface JourneyState { step: number; previousDecision?: AgentDecision; previousResult?: string }
export interface JourneyContext { journeyId: string; goal: string; subgoal?: string; metadata: Record<string, unknown>; signal: AbortSignal }
export interface JourneyAgent {
  readonly name: string;
  readonly backend: string;
  readonly model?: string;
  readonly revision?: string;
  decide(observation: Observation, state: JourneyState, context: JourneyContext): Promise<AgentDecision>;
}
export interface ValueProvider {
  valueFor(operation: "TYPE_TEXT" | "SELECT", observation: Observation, elementIndex: number, context: JourneyContext): Promise<string>;
}
