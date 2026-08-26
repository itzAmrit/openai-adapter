# OpenAI Adapter

A lightweight, zero-dependency-on-external-services local proxy that translates OpenAI API requests into Google Vertex AI / Gemini API calls.

Exposes standard OpenAI endpoints (`/v1/responses`, `/v1/chat/completions`, `/v1/models`) so that AI coding assistants like **Codex Desktop**, **Cursor**, **Continue**, **Cline**, and **Aider** can use Google Gemini models with full streaming, tool-calling, and multimodal capabilities.

---

## Key Features

- **OpenAI Responses & Chat Completions Protocol**: Supports both the new OpenAI Responses API (`/v1/responses`, `/openai/v1/responses`) and standard Chat Completions (`/v1/chat/completions`).
- **Server-Sent Events (SSE) Streaming**: Full support for real-time token streaming and incremental tool call deltas.
- **Thinking Models & Thought Signatures**: Preserves Google Gemini 3.x `thoughtSignature` contexts across multi-turn function calls.
- **Disk-Persistent Function Cache**: Caches function call contexts to disk (`/tmp/codex_gemini_function_call_cache.json`) with a 7-day TTL and dual key indexing (`call_id` and `item_id`). Survives server restarts.
- **Automatic Fallback Chain**: Gracefully cascades through configured fallback models (e.g. `gemini-3.7-flash` -> `gemini-3.5-flash` -> `gemini-2.5-flash`) on quota limits (HTTP 429), server errors (5xx), or model-specific validation rejections.
- **Authentication**: Supports Google Cloud Application Default Credentials (ADC) via local `gcloud` or direct Gemini API keys.
- **Multimodal**: Supports inline base64 images and remote HTTPS images with SSRF protection.
- **macOS Daemon Integration**: Includes launchd install and uninstall scripts.

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/itzAmrit/openai-adapter.git
cd openai-adapter
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
PORT=8766
HOST=127.0.0.1
VERTEX_PROJECT=your-google-cloud-project-id
VERTEX_LOCATION=global
VERTEX_MODEL=gemini-3.7-flash
VERTEX_FALLBACK_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite
```

If using Google Cloud ADC, make sure you are logged in:

```bash
gcloud auth application-default login
```

### 3. Start the Server

```bash
# Direct run
npm start

# Or with live reload
npm run dev
```

Check health:

```bash
curl http://127.0.0.1:8766/health
```

---

## Run as Background Service on macOS (Launchd)

To keep the adapter running in the background automatically across reboots:

```bash
# Install and start daemon
./scripts/install-launchd.sh

# Stop and uninstall daemon
./scripts/uninstall-launchd.sh
```

---

## Supported Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Health check and current model configuration |
| `/v1/responses` | `POST` | OpenAI Responses API format (SSE or JSON) |
| `/openai/v1/responses` | `POST` | OpenAI Responses alias |
| `/v1/chat/completions` | `POST` | Standard OpenAI Chat Completions format |
| `/openai/v1/chat/completions` | `POST` | Chat Completions alias |
| `/v1/models` | `GET` | Lists available models and aliases |
| `/openai/v1/models` | `GET` | Models list alias |

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8766` | Local HTTP port to bind |
| `HOST` | `127.0.0.1` | Local IP address to bind |
| `VERTEX_PROJECT` | `""` | Google Cloud Project ID |
| `VERTEX_LOCATION` | `global` | Vertex AI region (`global`, `us-central1`, etc.) |
| `VERTEX_MODEL` | `gemini-3.7-flash` | Default Gemini model |
| `VERTEX_FALLBACK_MODELS` | `gemini-3.5-flash,gemini-2.5-flash...` | Comma-separated list of fallback models |
| `GEMINI_API_KEY` | `""` | Optional direct Gemini API Key |
| `GCLOUD_BIN` | `gcloud` | Custom path to `gcloud` CLI executable |
| `DEBUG` | `false` | Enable verbose logging |

---

## Running Tests

```bash
npm test
```

---

## License

MIT
