import { writeFile } from "node:fs/promises";

const base = "http://localhost:7860";
const created = await fetch(`${base}/api/v1/journeys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com", goal: "Open more information", trace: true }) }).then(response => response.json()) as { journey_id: string };
let result: Record<string, unknown>;
for (;;) { const response = await fetch(`${base}/api/v1/journeys/${created.journey_id}/result`); result = await response.json() as Record<string, unknown>; if (response.status === 200) break; await new Promise(resolve => setTimeout(resolve, 1000)); }
console.log(JSON.stringify(result, null, 2));
for (const artifactId of ["screenshot-1", "trace"]) { const response = await fetch(`${base}/api/v1/journeys/${created.journey_id}/artifacts/${artifactId}`); if (response.ok) await writeFile(artifactId === "trace" ? "trace.json" : "screenshot-1.png", Buffer.from(await response.arrayBuffer())); }
