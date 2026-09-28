import { randomUUID } from "node:crypto";
import { JourneyRequestSchema, type JourneyRequest, type JourneyResult } from "./types.js";
import type { JourneyRunner } from "./runner.js";

type JourneyExecutionStatus = "created" | "queued" | "running" | "completed" | "failed" | "cancelled";
type JourneyEvent = JourneyResult["events"][number];
interface JourneyRecord {
  request: JourneyRequest;
  sessionSecrets: Record<string, string>;
  status: JourneyExecutionStatus;
  result?: JourneyResult;
  controller: AbortController;
  events: JourneyEvent[];
  queuedAt?: string;
  startedAt?: string;
  cancelRequestedAt?: string;
  cancelledAt?: string;
}
interface Waiter { id: string; resolve: () => void }
export interface JourneyServiceOptions { maxConcurrent?: number; maxQueued?: number }

export class JourneyCapacityError extends Error {
  readonly code = "CAPACITY_EXCEEDED";
  readonly retryable = true;
  constructor() { super("Journey execution capacity is currently full."); }
}

export class JourneyTerminalError extends Error {
  readonly code = "JOURNEY_ALREADY_TERMINAL";
  readonly retryable = false;
  constructor() { super("Journey is already terminal."); }
}

export class JourneyService {
  private readonly journeys = new Map<string, JourneyRecord>();
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;

  constructor(private readonly runnerFactory: (request: JourneyRequest, sessionSecrets: Record<string, string>) => JourneyRunner, options: JourneyServiceOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
    this.maxQueued = Math.max(0, options.maxQueued ?? 10);
  }

  async createJourney(request: unknown, sessionSecrets: Record<string, string> = {}): Promise<string> {
    const parsed = JourneyRequestSchema.parse(request);
    const admitted = [...this.journeys.values()].filter(record => record.status === "created" || record.status === "queued" || record.status === "running").length;
    if (admitted >= this.maxConcurrent + this.maxQueued) throw new JourneyCapacityError();
    const id = randomUUID();
    this.journeys.set(id, { request: parsed, sessionSecrets: { ...sessionSecrets }, status: "created", controller: new AbortController(), events: [] });
    return id;
  }

  async runJourney(id: string): Promise<JourneyResult> {
    const record = this.require(id);
    if (record.status !== "created") throw new JourneyTerminalError();
    await this.acquire(id, record);
    record.startedAt = new Date().toISOString();
    record.status = "running";
    try {
      record.result = await this.runnerFactory(record.request, record.sessionSecrets).run(id, record.request, record.controller.signal);
      record.status = record.result.status === "cancelled" ? "cancelled" : record.result.status === "error" ? "failed" : "completed";
      if (record.status === "cancelled") record.cancelledAt = new Date().toISOString();
      return record.result;
    } catch (error) {
      record.status = record.controller.signal.aborted ? "cancelled" : "failed";
      if (record.status === "cancelled") record.cancelledAt = new Date().toISOString();
      throw error;
    } finally {
      record.sessionSecrets = {};
      this.release();
    }
  }

  async getJourney(id: string) {
    const record = this.require(id);
    const queueWaitMs = record.queuedAt && record.startedAt ? new Date(record.startedAt).getTime() - new Date(record.queuedAt).getTime() : undefined;
    return { id, request: record.request, status: record.status, queued_at: record.queuedAt, started_at: record.startedAt, queue_wait_ms: queueWaitMs, cancel_requested_at: record.cancelRequestedAt, cancelled_at: record.cancelledAt };
  }
  async getResult(id: string) { return this.require(id).result; }
  async getEvents(id: string) { const record = this.require(id); return [...record.events, ...(record.result?.events ?? [])]; }

  async cancelJourney(id: string) {
    const record = this.require(id);
    if (["completed", "failed", "cancelled"].includes(record.status)) throw new JourneyTerminalError();
    if (!record.cancelRequestedAt) {
      record.cancelRequestedAt = new Date().toISOString();
      record.events.push({ type: "journey.cancel_requested", timestamp: record.cancelRequestedAt });
    }
    record.controller.abort();
  }

  getRuntimeMetrics() {
    return { active_journeys: this.active, queued_journeys: this.waiters.length, browser_slots_used: this.active, browser_slots_available: Math.max(0, this.maxConcurrent - this.active), max_active_journeys: this.maxConcurrent, max_queued_journeys: this.maxQueued };
  }

  private require(id: string) { const record = this.journeys.get(id); if (!record) throw new Error(`Unknown journey ${id}`); return record; }
  private async acquire(id: string, record: JourneyRecord) {
    if (this.active < this.maxConcurrent) { this.active++; return; }
    // Capacity was reserved by createJourney, so this cannot overflow unless a
    // caller bypasses the normal create/run sequence.
    if (this.waiters.length >= this.maxQueued) throw new JourneyCapacityError();
    record.status = "queued";
    record.queuedAt = new Date().toISOString();
    await new Promise<void>(resolve => this.waiters.push({ id, resolve }));
  }
  private release() {
    const next = this.waiters.shift();
    if (next) next.resolve(); // hand the existing active-slot reservation over
    else this.active = Math.max(0, this.active - 1);
  }
}
