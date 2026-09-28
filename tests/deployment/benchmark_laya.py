#!/usr/bin/env python3
import json, time, os, sys, urllib.request, urllib.error, statistics
from typing import Dict, Any, List, Optional
from concurrent.futures import ThreadPoolExecutor

class LocalLayaClient:
    def __init__(self, endpoint: str = "http://127.0.0.1:7861", timeout: float = 60.0):
        self.endpoint = endpoint
        self.timeout = timeout

    def infer(self, state: Dict[str, Any], questions: Dict[str, Any], model: str = "ichenney/laya-browser-v32b") -> Dict[str, Any]:
        payload = {
            "model": model,
            "state": state,
            "questions": questions
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.endpoint, data=data, headers={"Content-Type": "application/json"}, method="POST")

        start_time = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                rtt_ms = (time.perf_counter() - start_time) * 1000.0
                body = json.loads(resp.read().decode("utf-8"))
                return {
                    "status": "success",
                    "http_status": resp.status,
                    "rtt_ms": rtt_ms,
                    "response": body,
                    "error": None
                }
        except urllib.error.HTTPError as e:
            rtt_ms = (time.perf_counter() - start_time) * 1000.0
            error_body = e.read().decode("utf-8") if e.fp else ""
            return {
                "status": "error",
                "http_status": e.code,
                "rtt_ms": rtt_ms,
                "response": None,
                "error": f"HTTP {e.code}: {error_body[:300]}"
            }
        except Exception as e:
            rtt_ms = (time.perf_counter() - start_time) * 1000.0
            return {
                "status": "error",
                "http_status": 0,
                "rtt_ms": rtt_ms,
                "response": None,
                "error": str(e)
            }

def validate_response_contract(questions: Dict[str, Any], response: Dict[str, Any]) -> List[str]:
    violations = []
    if not isinstance(response, dict):
        return ["Response is not a JSON object"]

    answers = response.get("answers")
    if not isinstance(answers, dict):
        return ["Response missing 'answers' object"]

    for q_name, q_spec in questions.items():
        if q_name not in answers:
            violations.append(f"Missing answer for question '{q_name}'")
            continue
        ans = answers[q_name]
        if not isinstance(ans, dict):
            violations.append(f"Answer for '{q_name}' is not an object")
            continue

        choice = ans.get("choice")
        probs = ans.get("probabilities")
        conf = ans.get("confidence")

        offered_keys = list(q_spec.get("criteria", {}).keys())
        if choice not in offered_keys:
            violations.append(f"Question '{q_name}': selected choice '{choice}' is not in offered criteria {offered_keys}")

        if not isinstance(probs, dict):
            violations.append(f"Question '{q_name}': probabilities is not an object")
        else:
            prob_keys = list(probs.keys())
            if set(prob_keys) != set(offered_keys):
                violations.append(f"Question '{q_name}': probability keys {prob_keys} do not match offered criteria {offered_keys}")

            prob_sum = 0.0
            max_prob = -1.0
            max_key = None
            for k, v in probs.items():
                if not isinstance(v, (int, float)) or v < 0.0 or v > 1.0:
                    violations.append(f"Question '{q_name}': probability for '{k}' ({v}) is invalid")
                else:
                    prob_sum += v
                    if v > max_prob:
                        max_prob = v
                        max_key = k

            if abs(prob_sum - 1.0) > 0.02:
                violations.append(f"Question '{q_name}': sum of probabilities ({prob_sum}) is not ~1.0")

            if max_key is not None and choice != max_key and abs(probs.get(choice, 0) - max_prob) > 1e-6:
                violations.append(f"Question '{q_name}': choice '{choice}' is not probability argmax '{max_key}'")

        if conf is not None:
            if not isinstance(conf, (int, float)) or conf < 0.0 or conf > 1.0:
                violations.append(f"Question '{q_name}': confidence ({conf}) is invalid")

    return violations

def percentile(data: List[float], pct: float) -> float:
    if not data: return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (pct / 100.0)
    f = int(k)
    c = f + 1 if f + 1 < len(sorted_data) else f
    d = k - f
    return sorted_data[f] + (sorted_data[c] - sorted_data[f]) * d

def normalize_response(body: Dict[str, Any]) -> Dict[str, Any]:
    """Unwrap common inference envelopes without manufacturing successful fields."""
    current = body
    for key in ("output", "result", "data"):
        if isinstance(current, dict) and isinstance(current.get(key), dict) and "answers" not in current:
            current = current[key]
    return current

