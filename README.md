# ForwardCheck

**Evidence-first verification for viral claims before you forward them.**

ForwardCheck is a hackathon-ready web app for checking WhatsApp forwards, social posts, rumours, and other claims against **live web evidence**. It combines **SerpApi** retrieval with **Gemini** evidence synthesis and presents a transparent verdict, source coverage, and a shareable correction.

VISIT NOW - https://forwardcheck.onrender.com/

## 🏆 Why ForwardCheck

ForwardCheck is built around one principle: **retrieve live evidence first, then use AI to explain it.**

Unlike a chatbot that answers from a static knowledge cutoff, ForwardCheck uses **SerpApi as its live evidence layer** and exposes the retrieved sources to the user.

### 🔎 SerpApi is the core retrieval engine

Every verification request can trigger multiple live SerpApi searches:

| SerpApi search | What it contributes |
|---|---|
| **Google Search** | Broad discovery of pages discussing the claim |
| **Google News** | Recent reporting and developing stories |
| **Official-domain searches** | Government and authoritative public sources |
| **Fact-check searches** | Published debunks, confirmations, and context |
| **India-focused targeting** | Better relevance for Indian public-interest claims |

ForwardCheck then **normalizes, deduplicates, classifies, and prioritizes** the retrieved results before sending the evidence set to Gemini.

> **SerpApi retrieves → ForwardCheck organizes → Gemini explains.**

That separation is a key trust feature: **Gemini is not treated as the source of truth.** It synthesizes the live evidence retrieved through SerpApi, while the user can inspect the underlying source cards.

### 🧠 Gemini is the synthesis layer

Gemini receives the claim plus retrieved evidence and returns structured JSON containing a verdict, confidence, explanation, evidence-to-source relationships, and a shareable correction.

It is explicitly instructed to avoid inventing sources, URLs, quotes, or evidence. If the evidence is weak or conflicting, ForwardCheck can return **Unverified**, **Insufficient Evidence**, or **Mixed**.

### 🛡️ Evidence-first fallback

If Gemini is temporarily unavailable after live sources have already been retrieved, ForwardCheck can switch to a conservative **evidence-only fallback**. The UI clearly labels this mode so users never confuse it with an AI synthesis.

---

## 🎯 The verification pipeline

**Claim → SerpApi live search → source normalization → source classification → Gemini synthesis → verdict + evidence → shareable correction**

1. User pastes a WhatsApp forward, social post, rumour, or public-interest claim.
2. ForwardCheck queries live evidence through SerpApi.
3. Results are combined across web, news, official, and fact-check searches.
4. Duplicate URLs are removed and sources are classified.
5. Gemini evaluates only the retrieved evidence.
6. The frontend shows the verdict, confidence, evidence, and source network.
7. The user can copy or share a responsible correction.

---

## 🏅 Why this is strong for the SerpApi India Hackathon

- **Real SerpApi usage:** SerpApi is not decorative; it powers the live evidence retrieval layer.
- **Clear public-interest use case:** misinformation spreads through WhatsApp and social media every day.
- **Evidence transparency:** users see the sources behind the verdict.
- **Freshness:** Google Search and Google News searches bring current evidence into each verification.
- **AI with guardrails:** Gemini synthesizes evidence instead of being asked to invent an answer.
- **Uncertainty by design:** the system can say Unverified rather than forcing a binary true/false.
- **Actionable output:** users get a correction they can immediately share.

### One-line pitch

> **ForwardCheck turns viral claims into verifiable evidence before they become forwards.**

---

## What it does

1. User pastes a claim or forwarded message.
2. The backend queries SerpApi using:
   - Google Search
   - Google News
   - targeted India-focused searches across official and fact-check domains
3. Sources are classified as official, fact-check, news, or general web evidence.
4. Gemini evaluates **only the retrieved evidence** and returns:
   - verdict: Supported / Debunked / Mixed / Unverified / Insufficient Evidence
   - evidence confidence
   - concise explanation
   - evidence-to-source relationships
   - WhatsApp-ready correction
5. The UI displays the live sources and lets the user copy or share the correction.

> ForwardCheck is evidence-based assistance, not an absolute-truth oracle. A verdict is only as strong as the available live evidence.

## Architecture

