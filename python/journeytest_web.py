"""Thin Gradio surface over the authoritative JourneyTest HTTP/service runtime."""
import json, os, time, urllib.error, urllib.request
import gradio as gr
from fastapi import FastAPI, Request
from fastapi.responses import Response
import httpx, uvicorn

API = os.environ.get("JOURNEYTEST_API_BASE", "http://127.0.0.1:7861")
def request(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.status, json.load(response)

def run_journey(url, goal, max_steps, timeout, screenshots, trace, laya_mode, context, domains, confidence):
    try: metadata = json.loads(context or "{}")
    except json.JSONDecodeError as error: raise gr.Error(f"Invalid context JSON: {error}")
    payload = {"url": url, "goal": goal, "maxSteps": int(max_steps), "timeoutMs": int(float(timeout) * 1000), "screenshots": screenshots, "trace": trace, "confidenceThreshold": float(confidence), "context": {**metadata, "layaMode": laya_mode}, "allowedDomains": [x.strip() for x in domains.split(",") if x.strip()]}
    _, created = request("/api/v1/journeys", "POST", payload); journey_id = created["journey_id"]
    while True:
        status_code, result = request(f"/api/v1/journeys/{journey_id}/result")
        if status_code == 200:
            steps = result.get("steps", []); last = steps[-1] if steps else {}; decision = last.get("decision", {})
            summary = {"journey_id": journey_id, "status": result["status"], "current_step": result["step_count"], "current_url": result["final_url"], "candidate_count": len(last.get("candidates", [])), "latest_operation": decision.get("operation"), "selected_target": decision.get("elementIndex"), "confidence": decision.get("confidence")}
            screenshots_out = result.get("artifacts", {}).get("screenshots", [])
            yield summary, result.get("events", []), screenshots_out[-1] if screenshots_out else None, result, result
            return
        yield {"journey_id": journey_id, "status": result.get("status", "running")}, [], None, {}, result
        time.sleep(.75)

with gr.Blocks(title="JourneyTest") as demo:
    gr.Markdown("# JourneyTest Developer UI\nAll runs use the shared JourneyService.")
    with gr.Row():
        url = gr.Textbox(label="Start URL"); goal = gr.Textbox(label="Goal", lines=3)
    with gr.Row():
        max_steps = gr.Number(15, label="Max steps"); timeout = gr.Number(120, label="Timeout seconds"); screenshots = gr.Checkbox(True, label="Capture screenshots"); trace = gr.Checkbox(False, label="Capture trace"); mode = gr.Dropdown(["auto", "remote", "embedded"], value="auto", label="Laya mode")
    with gr.Accordion("Advanced", open=False):
        context = gr.Code("{}", language="json", label="Context JSON"); domains = gr.Textbox(label="Allowed domains (comma-separated)"); confidence = gr.Slider(0, 1, .15, label="Confidence threshold")
    run = gr.Button("Run journey", variant="primary")
    with gr.Row(): status = gr.JSON(label="Live status"); screenshot = gr.Image(label="Latest screenshot", type="filepath")
    events = gr.JSON(label="Event feed"); result = gr.JSON(label="Result"); raw = gr.JSON(label="Raw JourneyResult JSON")
    run.click(run_journey, [url, goal, max_steps, timeout, screenshots, trace, mode, context, domains, confidence], [status, events, screenshot, result, raw])
    with gr.Tab("Developer / API"):
        gr.Markdown(f"API base URL: `{API}`\n\nHealth: `{API}/api/v1/health` · Ready: `{API}/api/v1/ready`\n\n```bash\ncurl -X POST {API}/api/v1/journeys -H 'content-type: application/json' -d '{{\"url\":\"https://example.com\",\"goal\":\"Open pricing\"}}'\n```\n\n```python\nrequests.post('{API}/api/v1/journeys', json={{'url':'https://example.com','goal':'Open pricing'}})\n```")

app = FastAPI(title="JourneyTest API Proxy", docs_url="/docs")
try:
    _, PUBLIC_OPENAPI = request("/api/v1/openapi.json")
    app.openapi = lambda: PUBLIC_OPENAPI
except Exception:
    PUBLIC_OPENAPI = None
@app.api_route("/api/{path:path}", methods=["GET", "POST"])
async def api_proxy(path: str, request: Request):
    async with httpx.AsyncClient(timeout=30) as client:
        upstream = await client.request(request.method, f"{API}/api/{path}", content=await request.body(), headers={"content-type": request.headers.get("content-type", "application/json")})
    return Response(upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))
app = gr.mount_gradio_app(app, demo, path="/")
uvicorn.run(app, host=os.environ.get("JOURNEYTEST_HOST", "0.0.0.0"), port=int(os.environ.get("JOURNEYTEST_PORT", "7860")))
