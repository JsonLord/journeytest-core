"""Minimal JourneyTest API client using only the Python standard library."""
import json, time, urllib.error, urllib.request
BASE = "http://localhost:7860"
def call(path, method="GET", body=None):
    request = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response: return response.status, json.load(response)
_, created = call("/api/v1/journeys", "POST", {"url": "https://example.com", "goal": "Open more information", "trace": True})
journey_id = created["journey_id"]
while True:
    status, result = call(f"/api/v1/journeys/{journey_id}/result")
    if status == 200: break
    time.sleep(1)
print(json.dumps(result, indent=2))
for artifact_id in ["screenshot-1", "trace"]:
    try: urllib.request.urlretrieve(f"{BASE}/api/v1/journeys/{journey_id}/artifacts/{artifact_id}", artifact_id + (".png" if artifact_id.startswith("screenshot") else ".json"))
    except urllib.error.HTTPError as error: print(f"{artifact_id}: {error.code}")
