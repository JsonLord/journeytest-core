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

def normalize_secret(value):
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def normalize_secrets(values):
    return {key: normalized for key, value in values.items() if (normalized := normalize_secret(value))}


def run_journey(url, goal, max_steps, timeout, screenshots, trace, laya_mode, cognition_profile, hosted_verification, vision_enabled, terminal_verification, openai_key, anthropic_key, gemini_key, hosted_key, vision_key, spark_key, context, domains, confidence):
    try: metadata = json.loads(context or "{}")
    except json.JSONDecodeError as error: raise gr.Error(f"Invalid context JSON: {error}")
    payload = {"url": url, "goal": goal, "maxSteps": int(max_steps), "timeoutMs": int(float(timeout) * 1000), "screenshots": screenshots, "trace": trace, "confidenceThreshold": float(confidence), "context": {**metadata, "layaMode": laya_mode}, "sessionCredentials": normalize_secrets({"OPENAI_API_KEY": openai_key, "ANTHROPIC_API_KEY": anthropic_key, "GEMINI_API_KEY": gemini_key, "LAYA_HOSTED_API_KEY": hosted_key, "LAYA_VISION_API_KEY": vision_key, "SPARK_OPENAI_API_KEY": spark_key}), "cognitionProfile": cognition_profile, "cognitionOptions": {"hostedVerification": hosted_verification, "vision": vision_enabled, "cloudTerminalVerification": terminal_verification}, "allowedDomains": [x.strip() for x in domains.split(",") if x.strip()]}
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

PROFILE_LABELS = {
    "Local Laya + Cloud": "local-cloud",
    "Local Laya + Spark + Cloud": "local-spark-cloud",
    "Local + Hosted Laya + Cloud": "dual-laya-cloud",
    "Local + Hosted Laya + Spark + Cloud": "dual-laya-spark-cloud",
}
try:
    _, RUNTIME_INFO = request("/api/v1/info")
except Exception:
    RUNTIME_INFO = {"cognition": {}}
COGNITION = RUNTIME_INFO.get("cognition") or {}
DEFAULT_PROFILE = COGNITION.get("cognitionProfile", "local-cloud")
IS_SPACE = (COGNITION.get("source") or {}).get("deployment") == "hugging-face"
def apply_settings(profile_label, hosted_verification, vision_enabled, terminal_verification, *secrets):
    profile = PROFILE_LABELS[profile_label]
    configured = [name for name, value in zip(["OpenAI", "Anthropic", "Gemini", "Hosted Laya", "Laya Vision", "Spark"], secrets) if normalize_secret(value)]
    suffix = f" Session-only credentials supplied for: {', '.join(configured)}." if configured else ""
    return profile, hosted_verification, vision_enabled, terminal_verification, f"Applied `{profile}` for this browser session.{suffix} Credentials are not echoed or written."
def save_settings(profile_label, hosted_enabled, hosted_url, vision_enabled, vision_url, spark_enabled, spark_url, spark_model, cloud_enabled, provider, openai_base_url, model, attempts, *secrets):
    if IS_SPACE: return "Running on Hugging Face Space. To persist credentials: Space → Settings → Repository secrets."
    keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "LAYA_HOSTED_API_KEY", "LAYA_VISION_API_KEY", "SPARK_OPENAI_API_KEY"]
    body = {"COGNITION_PROFILE": PROFILE_LABELS[profile_label], "LAYA_HOSTED_ENABLED": str(hosted_enabled).lower(), "LAYA_HOSTED_BASE_URL": hosted_url or "", "LAYA_VISION_ENABLED": str(vision_enabled).lower(), "LAYA_VISION_BASE_URL": vision_url or "", "SPARK_REASONING_ENABLED": str(spark_enabled).lower(), "SPARK_OPENAI_BASE_URL": spark_url or "", "SPARK_MODEL": spark_model, "CLOUD_REASONING_ENABLED": str(cloud_enabled).lower(), "REASONING_PROVIDER": provider, "OPENAI_BASE_URL": openai_base_url or "", "OPENAI_MODEL": model, "CLOUD_MAX_ATTEMPTS": str(int(attempts))}
    body.update(normalize_secrets(dict(zip(keys, secrets))))
    _, result = request("/api/v1/settings/local", "POST", body); return result["message"]
