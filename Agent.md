# Agent.md: Deployment & Management Guide for Hugging Face Space

This file informs future agents and maintainers about tricks and ongoing deployment best practices for running this codebase on Hugging Face Spaces.

## 1. Deployment Configuration

### Target Space
- **Profile:** `Leon4gr45`
- **Space:** `nova-right-nav`
- **Full Identifier:** `Leon4gr45/nova-right-nav`
- **Frontend Port:** `7860` (mandatory for all Hugging Face Spaces)

### Deployment Method
- **Docker SDK** — Used for containerized flexibility (Node.js 24 + Python Laya backend + Chrome driver + Gradio/API).

### HF Token
- The environment variable **`HF_TOKEN` will always be provided at execution time**.
- Never hardcode the token. Always read it from the environment.
- All monitoring and log‑streaming commands rely on `HF_TOKEN`.

### Required Files
- `Dockerfile`
- `README.md` with Hugging Face YAML frontmatter:
  ```yaml
  ---
  title: JourneyTest Laya
  sdk: docker
  app_port: 7860
  ---
  ```
- `.hfignore` to exclude unnecessary files (e.g., `node_modules`, `.git`, `dist`, `coverage`, `runs`)
- `Agent.md` (this file)

---

## 2. API Exposure and Documentation

### Mandatory Endpoints
Every deployment **must** expose:

- **`/health`**
  - Returns HTTP 200 when the app is ready.
  - Required for Hugging Face to transition the Space from *starting* → *running*.

- **`/api-docs`**
  - Documents **all** available API endpoints using Swagger UI.
  - Reachable at: `https://Leon4gr45-nova-right-nav.hf.space/api-docs` or `/docs`

### Functional Endpoints

#### `/health` or `/api/v1/health`
- **Method:** GET
- **Purpose:** Health check
- **Response Example:**
  ```json
  {
    "ok": true
  }
  ```

#### `/api/v1/ready`
- **Method:** GET
- **Purpose:** Check Laya backend model readiness
- **Response Example:**
  ```json
  {
    "ready": true,
    "laya": { "ok": true }
  }
  ```

#### `/api/v1/info`
- **Method:** GET
- **Purpose:** Runtime information and model configuration
- **Response Example:**
  ```json
  {
    "name": "JourneyTest",
    "schema_version": "1",
    "model": "ichenney/laya-browser-v32b",
    "laya": { "ok": true }
  }
  ```

#### `/api/v1/journeys`
- **Method:** POST
- **Purpose:** Create an asynchronous user journey test
- **Request Example:**
  ```json
  {
    "url": "https://example.com",
    "goal": "Open pricing",
    "maxSteps": 15,
    "timeoutMs": 120000,
    "screenshots": true
  }
  ```
- **Response Example:**
  ```json
  {
    "journey_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "created"
  }
  ```

#### `/api/v1/journeys/{id}`
- **Method:** GET
- **Purpose:** Retrieve status of a created journey
- **Response Example:**
  ```json
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "completed"
  }
  ```

#### `/api/v1/journeys/{id}/result`
- **Method:** GET
- **Purpose:** Retrieve full execution results and artifacts summary
- **Response Example:**
  ```json
  {
    "schema_version": "1",
    "journey_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "completed",
    "goal": "Open pricing"
  }
  ```

#### `/api/v1/journeys/{id}/events`
- **Method:** GET
- **Purpose:** Retrieve event log stream for a journey

#### `/api/v1/journeys/{id}/cancel`
- **Method:** POST
- **Purpose:** Cancel a running journey

#### `/api/v1/journeys/{id}/artifacts/{artifact_id}`
- **Method:** GET
- **Purpose:** Download execution artifact (e.g. `result`, `trace`, `screenshot-1`)

All endpoints listed here appear in `/api-docs` and `/api/v1/openapi.json`.

---

## 3. Deployment Workflow

### Precondition
Cleansing the space before deployment can be performed via git push from a clean mirror repository or using `upload_folder` with `delete_patterns='*'`.

### Standard Deployment Command
After any code change, run:

```bash
hf upload Leon4gr45/nova-right-nav --repo-type=space
```

### Scan build and run logs
```bash
# Get build logs (SSE)
curl -N -H "Authorization: Bearer $HF_TOKEN" "https://huggingface.co/api/spaces/Leon4gr45/nova-right-nav/logs/build"

# Get run logs (SSE) once the build logs succeed
curl -N -H "Authorization: Bearer $HF_TOKEN" "https://huggingface.co/api/spaces/Leon4gr45/nova-right-nav/logs/run"
```

Monitor for 300 seconds to confirm the space transitions to running and responds to the `/health` and `/api-docs` endpoints.
