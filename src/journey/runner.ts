import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserDriver } from "../drivers/types.js";
import { evaluateSuccessCriteria, type ReasoningAssessment, type ReasoningController, type ReasoningState, type ReasoningTrigger, type ReasoningVerdict } from "./reasoning.js";
import { AgentDecisionSchema, JourneyRequestSchema, JourneyResultSchema, type AgentDecision, type JourneyAgent, type JourneyContext, type JourneyResult, type JourneyStep, type Observation, type ValueProvider } from "./types.js";

export interface JourneyRunnerOptions { driver: BrowserDriver; agent: JourneyAgent; outputDir: string; valueProvider?: ValueProvider; reasoningController?: ReasoningController; reasoningCheckpointEveryNSteps?: number; noProgressThreshold?: number }

export class JourneyRunner {
  constructor(private readonly options: JourneyRunnerOptions) {}
  async run(id: string, rawRequest: unknown, signal = new AbortController().signal): Promise<JourneyResult> {
    const request = JourneyRequestSchema.parse(rawRequest); const started = Date.now(); const runDir = join(this.options.outputDir, id); const screenshotDir = join(runDir, "screenshots"); const tracePath = join(runDir, "trace.json");
    await mkdir(screenshotDir, { recursive: true });
    const steps: JourneyStep[] = []; const events: JourneyResult["events"] = []; const recentActions: Array<{ decision: AgentDecision; result?: string }> = [];
    let termination: JourneyResult["termination"] = { reason: "max_steps", message: "Maximum steps reached" }; let status: JourneyResult["status"] = "error"; let finalUrl = request.url;
    let previousDecision: AgentDecision | undefined; let previousResult: string | undefined; let previousObservation: Observation | undefined; let noProgressSteps = 0; let repeatedActionCount = 0;
    let traceStarted = false; let traceWritten = false; let traceError: Error | undefined; let reasoningState: ReasoningState | undefined; let lastAssessment: ReasoningAssessment | undefined; let verdict: ReasoningVerdict | undefined;
    const metrics = { journey_ms: 0, laya_calls: 0, laya_total_ms: 0, reasoning_calls: 0, reasoning_total_ms: 0, reasoning_tokens: 0, reasoning_cost: 0 };
    const abort = () => { if (signal.aborted) throw new Error("Journey cancelled"); if (Date.now() - started > request.timeoutMs) throw new Error("Journey timeout"); };
    const recordReasoning = (trigger: string, response: { value: ReasoningAssessment | ReasoningState | ReasoningVerdict; metadata: { provider: string; model: string; latencyMs: number; tokens?: number; cost?: number } }, deterministic = false) => {
      metrics.reasoning_calls += deterministic ? 0 : 1; metrics.reasoning_total_ms += deterministic ? 0 : response.metadata.latencyMs; metrics.reasoning_tokens += response.metadata.tokens ?? 0; metrics.reasoning_cost += response.metadata.cost ?? 0;
      const value = response.value as Partial<ReasoningAssessment>;
      events.push({ type: "reasoning.assessment", timestamp: new Date().toISOString(), data: { trigger, provider: response.metadata.provider, model: response.metadata.model, latency_ms: response.metadata.latencyMs, decision: value.decision, confidence: value.confidence, reason_code: value.reason_code, next_subgoal: value.next_subgoal, deterministic_criteria_avoided_call: deterministic } });
    };
    try {
      await this.options.driver.start({ runId: id, runDir, baseUrl: request.url, allowedOrigins: [new URL(request.url).origin], sessionName: id });
      if (request.trace) { if (!this.options.driver.startTrace || !this.options.driver.stopTrace) throw new Error("Browser driver does not support trace capture"); await this.options.driver.startTrace(tracePath); traceStarted = true; }
      await this.options.driver.open(request.url);
      if (this.options.reasoningController) { const response = await this.options.reasoningController.initialize({ goal: request.goal, successCriteria: request.successCriteria, context: request.context, signal }); reasoningState = response.value; recordReasoning("initialization", response); }
      else reasoningState = { goal: request.goal, success_criteria: request.successCriteria };
      for (let n = 1; n <= request.maxSteps; n++) {
        abort(); const stepStarted = Date.now(); const observationStarted = Date.now(); const observation = await observe(this.options.driver); const observationMs = Date.now() - observationStarted;
        if (previousObservation && previousObservation.url === observation.url && previousObservation.visibleText === observation.visibleText) noProgressSteps++; else noProgressSteps = 0;
        const candidates = observation.elements.map((element, index) => ({ index, ref: element.ref, role: element.role, name: element.name, operations: element.operations }));
        const inferenceStarted = Date.now(); let decision: AgentDecision | undefined; let validation: JourneyStep["validation"] = "OK";
        const agentContext: JourneyContext = { journeyId: id, goal: request.goal, subgoal: reasoningState.subgoal, metadata: request.context, signal };
        try { decision = AgentDecisionSchema.parse(await this.options.agent.decide(observation, { step: n, previousDecision, previousResult }, agentContext)); metrics.laya_calls++; }
        catch (error) { termination = { reason: "invalid_decision", message: error instanceof Error ? error.message : String(error) }; validation = "INVALID"; steps.push(makeStep()); break; }
        const inferenceMs = decision.diagnostics?.inferenceMs ?? Date.now() - inferenceStarted; metrics.laya_total_ms += inferenceMs;
        repeatedActionCount = sameDecision(previousDecision, decision) ? repeatedActionCount + 1 : 1;
        if (decision.elementIndex !== undefined && !candidates[decision.elementIndex]) { validation = "INVALID"; termination = { reason: "invalid_element_index", message: `Element ${decision.elementIndex} was not offered` }; steps.push(makeStep()); break; }

        const candidate = decision.operation === "DONE" || decision.operation === "BLOCKED";
        const periodic = Boolean(this.options.reasoningCheckpointEveryNSteps && n % this.options.reasoningCheckpointEveryNSteps === 0);
        const stuck = repeatedActionCount >= (this.options.noProgressThreshold ?? 3) || noProgressSteps >= (this.options.noProgressThreshold ?? 3);
        const lowConfidence = decision.confidence < request.confidenceThreshold;
        if (candidate || periodic || stuck || lowConfidence) {
          const deterministic = candidate ? evaluateSuccessCriteria(reasoningState.success_criteria, observation) : undefined;
          if (decision.operation === "DONE" && deterministic?.result === "yes") {
            lastAssessment = { decision: "DONE", goal_satisfied: true, blocked: false, progress: "complete", reason_code: "deterministic_criteria_met", confidence: 1 };
            verdict = { goal_satisfied: true, blocked: false, confidence: 1, criteria: deterministic.criteria, reason_code: "deterministic_criteria_met" };
            recordReasoning("termination_candidate", { value: lastAssessment, metadata: { provider: "deterministic", model: "explicit-criteria", latencyMs: 0 } }, true);
          } else if (decision.operation === "DONE" && deterministic?.result === "no") {
            lastAssessment = { decision: "CONTINUE", goal_satisfied: false, blocked: false, progress: "partial", reason_code: "deterministic_criteria_not_met", confidence: 1 };
            recordReasoning("termination_candidate", { value: lastAssessment, metadata: { provider: "deterministic", model: "explicit-criteria", latencyMs: 0 } }, true);
          } else if (this.options.reasoningController) {
            const trigger: ReasoningTrigger = candidate ? "termination_candidate" : stuck ? "stuck" : lowConfidence ? "low_confidence" : "periodic";
            const response = await this.options.reasoningController.assess({ state: reasoningState, trigger, observation, recentActions, layaDecision: decision, progress: { urlChanged: previousObservation?.url !== observation.url, repeatedActionCount, noProgressSteps }, signal });
            lastAssessment = response.value; recordReasoning(trigger, response); if (lastAssessment.next_subgoal) reasoningState = { ...reasoningState, subgoal: lastAssessment.next_subgoal };
          } else if (candidate) {
            // Explicit compatibility mode: without System 2, preserve the historical Laya-only behavior.
            lastAssessment = { decision: decision.operation === "DONE" ? "DONE" : "BLOCKED", goal_satisfied: decision.operation === "DONE", blocked: decision.operation === "BLOCKED", progress: decision.operation === "DONE" ? "complete" : "none", reason_code: "reasoning_disabled", confidence: decision.confidence };
          }
          if (lastAssessment?.decision === "DONE" || lastAssessment?.decision === "BLOCKED") {
            status = lastAssessment.decision === "DONE" ? "completed" : "blocked"; termination = { reason: lastAssessment.decision.toLowerCase(), message: lastAssessment.rationale ?? decision.reason }; steps.push(makeStep());
            if (!verdict && this.options.reasoningController) { const response = await this.options.reasoningController.finalize({ state: reasoningState, trigger: "finalize", observation, recentActions, layaDecision: decision, progress: { urlChanged: previousObservation?.url !== observation.url, repeatedActionCount, noProgressSteps }, termination, assessment: lastAssessment, signal }); verdict = response.value; recordReasoning("finalize", response); }
            break;
          }
          if (candidate || (lowConfidence && this.options.reasoningController)) { steps.push(makeStep()); previousDecision = decision; previousObservation = observation; continue; }
        }
        if (lowConfidence) { validation = "LOW_CONFIDENCE"; termination = { reason: "low_confidence", message: `Confidence ${decision.confidence} is below ${request.confidenceThreshold}` }; steps.push(makeStep()); break; }
        if ((decision.operation === "TYPE_TEXT" || decision.operation === "SELECT") && decision.elementIndex !== undefined) {
          if (!this.options.valueProvider) throw new Error(`${decision.operation} requires a configured ValueProvider`); const elementIndex = decision.elementIndex;
          decision = { ...decision, value: await this.options.valueProvider.valueFor(decision.operation, observation, elementIndex, agentContext) };
          if (decision.operation === "SELECT" && !(observation.elements[elementIndex].options ?? []).some(option => option.value === decision!.value)) throw new Error("SELECT value was not an observed option");
        }
        const actionStarted = Date.now(); const execution = await execute(this.options.driver, decision, observation); const actionMs = Date.now() - actionStarted; previousDecision = decision; previousResult = execution.summary; previousObservation = observation; recentActions.push({ decision, result: execution.summary });
        let screenshot: string | undefined; if (request.screenshots) { screenshot = join(screenshotDir, `${String(n).padStart(3, "0")}.png`); await this.options.driver.screenshot({ path: screenshot }); }
        steps.push({ step: n, timestamp: new Date().toISOString(), url: observation.url, candidates, scopedCandidates: decision.diagnostics?.scopedIndices, chunking: decision.diagnostics?.chunking, decision, validation, execution: { ...execution, durationMs: actionMs }, screenshot, timings: { observationMs, inferenceMs, actionMs, stepMs: Date.now() - stepStarted } });
        events.push({ type: "action.executed", timestamp: new Date().toISOString(), data: { step: n, operation: decision.operation } });
        function makeStep(): JourneyStep { return { step: n, timestamp: new Date().toISOString(), url: observation.url, candidates, scopedCandidates: decision?.diagnostics?.scopedIndices, chunking: decision?.diagnostics?.chunking, decision, validation, timings: { observationMs, inferenceMs: decision?.diagnostics?.inferenceMs ?? Date.now() - inferenceStarted, actionMs: 0, stepMs: Date.now() - stepStarted } }; }
      }
    } catch (error) { termination = { reason: signal.aborted ? "cancelled" : "error", message: error instanceof Error ? error.message : String(error) }; status = signal.aborted ? "cancelled" : "error"; }
    finally { finalUrl = await this.options.driver.getUrl().catch(() => finalUrl); if (traceStarted) { try { await this.options.driver.stopTrace?.(tracePath); traceWritten = true; } catch (error) { traceError = error instanceof Error ? error : new Error(String(error)); } } await this.options.driver.close().catch(() => undefined); }
    if (request.trace && !traceWritten) { status = "error"; termination = { reason: "trace_error", message: traceError?.message ?? "Browser trace was not finalized" }; }
    metrics.journey_ms = Date.now() - started;
    const result = JourneyResultSchema.parse({ schema_version: "1", journey_id: id, status, goal: request.goal, start_url: request.url, final_url: finalUrl, duration_ms: metrics.journey_ms, step_count: steps.length, termination, steps, events, artifacts: { result: join(runDir, "journey-result.json"), screenshots: steps.flatMap(s => s.screenshot ? [s.screenshot] : []), ...(traceWritten ? { trace: tracePath } : {}) }, metrics, context: request.context, agent: { type: this.options.agent.name, backend: this.options.agent.backend, model: this.options.agent.model, revision: this.options.agent.revision }, reasoning: reasoningState ? { state: reasoningState, verdict, last_assessment: lastAssessment } : undefined });
    await writeFile(join(runDir, "journey-result.json"), `${JSON.stringify(result, null, 2)}\n`); return result;
  }
}

