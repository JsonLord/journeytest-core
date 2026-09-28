# JourneyTest API with curl

```bash
BASE=http://localhost:7860
JOB=$(curl -sS -X POST "$BASE/api/v1/journeys" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","goal":"Open more information","trace":true}')
ID=$(printf '%s' "$JOB" | jq -r .journey_id)
curl -sS "$BASE/api/v1/journeys/$ID"
curl -sS "$BASE/api/v1/journeys/$ID/events"
# Poll until this returns HTTP 200 rather than 202.
curl -sS -o result.json -w '%{http_code}\n' "$BASE/api/v1/journeys/$ID/result"
curl -fLo screenshot.png "$BASE/api/v1/journeys/$ID/artifacts/screenshot-1"
curl -fLo trace.json "$BASE/api/v1/journeys/$ID/artifacts/trace"
```
