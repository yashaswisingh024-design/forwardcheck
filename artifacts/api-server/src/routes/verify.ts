import { Router, type IRouter } from "express";
import { VerifyClaimBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface RawSerpResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string | { name?: string };
  date?: string;
}

interface ProcessedSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
  kind: "official" | "fact-check" | "news" | "web";
}

class VerificationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

function determineKind(url: string, engine?: string): ProcessedSource["kind"] {
  const lowerUrl = url.toLowerCase();

  if (
    lowerUrl.includes(".gov.in") ||
    lowerUrl.includes("pib.gov.in") ||
    lowerUrl.includes("mygov.in") ||
    lowerUrl.includes("india.gov.in") ||
    lowerUrl.includes("mohfw.gov.in") ||
    lowerUrl.includes("eci.gov.in")
  ) {
    return "official";
  }

  if (
    lowerUrl.includes("boomlive.in") ||
    lowerUrl.includes("altnews.in") ||
    lowerUrl.includes("factly.in") ||
    lowerUrl.includes("thequint.com/fact-check") ||
    lowerUrl.includes("factcheck") ||
    lowerUrl.includes("fact-check")
  ) {
    return "fact-check";
  }

  if (
    engine === "google_news" ||
    lowerUrl.includes("news") ||
    lowerUrl.includes("timesofindia") ||
    lowerUrl.includes("hindustantimes") ||
    lowerUrl.includes("indianexpress") ||
    lowerUrl.includes("ndtv")
  ) {
    return "news";
  }

  return "web";
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web Source";
  }
}

async function fetchSerpQuery(
  claim: string,
  apiKey: string,
  query: { engine: "google" | "google_news"; q: string },
): Promise<ProcessedSource[]> {
  try {
    logger.info({ engine: query.engine }, "[VERIFY] SerpApi search started");

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("engine", query.engine);
    url.searchParams.set("q", query.q);
    url.searchParams.set("gl", "in");
    url.searchParams.set("hl", "en");
    url.searchParams.set("num", "8");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url.toString(), { signal: controller.signal });

      if (!response.ok) {
        logger.warn(
          { status: response.status, engine: query.engine },
          "[VERIFY] SerpApi request returned non-OK status",
        );
        return [];
      }

      const data = (await response.json()) as {
        news_results?: RawSerpResult[];
        organic_results?: RawSerpResult[];
      };

      const rawList =
        query.engine === "google_news"
          ? data.news_results || []
          : data.organic_results || [];

      return rawList
        .filter((item) => Boolean(item.link))
        .map((item) => ({
          id: "",
          title: item.title || "Untitled Source",
          url: item.link as string,
          snippet: item.snippet || "",
          source:
            typeof item.source === "string"
              ? item.source
              : item.source?.name || extractDomain(item.link as string),
          date: item.date,
          kind: determineKind(item.link as string, query.engine),
        }));
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.warn(
      { err, engine: query.engine },
      "[VERIFY] SerpApi search failed; continuing with other evidence",
    );
    return [];
  }
}

