export type LayaMode = "auto" | "remote" | "embedded" | "mock";
export function isHuggingFaceSpace(env: NodeJS.ProcessEnv = process.env) { return Boolean(env.SPACE_ID || env.SPACE_HOST || env.SYSTEM === "spaces"); }
export function resolveLayaMode(value = process.env.LAYA_MODE ?? "auto", env: NodeJS.ProcessEnv = process.env): LayaMode {
  if (!["auto", "remote", "embedded", "mock"].includes(value)) throw new Error(`Invalid LAYA_MODE: ${value}`);
  if (value !== "auto") return value as LayaMode;
  if (isHuggingFaceSpace(env)) return "embedded";
  return env.LAYA_REMOTE_URL ? "remote" : "embedded";
}
export function positiveEnv(name: string, fallback: number) { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value; }
export function nonnegativeEnv(name: string, fallback: number) { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`); return value; }
export type ReasoningMode = "off" | "pi";
export function resolveReasoningMode(value = process.env.REASONING_MODE ?? "off"): ReasoningMode { if (value !== "off" && value !== "pi") throw new Error(`Invalid REASONING_MODE: ${value}`); return value; }
