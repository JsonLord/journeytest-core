import { randomUUID } from "node:crypto";
import { JourneyRequestSchema, type JourneyRequest, type JourneyResult } from "./types.js";
import type { JourneyRunner } from "./runner.js";

interface JourneyRecord { request: JourneyRequest; sessionSecrets: Record<string, string>; status: "created" | "running" | "completed" | "failed"; result?: JourneyResult; controller: AbortController }
export interface JourneyServiceOptions { maxConcurrent?: number; maxQueued?: number }
export class JourneyService {
  private readonly journeys = new Map<string, JourneyRecord>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  constructor(private readonly runnerFactory: (request: JourneyRequest, sessionSecrets: Record<string, string>) => JourneyRunner, options: JourneyServiceOptions = {}) { this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1); this.maxQueued = Math.max(0, options.maxQueued ?? 10); }
  async createJourney(request: unknown, sessionSecrets: Record<string, string> = {}): Promise<string> { const id = randomUUID(); this.journeys.set(id, { request: JourneyRequestSchema.parse(request), sessionSecrets: { ...sessionSecrets }, status: "created", controller: new AbortController() }); return id; }
  async runJourney(id: string): Promise<JourneyResult> { const record = this.require(id); await this.acquire(); record.status = "running"; try { record.result = await this.runnerFactory(record.request, record.sessionSecrets).run(id, record.request, record.controller.signal); record.sessionSecrets = {}; record.status = "completed"; return record.result; } catch (error) { record.sessionSecrets = {}; record.status = "failed"; throw error; } finally { this.release(); } }
  async getJourney(id: string) { const { request, status } = this.require(id); return { id, request, status }; }
  async getResult(id: string) { return this.require(id).result; }
  async getEvents(id: string) { return this.require(id).result?.events ?? []; }
  async cancelJourney(id: string) { this.require(id).controller.abort(); }
  private require(id: string) { const record = this.journeys.get(id); if (!record) throw new Error(`Unknown journey ${id}`); return record; }
  private async acquire() { if (this.active < this.maxConcurrent) { this.active++; return; } if (this.waiters.length >= this.maxQueued) throw new Error("Journey queue is full"); await new Promise<void>(resolve => this.waiters.push(resolve)); this.active++; }
  private release() { this.active--; this.waiters.shift()?.(); }
}
