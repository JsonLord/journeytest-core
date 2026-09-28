import { spawn, type ChildProcess } from "node:child_process";
export interface ManagedLayaOptions { command?: string; args?: string[]; endpoint?: string; startupTimeoutMs?: number; env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch }
export class ManagedLayaService {
  private child?: ChildProcess;
  readonly endpoint: string;
  constructor(private readonly options: ManagedLayaOptions = {}) { this.endpoint = options.endpoint ?? "http://127.0.0.1:8791/v1/systemone"; }
  async start() {
    if (this.child) return;
    const command = this.options.command ?? process.env.LOCALDECIDE_PYTHON ?? "python3"; const args = this.options.args ?? ["-m", "localdecide.serve"];
    this.child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...this.options.env, LOCALDECIDE_HOST: "127.0.0.1", LOCALDECIDE_PORT: new URL(this.endpoint).port || "8791", LOCALDECIDE_BACKEND: process.env.LAYA_BACKEND === "mlx" ? "laya-mlx" : "laya-torch" } });
    const exited = new Promise<never>((_, reject) => this.child!.once("exit", code => reject(new Error(`localdecide exited before readiness (code ${code})`))));
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? Number(process.env.LAYA_STARTUP_TIMEOUT_MS ?? 180_000));
    while (Date.now() < deadline) { if (this.child.exitCode !== null) await exited; try { const response = await (this.options.fetch ?? fetch)(new URL("/healthz", this.endpoint)); if (response.ok) { if (process.env.LAYA_PREWARM !== "0") await this.prewarm(deadline); return; } } catch {} await Promise.race([new Promise(resolve => setTimeout(resolve, 500)), exited]); }
    await this.stop(); throw new Error("Timed out waiting for localdecide health");
  }
  private async prewarm(deadline: number) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now())); try { const response = await (this.options.fetch ?? fetch)(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: process.env.LAYA_MODEL_REPO ?? "ichenney/laya-browser-v32b", state: { page: { url: "about:blank", title: "Ready", text: "Ready" }, recent_actions: [] }, questions: { operation: { type: "choice", instructions: "Readiness smoke test", criteria: { DONE: "Ready", BLOCKED: "Not ready" } } } }), signal: controller.signal }); if (!response.ok) throw new Error(`localdecide prewarm failed: HTTP ${response.status}`); } finally { clearTimeout(timer); } }
  async stop() { const child = this.child; this.child = undefined; if (!child || child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
}
