import { describe, expect, it } from "vitest";
import { OpenAICompatibleReasoningController } from "../src/journey/spark.js";
const input = { goal: "Open pricing", successCriteria: [], context: {}, signal: new AbortController().signal };
function responder(seen: Headers[]) { return async (_url: string | URL | Request, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"goal":"Open pricing","success_criteria":[]}' } }] }), { status: 200, headers: { "content-type": "application/json" } }); }; }
describe("Spark OpenAI-compatible authentication", () => {
  it("omits Authorization when no optional key is configured", async () => { const seen: Headers[] = []; await new OpenAICompatibleReasoningController({ baseUrl: "http://spark.test/v1/", fetch: responder(seen) as typeof fetch }).initialize(input); expect(seen[0].has("authorization")).toBe(false); });
  it("sends Authorization only for a non-empty configured key", async () => { const seen: Headers[] = []; await new OpenAICompatibleReasoningController({ baseUrl: "http://spark.test/v1/", apiKey: "key", fetch: responder(seen) as typeof fetch }).initialize(input); expect(seen[0].get("authorization")).toBe("Bearer key"); });
});