def test_connections():
    _, result = request("/api/v1/settings/test", "POST", {}); return result
def build_ui():
    with gr.Blocks(title="JourneyTest") as demo:
        gr.Markdown("# JourneyTest Developer UI\nAll runs use the shared JourneyService.")
        with gr.Row():
            url = gr.Textbox(label="Start URL")
            goal = gr.Textbox(label="Goal", lines=3)
        profile_state = gr.State(DEFAULT_PROFILE)
        hosted_verify_state = gr.State(False)
        vision_state = gr.State(False)
        terminal_verify_state = gr.State(False)
        with gr.Row():
            max_steps = gr.Number(15, label="Max steps")
            timeout = gr.Number(120, label="Timeout seconds")
            screenshots = gr.Checkbox(True, label="Capture screenshots")
            trace = gr.Checkbox(False, label="Capture trace")
            mode = gr.Dropdown(["auto", "remote", "embedded"], value="auto", label="Laya mode")
        with gr.Accordion("Advanced", open=False):
            context = gr.Code("{}", language="json", label="Context JSON")
            domains = gr.Textbox(label="Allowed domains (comma-separated)")
            confidence = gr.Slider(0, 1, .15, label="Confidence threshold")
        run = gr.Button("Run journey", variant="primary")

        with gr.Accordion("⚙ Settings", open=False):
            gr.Markdown("## Cognition Profile")
            default_label = next((label for label, value in PROFILE_LABELS.items() if value == DEFAULT_PROFILE), "Local Laya + Cloud")
            profile_select = gr.Dropdown(list(PROFILE_LABELS), value=default_label, label="Profile")
            with gr.Row():
                hosted_verify = gr.Checkbox(False, label="Hosted Laya verification")
                vision_toggle = gr.Checkbox(False, label="Laya Vision")
                terminal_verify = gr.Checkbox(False, label="Cloud terminal verification")
            gr.Markdown("## System 1")
            with gr.Row():
                hosted_enabled = gr.Checkbox(False, label="Hosted Laya enabled")
                hosted_url = gr.Textbox(label="Hosted Laya base URL")
            gr.Markdown("## Vision")
            vision_url = gr.Textbox(label="Laya Vision base URL")
            gr.Markdown("## Local System 2")
            with gr.Row():
                spark_enabled = gr.Checkbox(DEFAULT_PROFILE.endswith("spark-cloud"), label="Spark enabled")
                spark_url = gr.Textbox(label="Spark OpenAI base URL")
                spark_model = gr.Textbox("spark-x2.5-1.7b", label="Spark model")
            gr.Markdown("## Cloud System 2")
            with gr.Row():
                cloud_enabled = gr.Checkbox(True, label="Cloud enabled")
                provider = gr.Dropdown(["openai", "anthropic", "gemini"], value="openai", label="Provider protocol")
                openai_base_url = gr.Textbox(label="OpenAI-compatible Base URL")
                reasoning_model = gr.Textbox(label="Model ID")
            gr.Markdown("Credentials are session-only unless **Save local configuration** is explicitly selected. Existing values are never loaded into these fields.")
            with gr.Row():
                openai_key = gr.Textbox(label="OpenAI — " + credential_status("openai"), type="password")
                anthropic_key = gr.Textbox(label="Anthropic — " + credential_status("anthropic"), type="password")
                gemini_key = gr.Textbox(label="Gemini — " + credential_status("gemini"), type="password")
            with gr.Row():
                hosted_key = gr.Textbox(label="Hosted Laya — " + credential_status("hostedLaya"), type="password")
                vision_key = gr.Textbox(label="Laya Vision — " + credential_status("layaVision"), type="password")
                spark_key = gr.Textbox(label="Spark auth — " + credential_status("spark"), type="password")
            gr.Markdown("## Advanced / retries")
            attempts = gr.Number(3, minimum=1, maximum=5, label="Cloud max attempts")
            deployment = "Running on Hugging Face Space. Session changes are ephemeral. To persist a credential: Space → Settings → Repository secrets." if IS_SPACE else "Running on localhost. Save local configuration writes `.env.local` with mode 0600."
            gr.Markdown("## Deployment\n" + deployment)
            settings_status = gr.Markdown(json.dumps(COGNITION, indent=2))
            with gr.Row():
                apply_button = gr.Button("Apply for this session", variant="primary")
                test_button = gr.Button("Test connections")
                save_button = gr.Button("Save local configuration", visible=not IS_SPACE)

        with gr.Row():
            status = gr.JSON(label="Live status")
            screenshot = gr.Image(label="Latest screenshot", type="filepath")
        events = gr.JSON(label="Event feed")
        result = gr.JSON(label="Result")
        raw = gr.JSON(label="Raw JourneyResult JSON")
        with gr.Tab("Developer / API"):
            gr.Markdown(f"API base URL: `{API}`\n\nHealth: `{API}/api/v1/health` · Ready: `{API}/api/v1/ready`\n\n```bash\ncurl -X POST {API}/api/v1/journeys -H 'content-type: application/json' -d '{{\"url\":\"https://example.com\",\"goal\":\"Open pricing\"}}'\n```")

    # Gradio 5 requires registration in a Blocks context. Re-enter only after
    # every referenced component has been constructed.
    with demo:
        secret_inputs = [openai_key, anthropic_key, gemini_key, hosted_key, vision_key, spark_key]
        run.click(run_journey, [url, goal, max_steps, timeout, screenshots, trace, mode, profile_state, hosted_verify_state, vision_state, terminal_verify_state, *secret_inputs, context, domains, confidence], [status, events, screenshot, result, raw])
        apply_button.click(apply_settings, [profile_select, hosted_verify, vision_toggle, terminal_verify, *secret_inputs], [profile_state, hosted_verify_state, vision_state, terminal_verify_state, settings_status])
        test_button.click(test_connections, [], settings_status)
        save_button.click(save_settings, [profile_select, hosted_enabled, hosted_url, vision_toggle, vision_url, spark_enabled, spark_url, spark_model, cloud_enabled, provider, openai_base_url, reasoning_model, attempts, *secret_inputs], settings_status)
    return demo