def run_suite(client: LocalLayaClient, out_dir: str):
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    raw_logs = []
    contract_violations = []

    def record_run(test_id: str, state: dict, questions: dict, expected_choice: str, ans_key: str = "operation"):
        res = client.infer(state, questions)
        item = {
            "test_id": test_id,
            "timestamp": time.time(),
            "candidate_count": len(questions.get(ans_key, {}).get("criteria", {})),
            "expected": expected_choice,
            "status": res["status"],
            "actual": None,
            "correct": False,
            "confidence": 0.0,
            "model_latency_ms": None,
            "round_trip_ms": res["rtt_ms"],
            "overhead_ms": None,
            "backend": None,
            "model": None,
            "error": res["error"]
        }
        if res["status"] == "success" and res["response"]:
            resp = normalize_response(res["response"])
            item["backend"] = resp.get("backend")
            item["model"] = resp.get("model")
            latency = resp.get("latency_ms")
            item["model_latency_ms"] = latency if isinstance(latency, (int, float)) else None
            item["overhead_ms"] = max(0.0, item["round_trip_ms"] - latency) if isinstance(latency, (int, float)) else None

            # contract check
            vols = validate_response_contract(questions, resp)
            if vols:
                contract_violations.append({"test_id": test_id, "violations": vols})

            answers = resp.get("answers", {})
            if ans_key in answers:
                ans = answers[ans_key]
                actual = ans.get("choice")
                conf = ans.get("confidence", 0.0)
                item["actual"] = actual
                item["correct"] = (actual == expected_choice)
                item["confidence"] = conf
                item["probabilities"] = ans.get("probabilities")
        raw_logs.append(item)
        return item

    print("1. Running Warm Simple-Choice Benchmark (50 runs)...")
    simple_state = {"page": {"url": "https://example.test/", "title": "Pricing", "text": "Home Pricing Documentation"}, "recent_actions": []}
    simple_questions = {"operation": {"type": "choice", "criteria": {"0": "Home", "1": "Pricing", "2": "Documentation"}, "instructions": {"goal": "Open the pricing page", "rules": "Choose the best link."}}}
    warm_simple_results = [record_run("warm_simple", simple_state, simple_questions, "1") for _ in range(50)]

    print("2. Running Candidate-Count Sensitivity Benchmarks...")
    candidate_counts = [5, 10, 20, 25, 40]
    candidate_summary = {}
    for count in candidate_counts:
        print(f"  Testing {count} candidates (20 runs)...")
        criteria = {str(i): f"Option {i} description" for i in range(count - 1)}
        criteria[str(count - 1)] = "Target Pricing Page Link"
        cand_questions = {"operation": {"type": "choice", "criteria": criteria, "instructions": {"goal": "Open the pricing page", "rules": "Select target link."}}}
        cand_runs = [record_run(f"cand_sensitivity_{count}", simple_state, cand_questions, str(count - 1)) for _ in range(20)]
        candidate_summary[count] = cand_runs

    print("3. Running DONE Benchmark...")
    done_cases = [
        ("done_1", {"page": {"url": "/pricing", "title": "Pricing Page", "text": "Heading: Pricing"}, "recent_actions": []}, "Open the pricing page", "DONE"),
        ("done_2", {"page": {"url": "/support", "title": "Support", "text": "Contact support at support@example.com"}, "recent_actions": []}, "Find the support email", "DONE"),
        ("done_3", {"page": {"url": "/order/123", "title": "Confirmation", "text": "Order confirmed! Thank you."}, "recent_actions": []}, "Reach the confirmation page", "DONE")
    ]
    done_summary = {}
    for case_id, state, goal, exp in done_cases:
        print(f"  Testing DONE case {case_id} (20 runs)...")
        q = {"operation": {"type": "choice", "criteria": {"CLICK": "Click element", "SCROLL": "Scroll", "WAIT": "Wait", "DONE": "Goal satisfied", "BLOCKED": "Blocked"}, "instructions": {"goal": goal, "rules": "Select operation."}}}
        done_summary[case_id] = [record_run(case_id, state, q, exp) for _ in range(20)]

    print("4. Running BLOCKED Benchmark...")
    blocked_cases = [
        ("blocked_1", {"page": {"url": "/", "title": "Home", "text": "Welcome home"}, "recent_actions": []}, "Delete the entire website", "BLOCKED"),
        ("blocked_2", {"page": {"url": "/", "title": "Home", "text": "Welcome home"}, "recent_actions": []}, "Find a control not present anywhere on the page", "BLOCKED"),
        ("blocked_3", {"page": {"url": "/", "title": "Home", "text": "Welcome home"}, "recent_actions": []}, "Upload a file when no upload control exists", "BLOCKED")
    ]
    blocked_summary = {}
    for case_id, state, goal, exp in blocked_cases:
        print(f"  Testing BLOCKED case {case_id} (20 runs)...")
        q = {"operation": {"type": "choice", "criteria": {"CLICK": "Click element", "SCROLL": "Scroll", "WAIT": "Wait", "DONE": "Goal satisfied", "BLOCKED": "Blocked"}, "instructions": {"goal": goal, "rules": "Select operation."}}}
        blocked_summary[case_id] = [record_run(case_id, state, q, exp) for _ in range(20)]

    print("5. Running Ambiguity Benchmark...")
    ambiguity_cases = [
        ("ambiguity_pricing", {"page": {"url": "/", "title": "Home", "text": "Check options"}, "recent_actions": []},
         {"operation": {"type": "choice", "criteria": {"0": "Pricing", "1": "Pricing FAQ", "2": "Pricing calculator"}, "instructions": {"goal": "Open main pricing overview page", "rules": "Select choice."}}}, "0"),
        ("ambiguity_continue", {"page": {"url": "/", "title": "Home", "text": "Check options"}, "recent_actions": []},
         {"operation": {"type": "choice", "criteria": {"0": "Continue", "1": "Continue shopping", "2": "Continue to payment"}, "instructions": {"goal": "Proceed to checkout payment screen", "rules": "Select choice."}}}, "2")
    ]
    ambiguity_summary = {}
    for case_id, state, q, exp in ambiguity_cases:
        print(f"  Testing ambiguity case {case_id} (20 runs)...")
        ambiguity_summary[case_id] = [record_run(case_id, state, q, exp) for _ in range(20)]

    print("6. Running Disabled / Restraint Cases...")
    disabled_q = {"operation": {"type": "choice", "criteria": {"0": "Continue (disabled)", "1": "Fix errors"}, "instructions": {"goal": "Form contains validation errors", "rules": "Select safe action."}}}
    disabled_runs = [record_run("disabled_restraint", simple_state, disabled_q, "1") for _ in range(20)]

    print("7. Running Back-To-Back Responsiveness (100 runs)...")
    back_to_back_runs = [record_run("back_to_back", simple_state, simple_questions, "1") for _ in range(100)]

    print("8. Running Limited Concurrency Benchmark (Levels 1, 2, 4)...")
    concurrency_summary = {}
    for level in [1, 2, 4]:
        print(f"  Testing concurrency level {level} (20 total requests)...")
        conc_runs = []
        with ThreadPoolExecutor(max_workers=level) as executor:
            futures = [executor.submit(record_run, f"concurrency_{level}", simple_state, simple_questions, "1") for _ in range(20)]
            for fut in futures:
                conc_runs.append(fut.result())
        concurrency_summary[level] = conc_runs

    print("9. Testing Failure Behavior...")
    failure_runs = []
    # Malformed request
    mal_res = client.infer(simple_state, {})
    failure_runs.append({"case": "missing_questions", "http_status": mal_res["http_status"], "error": mal_res["error"]})

    # Save raw jsonl
    raw_file = os.path.join(out_dir, "raw.jsonl")
    with open(raw_file, "w") as f:
        for item in raw_logs:
            f.write(json.dumps(item) + "\n")

    # Generate summary JSON
    def calc_stats(runs):
        valid = [r for r in runs if r["status"] == "success" and r["actual"] is not None]
        corrects = [r["correct"] for r in valid]
        acc = sum(corrects) / len(corrects) if corrects else 0.0
        m_lats = [r["model_latency_ms"] for r in valid if r["model_latency_ms"] is not None]
        rtts = [r["round_trip_ms"] for r in valid]
        confs = [r["confidence"] for r in valid]
        overheads = [r["overhead_ms"] for r in valid if r["overhead_ms"] is not None]
        return {
            "runs": len(runs),
            "valid_runs": len(valid),
            "accuracy": acc,
            "p50_model_ms": percentile(m_lats, 50),
            "p95_model_ms": percentile(m_lats, 95),
            "p99_model_ms": percentile(m_lats, 99),
            "p50_rtt_ms": percentile(rtts, 50),
            "p95_rtt_ms": percentile(rtts, 95),
            "p99_rtt_ms": percentile(rtts, 99),
            "p50_overhead_ms": percentile(overheads, 50),
            "p95_overhead_ms": percentile(overheads, 95),
            "confidence_mean": statistics.mean(confs) if confs else 0.0,
            "confidence_min": min(confs) if confs else 0.0,
            "confidence_max": max(confs) if confs else 0.0
        }

    summary_data = {
        "timestamp": timestamp,
        "environment": {
            "endpoint": "http://127.0.0.1:7861",
            "space": "Leon4gr45/nova-right-nav",
            "hardware": "cpu-basic",
            "backend": "laya-torch",
            "model": "ichenney/laya-browser-v32b",
            "revision": "161d54d6000913ff279b0afd1ac77faef8685a9b"
        },
        "warm_simple": calc_stats(warm_simple_results),
        "candidate_sensitivity": {str(k): calc_stats(v) for k, v in candidate_summary.items()},
        "done_cases": {k: calc_stats(v) for k, v in done_summary.items()},
        "blocked_cases": {k: calc_stats(v) for k, v in blocked_summary.items()},
        "ambiguity_cases": {k: calc_stats(v) for k, v in ambiguity_summary.items()},
        "disabled_cases": calc_stats(disabled_runs),
        "back_to_back": calc_stats(back_to_back_runs),
        "concurrency": {str(k): calc_stats(v) for k, v in concurrency_summary.items()},
        "contract_violations_count": len(contract_violations),
        "contract_violations": contract_violations
    }

    with open(os.path.join(out_dir, "summary.json"), "w") as f:
        json.dump(summary_data, f, indent=2)

    print(f"=== Benchmark Completed! Results saved under {out_dir} ===")
    return summary_data, out_dir
