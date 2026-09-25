#!/usr/bin/env python3
"""Felt Sharpener local harness.

Serves the game from this folder and exposes one endpoint, POST /api/coach, which wraps the
player's question in the expert-coach prompt (server/coach_prompt.md) together with the live game
state, and forwards it to any OpenAI-compatible /chat/completions endpoint (Ollama, LM Studio,
llama.cpp, vLLM, OpenAI, OpenRouter, Groq, ...).

Standard library only. Usage:
    python3 server/harness.py [--port 8765] [--no-browser]

Optional environment defaults (used when the in-game settings leave a field blank):
    FELT_LLM_ENDPOINT   e.g. http://localhost:11434/v1
    FELT_LLM_API_KEY
    FELT_LLM_MODEL      e.g. llama3.1:8b
"""
import argparse
import json
import os
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROMPT_PATH = os.path.join(HERE, "coach_prompt.md")
MAX_BODY = 512 * 1024
TIMEOUT = 180


def load_prompt():
    with open(PROMPT_PATH, encoding="utf-8") as f:
        return f.read()


def normalize_endpoint(url):
    """Accept base URLs like http://host:11434, .../v1 or a full .../chat/completions URL."""
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if url.endswith("/chat/completions"):
        return url
    if url.endswith("/v1") or url.endswith("/api/v1") or url.endswith("/openai"):
        return url + "/chat/completions"
    return url + "/v1/chat/completions"


def build_messages(question, history, context):
    system = load_prompt().replace("{{GAME_CONTEXT}}", (context or "(no game in progress)").strip())
    msgs = [{"role": "system", "content": system}]
    for m in (history or [])[-12:]:
        role = m.get("role")
        content = str(m.get("content", ""))[:8000]
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": str(question)[:4000]})
    return msgs


def call_llm(config, messages):
    endpoint = normalize_endpoint(config.get("endpoint") or os.environ.get("FELT_LLM_ENDPOINT", ""))
    if not endpoint:
        raise ValueError("No AI endpoint configured. Add one in Settings → AI Coach (or set FELT_LLM_ENDPOINT).")
    api_key = config.get("apiKey") or os.environ.get("FELT_LLM_API_KEY", "")
    model = config.get("model") or os.environ.get("FELT_LLM_MODEL", "") or "gpt-4o-mini"
    payload = {"model": model, "messages": messages, "temperature": float(config.get("temperature", 0.4))}
    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("Authorization", "Bearer " + api_key)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        raise RuntimeError(f"The AI endpoint returned HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach the AI endpoint at {endpoint}: {e.reason}")
    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("Unexpected response from the AI endpoint: " + json.dumps(data)[:400])
    return {"reply": reply, "model": data.get("model", model)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("[harness] " + (fmt % args) + "\n")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            return self._json(200, {"ok": True, "harness": "felt-sharpener", "envEndpoint": bool(os.environ.get("FELT_LLM_ENDPOINT"))})
        if self.path == "/api/prompt":
            return self._json(200, {"prompt": load_prompt()})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/coach":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "request too large"})
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            messages = build_messages(body.get("question", ""), body.get("history"), body.get("context"))
            result = call_llm(body.get("config") or {}, messages)
            return self._json(200, result)
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 — report any upstream failure to the UI
            return self._json(502, {"error": str(e)})


def main():
    ap = argparse.ArgumentParser(description="Felt Sharpener local harness")
    ap.add_argument("--port", type=int, default=int(os.environ.get("FELT_PORT", 8765)))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Felt Sharpener running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