function sameDecision(a: AgentDecision | undefined, b: AgentDecision) { return Boolean(a && a.operation === b.operation && a.elementIndex === b.elementIndex); }
async function observe(driver: BrowserDriver): Promise<Observation> { const snap = await driver.snapshot({ interactive: true, compact: true }); const structured = snap.details?.elements; const elements = structured?.map(element => ({ ref: element.ref, role: element.role, name: element.name, enabled: element.enabled ?? true, value: element.value, selected: element.selected, options: element.options, operations: element.operations ?? operationsForRole(element.role) })) ?? (snap.stdout ?? "").split("\n").flatMap(line => { const match = line.match(/(?:\[ref=([^\]]+)\]\s+(\w+)\s+["']([^"']*)["']|(\w+)\s+["']([^"']*)["'].*\[ref=([^\]]+)\])/i); if (!match) return []; const role = (match[2] ?? match[4]).toLowerCase(); const name = match[3] ?? match[5]; const ref = match[1] ?? match[6]; const value = line.match(/value=["']([^"']*)["']/i)?.[1]; return [{ ref, role, name, enabled: !/\bdisabled\b/i.test(line), value, selected: /\bselected\b/i.test(line) ? true : undefined, operations: operationsForRole(role) }]; }); return { url: await driver.getUrl(), title: await driver.getTitle(), visibleText: snap.stdout, elements }; }
function operationsForRole(role: string): Array<"CLICK" | "TYPE_TEXT" | "SELECT"> { const normalized = role.toLowerCase(); if (["textbox", "searchbox"].includes(normalized)) return ["TYPE_TEXT"]; if (["combobox", "listbox"].includes(normalized)) return ["SELECT"]; return ["CLICK"]; }
async function execute(driver: BrowserDriver, decision: ReturnType<typeof AgentDecisionSchema.parse>, observation: Observation) { const target = decision.elementIndex === undefined ? undefined : observation.elements[decision.elementIndex]?.ref; let result; switch (decision.operation) { case "CLICK": result = await driver.click(target!); break; case "TYPE_TEXT": result = await driver.fill(target!, decision.value ?? ""); break; case "SELECT": if (!driver.select) throw new Error("Browser driver does not support SELECT"); result = await driver.select(target!, decision.value!); break; case "SCROLL": result = await driver.scroll({ direction: "down" }); break; case "WAIT": result = await driver.wait({ kind: "duration", ms: 500 }); break; case "BACK": result = await driver.press("Alt+ArrowLeft"); break; case "NAVIGATE": throw new Error("Model-directed arbitrary navigation is not allowed"); default: throw new Error(`Unsupported executable operation ${decision.operation}`); } return { success: true, summary: result.summary }; }