async function fetchSerpApiResults(
  claim: string,
  apiKey: string,
): Promise<ProcessedSource[]> {
  const queries: Array<{ engine: "google" | "google_news"; q: string }> = [
    { engine: "google", q: claim },
    { engine: "google_news", q: claim },
    {
      engine: "google",
      q: `${claim} site:pib.gov.in OR site:mygov.in OR site:india.gov.in OR site:boomlive.in OR site:altnews.in OR site:factly.in OR site:thequint.com`,
    },
  ];

  // These are independent searches, so run them concurrently.
  const resultSets = await Promise.all(
    queries.map((query) => fetchSerpQuery(claim, apiKey, query)),
  );

  const sources: ProcessedSource[] = [];
  const seenUrls = new Set<string>();

  // Prioritize official and fact-check evidence, then news, then general web.
  const priority: Record<ProcessedSource["kind"], number> = {
    official: 0,
    "fact-check": 1,
    news: 2,
    web: 3,
  };

  for (const source of resultSets.flat().sort((a, b) => priority[a.kind] - priority[b.kind])) {
    const normalizedUrl = source.url.trim().replace(/#.*$/, "");
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;

    seenUrls.add(normalizedUrl);
    sources.push({ ...source, id: `S${sources.length + 1}` });

    // Keep the Gemini context deliberately small and high-signal.
    if (sources.length >= 12) break;
  }

  logger.info(
    { count: sources.length },
    "[VERIFY] SerpApi searches completed",
  );

  return sources;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiStatus(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status);
}

function buildEvidenceOnlyFallback(
  claim: string,
  sources: ProcessedSource[],
  language: string,
) {
  const factCheckSources = sources.filter((s) => s.kind === "fact-check");
  const officialSources = sources.filter((s) => s.kind === "official");
  const strongRefutation = [...factCheckSources, ...officialSources].filter((s) =>
    /\b(false|fake|fals(e|ified)|debunk|hoax|misleading|scam|fraud|incorrect|not true|no evidence|does not|cannot|denied|refuted|clarif)/i.test(
      `${s.title} ${s.snippet}`,
    ),
  );
  const strongSupport = [...officialSources, ...factCheckSources].filter((s) =>
    /\b(confirms?|confirmed|announced|official|eligible|available|valid|true|verified|approved|launched)/i.test(
      `${s.title} ${s.snippet}`,
    ),
  );

  let verdict: "Supported" | "Debunked" | "Mixed" | "Unverified" | "Insufficient Evidence" =
    "Insufficient Evidence";
  let summary = "Live evidence was retrieved, but the AI synthesis service was unavailable. ForwardCheck is not making a stronger claim than the evidence supports.";

  if (strongRefutation.length > 0 && strongSupport.length === 0) {
    verdict = "Debunked";
    summary = "Credible live sources contain signals that contradict this claim.";
  } else if (strongSupport.length > 0 && strongRefutation.length === 0) {
    verdict = "Supported";
    summary = "Credible live sources contain signals that support this claim.";
  } else if (strongSupport.length > 0 && strongRefutation.length > 0) {
    verdict = "Mixed";
    summary = "Live sources contain conflicting signals, so the evidence should be treated cautiously.";
  } else if (sources.length > 0) {
    verdict = "Unverified";
    summary = "Live sources were found, but they do not provide a strong enough signal to verify or debunk the claim.";
  }

  const relevant = [...strongRefutation, ...strongSupport].slice(0, 4);
  const why =
    relevant.length > 0
      ? relevant.map((s) => `${s.source}: ${s.snippet || s.title}`.slice(0, 240))
      : [
          sources.length
            ? `${sources.length} live sources were retrieved, but none provided a decisive verification signal.`
            : "No reliable live sources were retrieved.",
          "The AI synthesis service was unavailable, so ForwardCheck is deliberately avoiding an unsupported verdict.",
        ];

  const evidence = relevant.map((s) => ({
    sourceId: s.id,
    stance: strongRefutation.includes(s) ? "contradicts" as const : "supports" as const,
    point: s.snippet || s.title,
  }));

  const correction =
    language === "Hindi"
      ? `ForwardCheck update: “${claim}” को उपलब्ध live sources से निर्णायक रूप से verify नहीं किया जा सका। कृपया official sources देखें और बिना पुष्टि आगे forward न करें.`
      : language === "Marathi"
        ? `ForwardCheck अपडेट: “${claim}” हा दावा उपलब्ध live sources वरून निर्णायकपणे verify करता आला नाही. कृपया official sources तपासा आणि खात्री न झाल्यास पुढे forward करू नका.`
        : `ForwardCheck update: “${claim}” could not be conclusively verified from the available live sources. Please check the cited official/credible sources before forwarding.`;

  return {
    verdict,
    confidence: sources.length ? Math.min(60, 25 + sources.length * 3) : 10,
    summary,
    why,
    evidence,
    correction,
    analysisMode: "evidence-only-fallback" as const,
  };
}

async function requestGemini(
  modelNames: string[],
  body: string,
  geminiKey: string,
): Promise<Response> {
  // Keep verification responsive: try the configured model once, then
  // fall back to the lightweight stable model if Gemini is busy/slow.
  const models = [...new Set(modelNames.filter(Boolean))];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const modelName = models[modelIndex];
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    logger.info({ model: modelName }, "[VERIFY] Gemini request started");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body,
        signal: controller.signal,
      });

      logger.info(
        { model: modelName, status: response.status },
        "[VERIFY] Gemini response status",
      );

      if (response.ok) return response;

      if (response.status === 400) {
        throw new VerificationError(
          "The verification request was rejected. Please try a different claim.",
          400,
          "GEMINI_BAD_REQUEST",
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new VerificationError(
          "Verification service authentication is not configured correctly.",
          response.status,
          "GEMINI_AUTH",
        );
      }

      // A model can be unavailable/renamed. Fall through to the known lightweight
      // fallback rather than exposing a raw 404 to the user.
      if (response.status === 404 && modelIndex < models.length - 1) {
        logger.warn(
          { model: modelName },
          "[VERIFY] Gemini model unavailable; trying fallback model",
        );
        continue;
      }

      // Retry transient failures once on the same model, then move to the
      // next known-good fallback model. This absorbs brief 429/5xx capacity spikes.
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 12000);
        try {
          logger.warn(
            { model: modelName, status: response.status },
            "[VERIFY] Gemini transient failure; retrying once",
          );
          const retryResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiKey,
            },
            body,
            signal: retryController.signal,
          });

          logger.info(
            { model: modelName, status: retryResponse.status },
            "[VERIFY] Gemini retry response status",
          );

          if (retryResponse.ok) return retryResponse;
        } catch (retryErr) {
          logger.warn(
            { model: modelName, err: retryErr },
            "[VERIFY] Gemini retry failed",
          );
        } finally {
          clearTimeout(retryTimeout);
        }

        logger.warn(
          { model: modelName, status: response.status, hasFallback: modelIndex < models.length - 1 },
          "[VERIFY] Gemini still unavailable; trying fallback",
        );
        continue;
      }

      throw new VerificationError(
        "The AI verification service rejected the request. Please try again.",
        response.status,
        "GEMINI_UNAVAILABLE",
      );
    } catch (err) {
      if (err instanceof VerificationError) throw err;

      if (err instanceof Error && err.name === "AbortError") {
        logger.warn(
          { model: modelName, hasFallback: modelIndex < models.length - 1 },
          "[VERIFY] Gemini timed out",
        );
        continue;
      }

      logger.warn(
        { model: modelName, err, hasFallback: modelIndex < models.length - 1 },
        "[VERIFY] Gemini network error",
      );

      if (modelIndex === models.length - 1) {
        throw new VerificationError(
          "We couldn't reach the verification service. Please try again.",
          502,
          "GEMINI_NETWORK_ERROR",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new VerificationError(
    "Live verification is temporarily unavailable after multiple AI attempts. Please try again in a few seconds.",
    503,
    "GEMINI_UNAVAILABLE",
  );
}

async function callGemini(
  claim: string,
  language: string,
  sources: ProcessedSource[],
  geminiKey: string,
  modelName: string,
) {
  const sourcesText =
    sources.length > 0
      ? sources
          .map(
            (s) =>
              `[Source ${s.id}]\nTitle: ${s.title}\nKind: ${s.kind}\nSource: ${s.source}\nURL: ${s.url}\nDate: ${s.date || "N/A"}\nSnippet: ${s.snippet.slice(0, 700)}`,
          )
          .join("\n\n")
      : "No live web evidence could be retrieved for this claim.";

  const prompt = `You are ForwardCheck's evidence-based claim verification AI.
Language for response: ${language}

CLAIM TO VERIFY:
"${claim}"

RETRIEVED LIVE WEB EVIDENCE:
${sourcesText}

RULES:
1. Evaluate the claim strictly based ONLY on the supplied evidence.
2. Never invent facts, URLs, quotes, dates, statistics, or sources.
3. Prefer official government sources and reputable fact-check organizations over general web pages.
4. If evidence directly supports the claim, use "Supported".
5. If evidence directly contradicts/refutes the claim, use "Debunked".
6. If evidence conflicts, use "Mixed".
7. If evidence is sparse or insufficient, use "Unverified" or "Insufficient Evidence".
8. Do not expose chain-of-thought.
9. Keep the summary concise and consumer-friendly.
10. Give 2 to 4 concise reasons in "why".
11. Generate a safe WhatsApp-forwardable correction in the requested language.
12. "confidence" is evidence coverage/confidence from 0 to 100, NOT truth probability.

Return ONLY valid JSON:
{
  "verdict": "Supported" | "Debunked" | "Mixed" | "Unverified" | "Insufficient Evidence",
  "confidence": 85,
  "summary": "Clear concise explanation.",
  "why": ["Key point 1", "Key point 2"],
  "evidence": [
    {
      "sourceId": "S1",
      "stance": "supports" | "contradicts" | "context",
      "point": "Brief evidence relationship."
    }
  ],
  "correction": "WhatsApp-forwardable text..."
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          verdict: {
            type: "STRING",
            enum: ["Supported", "Debunked", "Mixed", "Unverified", "Insufficient Evidence"],
          },
          confidence: { type: "NUMBER" },
          summary: { type: "STRING" },
          why: { type: "ARRAY", items: { type: "STRING" } },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                sourceId: { type: "STRING" },
                stance: { type: "STRING", enum: ["supports", "contradicts", "context"] },
                point: { type: "STRING" },
              },
              required: ["sourceId", "stance", "point"],
            },
          },
          correction: { type: "STRING" },
        },
        required: ["verdict", "confidence", "summary", "why", "evidence", "correction"],
      },
    },
  });

  const response = await requestGemini(
    [modelName, "gemini-3.5-flash-lite", "gemini-3.6-flash"],
    body,
    geminiKey,
  );
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new VerificationError(
      "The AI verification service returned an empty response. Please try again.",
      502,
      "GEMINI_EMPTY_RESPONSE",
    );
  }

  const cleanedText = rawText
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleanedText);
  } catch {
    throw new VerificationError(
      "The AI verification service returned an invalid response. Please try again.",
      502,
      "GEMINI_INVALID_JSON",
    );
  }

  const validVerdicts = [
    "Supported",
    "Debunked",
    "Mixed",
    "Unverified",
    "Insufficient Evidence",
  ];

  if (!validVerdicts.includes(parsed.verdict)) {
    throw new VerificationError(
      "The AI verification service returned an invalid verdict. Please try again.",
      502,
      "GEMINI_INVALID_RESULT",
    );
  }

  if (
    typeof parsed.confidence !== "number" ||
    !Number.isFinite(parsed.confidence) ||
    !Array.isArray(parsed.why) ||
    parsed.why.length === 0 ||
    !Array.isArray(parsed.evidence) ||
    typeof parsed.summary !== "string" ||
    typeof parsed.correction !== "string"
  ) {
    throw new VerificationError(
      "The AI verification service returned incomplete verification data. Please try again.",
      502,
      "GEMINI_INCOMPLETE_RESULT",
    );
  }

  return {
    verdict: parsed.verdict,
    confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence))),
    summary: parsed.summary,
    why: parsed.why.slice(0, 4),
    evidence: parsed.evidence,
    correction: parsed.correction,
  };
}

router.post("/verify", async (req, res) => {
  const startedAt = Date.now();

  try {
    const parseResult = VerifyClaimBody.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid input. Claim must be between 8 and 1500 characters.",
        code: "INVALID_INPUT",
      });
    }

    const { claim, language } = parseResult.data;
    const trimmedClaim = claim.trim();

    if (trimmedClaim.length < 8 || trimmedClaim.length > 1500) {
      return res.status(400).json({
        error: "Claim must be between 8 and 1500 characters.",
        code: "INVALID_INPUT",
      });
    }

    const serpApiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    logger.info({ claimLength: trimmedClaim.length }, "[VERIFY] claim received");

    if (!serpApiKey) {
      return res.status(500).json({
        error: "Verification service is not configured correctly.",
        code: "SERPAPI_CONFIG",
      });
    }

    if (!geminiApiKey) {
      return res.status(500).json({
        error: "Verification service authentication is not configured correctly.",
        code: "GEMINI_CONFIG",
      });
    }

    let langLabel = "English";
    if (language === "hi" || language === "Hindi") langLabel = "Hindi";
    if (language === "mr" || language === "Marathi") langLabel = "Marathi";

    const sources = await fetchSerpApiResults(trimmedClaim, serpApiKey);
    logger.info({ count: sources.length }, "[VERIFY] evidence count");

    let evaluation;
    try {
      evaluation = await callGemini(
        trimmedClaim,
        langLabel,
        sources,
        geminiApiKey,
        geminiModel,
      );
    } catch (err) {
      if (
        err instanceof VerificationError &&
        ["GEMINI_UNAVAILABLE", "GEMINI_NETWORK_ERROR", "GEMINI_EMPTY_RESPONSE"].includes(err.code)
      ) {
        logger.warn(
          { code: err.code, status: err.statusCode, sourceCount: sources.length },
          "[VERIFY] Gemini unavailable; using conservative evidence-only fallback",
        );
        evaluation = buildEvidenceOnlyFallback(trimmedClaim, sources, langLabel);
      } else {
        throw err;
      }
    }

    logger.info(
      {
        elapsedMs: Date.now() - startedAt,
        model: geminiModel,
        analysisMode: evaluation.analysisMode || "gemini",
      },
      "[VERIFY] verification completed",
    );

    return res.json({
      ...evaluation,
      sources,
    });
  } catch (err) {
    if (err instanceof VerificationError) {
      logger.error(
        { code: err.code, status: err.statusCode, elapsedMs: Date.now() - startedAt },
        "[VERIFY] verification failed",
      );
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }

    logger.error(
      { err, elapsedMs: Date.now() - startedAt },
      "[VERIFY] unexpected verification error",
    );
    return res.status(500).json({
      error: "An unexpected verification error occurred. Please try again.",
      code: "VERIFY_UNEXPECTED",
    });
  }
});

export default router;
