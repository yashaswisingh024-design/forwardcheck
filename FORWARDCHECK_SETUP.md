# ForwardCheck setup

## Required secrets

Configure these in Replit Secrets (or your deployment environment):

- `SERPAPI_KEY` — SerpApi API key
- `GEMINI_API_KEY` — Google AI Studio Gemini API key
- `GEMINI_MODEL` — optional; defaults to `gemini-3.6-flash`

## Run

From the repository root:

```bash
pnpm install
pnpm run typecheck
pnpm --filter @workspace/forwardcheck run build
pnpm --filter @workspace/api-server run typecheck
```

The frontend calls `POST /api/verify`.

## Verification behavior

ForwardCheck searches Google web, Google News, and targeted official/fact-check domains through SerpApi. Gemini evaluates only the returned evidence. It does not invent sources, and uncertainty is surfaced as Mixed, Unverified, or Insufficient Evidence when appropriate.

The displayed confidence value is evidence coverage, not a probability that the claim is true.