def credential_status(name):
    value = (COGNITION.get("credentials") or {}).get(name)
    return "configured ✓" if value is True or value == "configured" else "not configured"


def build_app():
    demo = build_ui()
    app = FastAPI(title="JourneyTest API Proxy", docs_url="/docs")
    try:
        _, public_openapi = request("/api/v1/openapi.json")
        app.openapi = lambda: public_openapi
    except Exception:
        pass

    @app.get("/health")
    async def health_endpoint():
        async with httpx.AsyncClient(timeout=10) as client:
            upstream = await client.get(f"{API}/health")
            return Response(upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))

    @app.get("/api-docs")
    async def api_docs_endpoint():
        async with httpx.AsyncClient(timeout=10) as client:
            upstream = await client.get(f"{API}/api-docs")
            return Response(upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))

    @app.api_route("/api/{path:path}", methods=["GET", "POST"])
    async def api_proxy(path: str, incoming: Request):
        async with httpx.AsyncClient(timeout=30) as client:
            upstream = await client.request(incoming.method, f"{API}/api/{path}", content=await incoming.body(), headers={"content-type": incoming.headers.get("content-type", "application/json")})
        return Response(upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))

    return gr.mount_gradio_app(app, demo, path="/"), demo


if __name__ == "__main__":
    application, _demo = build_app()
    uvicorn.run(application, host=os.environ.get("JOURNEYTEST_HOST", "0.0.0.0"), port=int(os.environ.get("JOURNEYTEST_PORT", "7860")))
