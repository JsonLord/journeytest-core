import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserDriver } from "../drivers/types.js";
import { AgentDecisionSchema, JourneyRequestSchema, JourneyResultSchema, type AgentDecision, type JourneyAgent, type JourneyContext, type JourneyResult, type JourneyStep, type Observation, type ValueProvider } from "./types.js";

export interface JourneyRunnerOptions { driver: BrowserDriver; agent: JourneyAgent; outputDir: string; valueProvider?: ValueProvider }

export class JourneyRunner {
  constructor(private readonly options: JourneyRunnerOptions) {}
  async run(id: string, rawRequest: unknown, signal = new AbortController().signal): Promise<JourneyResult> {
    const request = JourneyRequestSchema.parse(rawRequest);
    const started = Date.now();
    const runDir = join(this.options.outputDir, id);
    const screenshotDir = join(runDir, "screenshots");
    const tracePath = join(runDir, "trace.json");
    await mkdir(screenshotDir, { recursive: true });
    const steps: JourneyStep[] = [];
    const events: JourneyResult["events"] = [];
    let termination: JourneyResult["termination"] = { reason: "max_steps", message: "Maximum steps reached" };
    let status: JourneyResult["status"] = "error";
    let finalUrl = request.url;
    let previousDecision;
    let previousResult;
    let traceStarted = false;
    let traceWritten = false;
    let traceError: Error | undefined;
    const abort = () => { if (signal.aborted) throw new Error("Journey cancelled"); if (Date.now() - started > request.timeoutMs) throw new Error("Journey timeout"); };
    try {
      await this.options.driver.start({ runId: id, runDir, baseUrl: request.url, allowedOrigins: [new URL(request.url).origin], sessionName: id });
      if (request.trace) { if (!this.options.driver.startTrace || !this.options.driver.stopTrace) throw new Error("Browser driver does not support trace capture"); await this.options.driver.startTrace(tracePath); traceStarted = true; }
      await this.options.driver.open(request.url);
      for (let n = 1; n <= request.maxSteps; n++) {
        abort(); const stepStarted = Date.now(); const observationStarted = Date.now();
        const observation = await observe(this.options.driver);
        const observationMs = Date.now() - observationStarted;
        const candidates = observation.elements.map((element, index) => ({ index, ref: element.ref, role: element.role, name: element.name, operations: element.operations }));
        const inferenceStarted = Date.now();
        let decision: AgentDecision | undefined; let validation: JourneyStep["validation"] = "OK";
        const agentContext: JourneyContext = { journeyId: id, goal: request.goal, metadata: request.context, signal };
        try { decision = AgentDecisionSchema.parse(await this.options.agent.decide(observation, { step: n, previousDecision, previousResult }, agentContext)); }
        catch (error) { termination = { reason: "invalid_decision", message: error instanceof Error ? error.message : String(error) }; validation = "INVALID"; steps.push(makeStep()); break; }
        const inferenceMs = Date.now() - inferenceStarted;
        if (decision.confidence < request.confidenceThreshold && !["DONE", "BLOCKED"].includes(decision.operation)) { validation = "LOW_CONFIDENCE"; termination = { reason: "low_confidence", message: `Confidence ${decision.confidence} is below ${request.confidenceThreshold}` }; steps.push(makeStep()); break; }
        if (decision.elementIndex !== undefined && !candidates[decision.elementIndex]) { validation = "INVALID"; termination = { reason: "invalid_element_index", message: `Element ${decision.elementIndex} was not offered` }; steps.push(makeStep()); break; }
        if (decision.operation === "DONE" || decision.operation === "BLOCKED") { status = decision.operation === "DONE" ? "completed" : "blocked"; termination = decision.reason ? { reason: decision.operation.toLowerCase(), message: decision.reason } : { reason: decision.operation.toLowerCase() }; steps.push(makeStep()); break; }
        if ((decision.operation === "TYPE_TEXT" || decision.operation === "SELECT") && decision.elementIndex !== undefined) {
          if (!this.options.valueProvider) throw new Error(`${decision.operation} requires a configured ValueProvider`);
          const elementIndex = decision.elementIndex;
          decision = { ...decision, value: await this.options.valueProvider.valueFor(decision.operation, observation, elementIndex, agentContext) };
          if (decision.operation === "SELECT") { const options = observation.elements[elementIndex].options ?? []; if (!options.some((option: { value: string }) => option.value === decision!.value)) throw new Error(`SELECT value was not an observed option`); }
        }
        const actionStarted = Date.now();
        const execution = await execute(this.options.driver, decision, observation);
        const actionMs = Date.now() - actionStarted; previousDecision = decision; previousResult = execution.summary;
        let screenshot: string | undefined;
        if (request.screenshots) { screenshot = join(screenshotDir, `${String(n).padStart(3, "0")}.png`); await this.options.driver.screenshot({ path: screenshot }); }
        steps.push({ step: n, timestamp: new Date().toISOString(), url: observation.url, candidates, scopedCandidates: decision.diagnostics?.scopedIndices, chunking: decision.diagnostics?.chunking, decision, validation, execution: { ...execution, durationMs: actionMs }, screenshot, timings: { observationMs, inferenceMs: decision.diagnostics?.inferenceMs ?? inferenceMs, actionMs, stepMs: Date.now() - stepStarted } });
        events.push({ type: "action.executed", timestamp: new Date().toISOString(), data: { step: n, operation: decision.operation } });
        continue;
        function makeStep(): JourneyStep { return { step: n, timestamp: new Date().toISOString(), url: observation.url, candidates, scopedCandidates: decision?.diagnostics?.scopedIndices, chunking: decision?.diagnostics?.chunking, decision, validation, timings: { observationMs, inferenceMs: decision?.diagnostics?.inferenceMs ?? Date.now() - inferenceStarted, actionMs: 0, stepMs: Date.now() - stepStarted } }; }
      }
    } catch (error) { termination = { reason: signal.aborted ? "cancelled" : "error", message: error instanceof Error ? error.message : String(error) }; status = signal.aborted ? "cancelled" : "error"; }
    finally {
      finalUrl = await this.options.driver.getUrl().catch(() => finalUrl);
      if (traceStarted) { try { await this.options.driver.stopTrace?.(tracePath); traceWritten = true; } catch (error) { traceError = error instanceof Error ? error : new Error(String(error)); } }
      await this.options.driver.close().catch(() => undefined);
    }
    if (request.trace && !traceWritten) { status = "error"; termination = { reason: "trace_error", message: traceError?.message ?? "Browser trace was not finalized" }; }
    const result = JourneyResultSchema.parse({ schema_version: "1", journey_id: id, status, goal: request.goal, start_url: request.url, final_url: finalUrl, duration_ms: Date.now() - started, step_count: steps.length, termination, steps, events, artifacts: { result: join(runDir, "journey-result.json"), screenshots: steps.flatMap(s => s.screenshot ? [s.screenshot] : []), ...(traceWritten ? { trace: tracePath } : {}) }, metrics: { journey_ms: Date.now() - started }, context: request.context, agent: { type: this.options.agent.name, backend: this.options.agent.backend, model: this.options.agent.model, revision: this.options.agent.revision } });
    await writeFile(join(runDir, "journey-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
}

async function observe(driver: BrowserDriver): Promise<Observation> {
  const snap = await driver.snapshot({ interactive: true, compact: true });
  const structured = snap.details?.elements;
  const elements = structured?.map(element => ({ ref: element.ref, role: element.role, name: element.name, enabled: element.enabled ?? true, value: element.value, selected: element.selected, options: element.options, operations: element.operations ?? operationsForRole(element.role) })) ?? (snap.stdout ?? "").split("\n").flatMap(line => {
    const match = line.match(/(?:\[ref=([^\]]+)\]\s+(\w+)\s+["']([^"']*)["']|(\w+)\s+["']([^"']*)["'].*\[ref=([^\]]+)\])/i);
    if (!match) return [];
    const role = (match[2] ?? match[4]).toLowerCase(); const name = match[3] ?? match[5]; const ref = match[1] ?? match[6];
    const value = line.match(/value=["']([^"']*)["']/i)?.[1]; const selected = /\bselected\b/i.test(line) ? true : undefined;
    return [{ ref, role, name, enabled: !/\bdisabled\b/i.test(line), value, selected, operations: operationsForRole(role) }];
  });
  return { url: await driver.getUrl(), title: await driver.getTitle(), visibleText: snap.stdout, elements };
}
function operationsForRole(role: string): Array<"CLICK" | "TYPE_TEXT" | "SELECT"> { const normalized = role.toLowerCase(); if (["textbox", "searchbox"].includes(normalized)) return ["TYPE_TEXT"]; if (["combobox", "listbox"].includes(normalized)) return ["SELECT"]; return ["CLICK"]; }

async function execute(driver: BrowserDriver, decision: ReturnType<typeof AgentDecisionSchema.parse>, observation: Observation) {
  const target = decision.elementIndex === undefined ? undefined : observation.elements[decision.elementIndex]?.ref;
  let result;
  switch (decision.operation) {
    case "CLICK": result = await driver.click(target!); break;
    case "TYPE_TEXT": result = await driver.fill(target!, decision.value ?? ""); break;
    case "SELECT": if (!driver.select) throw new Error("Browser driver does not support SELECT"); result = await driver.select(target!, decision.value!); break;
    case "SCROLL": result = await driver.scroll({ direction: "down" }); break;
    case "WAIT": result = await driver.wait({ kind: "duration", ms: 500 }); break;
    case "BACK": result = await driver.press("Alt+ArrowLeft"); break;
    case "NAVIGATE": throw new Error("Model-directed arbitrary navigation is not allowed");
    default: throw new Error(`Unsupported executable operation ${decision.operation}`);
  }
  return { success: true, summary: result.summary };
}