```
React + Vite
    |
    | POST /api/verify
    v
Express API
    |
    +--> SerpApi
    |     +--> Google Search
    |     +--> Google News
    |     +--> official/fact-check search
    |
    +--> Gemini
          +--> structured JSON verdict
          +--> evidence mapping
          +--> correction
```

The production service is a single Render web service: the Express server serves the built Vite frontend and exposes the API under `/api`.

## Project structure

- `artifacts/forwardcheck/` — React/Vite frontend
- `artifacts/api-server/` — Express production API
- `lib/api-zod/` — shared request/response validation
- `render.yaml` — Render deployment configuration
- `.github/workflows/ci.yml` — build, typecheck, and runtime smoke checks

## Environment variables

Required for live verification:

```env
SERPAPI_KEY=your_serpapi_key
GEMINI_API_KEY=your_gemini_api_key
```

Recommended production configuration:

```env
NODE_ENV=production
BASE_PATH=/
FRONTEND_DIST=artifacts/forwardcheck/dist/public
GEMINI_MODEL=gemini-3.5-flash-lite
```

**Never commit API keys to GitHub.** Configure them as Render environment variables.

## Local development

Prerequisites:

- Node.js 20+
- pnpm
- SerpApi key
- Gemini API key

Install:

```bash
pnpm install
```

Typecheck:

```bash
pnpm typecheck
```

Build:

```bash
pnpm --filter @workspace/forwardcheck build
pnpm --filter @workspace/api-server build
```

Run the production API:

```bash
pnpm --filter @workspace/api-server start
```

The server listens on `PORT` (default `5000`) and binds to `0.0.0.0`.

## API

### GET `/api/healthz`

Returns:

```json
{"status":"ok"}
```

### POST `/api/verify`

Request:

```json
{
  "claim": "A viral message claims every Indian student can get ₹50,000 by registering on a link.",
  "language": "en"
}
```

The endpoint validates the claim, retrieves live evidence, asks Gemini for structured analysis, validates the returned verdict, and returns the evidence sources.

## Reliability safeguards

- Parallel SerpApi retrieval so one failed search does not abort the whole verification.
- 12-second timeout per SerpApi search.
- Gemini request timeout with fallback models.
- One retry for transient Gemini 429/5xx failures before moving to a fallback.
- Gemini 3.x-compatible generation configuration with no deprecated sampling parameters.
- Structured JSON output validation.
- API errors always return JSON rather than Express HTML.
- Frontend rejects unexpected HTML/non-JSON API responses cleanly.
- No fabricated sources, URLs, quotes, or verdicts.
- If Gemini is temporarily unavailable, ForwardCheck switches to a **conservative evidence-only fallback**. It only uses strong signals present in retrieved source titles/snippets and can return Unverified/Insufficient Evidence rather than inventing certainty.
- The UI explicitly labels this fallback mode so it is never confused with an AI-generated synthesis.
- Secrets are read only from environment variables.

## Verification

Every push should pass:

```bash
pnpm typecheck
pnpm --filter @workspace/forwardcheck build
pnpm --filter @workspace/api-server build
```

CI also starts the production API and smoke-checks:

- `GET /api/healthz`
- `GET /` serving the built ForwardCheck frontend

Live SerpApi/Gemini verification requires valid secrets and is intentionally not executed in CI.

## Deployment

Render is configured as one Node web service.

- Build: install dependencies, build frontend, build API
- Start: `pnpm --filter @workspace/api-server start`
- Health check: `/api/healthz`
- Gemini model: `gemini-3.5-flash-lite`

After changing Render environment variables, redeploy the service so the running process receives the new values.

## Demo flow

For a strong hackathon demo:

1. Paste a realistic viral claim.
2. Show the live evidence scan.
3. Reveal the verdict.
4. Open the source cards and show official/fact-check evidence.
5. Copy the WhatsApp correction.
6. Explain the architecture: **SerpApi supplies live evidence; ForwardCheck organizes it; Gemini synthesizes only that evidence into a structured verdict.**

## Security / trust principles

ForwardCheck is designed around an evidence-first rule:

**Retrieve first → evaluate evidence → explain → share.**

The model is explicitly instructed not to invent evidence. When the retrieved evidence is insufficient or conflicting, the app can return **Unverified**, **Insufficient Evidence**, or **Mixed** instead of pretending certainty.
