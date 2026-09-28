import { AgentDecisionSchema, type AgentDecision, type JourneyAgent, type JourneyContext, type Observation, type ValueProvider } from "./types.js";

export class ScriptedAgent implements JourneyAgent {
  readonly name = "scripted";
  readonly backend = "scripted";
  private cursor = 0;
  constructor(private readonly decisions: readonly AgentDecision[]) {}
  async decide(): Promise<AgentDecision> {
    const decision = this.decisions[this.cursor++];
    if (!decision) return { operation: "BLOCKED", confidence: 1, reason: "Script exhausted" };
    return AgentDecisionSchema.parse(decision);
  }
}

export class StaticValueProvider implements ValueProvider {
  constructor(private readonly values: Record<string, string>) {}
  async valueFor(operation: "TYPE_TEXT" | "SELECT", _observation: Observation, elementIndex: number, _context: JourneyContext) {
    const value = this.values[`${operation}:${elementIndex}`];
    if (value === undefined) throw new Error(`No deterministic value for ${operation}:${elementIndex}`);
    return value;
  }
}

export class MockAgent implements JourneyAgent {
  readonly name = "mock";
  readonly backend = "mock";
  constructor(private readonly decideFn: JourneyAgent["decide"] = async () => ({ operation: "DONE", confidence: 1 })) {}
  async decide(...args: Parameters<JourneyAgent["decide"]>): Promise<AgentDecision> {
    return AgentDecisionSchema.parse(await this.decideFn(...args));
  }
}
