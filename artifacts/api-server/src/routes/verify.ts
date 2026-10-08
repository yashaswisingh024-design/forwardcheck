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

function determineKind(url: string, engine?: string): "official" | "fact-check" | "news" | "web" {
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
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Web Source";
  }
}

async function fetchSerpApiResults(claim: string, apiKey: string): Promise<ProcessedSource[]> {
  const sources: ProcessedSource[] = [];
  const seenUrls = new Set<string>();

  const queries = [
    { engine: "google", q: claim },
    { engine: "google_news", q: claim },
    {
      engine: "google",
      q: `${claim} site:pib.gov.in OR site:mygov.in OR site:boomlive.in OR site:altnews.in OR site:factly.in OR site:thequint.com`,
    },
  ];

  for (const query of queries) {
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("engine", query.engine);
      url.searchParams.set("q", query.q);
      url.searchParams.set("gl", "in");
      url.searchParams.set("hl", "en");

      const response = await fetch(url.toString());
      if (!response.ok) {
        logger.warn({ status: response.status, engine: query.engine }, "SerpApi request returned non-OK status");
        continue;
      }

      const data = (await response.json()) as { news_results?: RawSerpResult[]; organic_results?: RawSerpResult[] };
      const rawList: RawSerpResult[] = query.engine === "google_news"
        ? (data.news_results || [])
        : (data.organic_results || []);

      for (const item of rawList) {
        if (!item.link || seenUrls.has(item.link)) continue;
        seenUrls.add(item.link);

        let sourceName = "Web Source";
        if (typeof item.source === "string") {
          sourceName = item.source;
        } else if (item.source && typeof item.source === "object" && item.source.name) {
          sourceName = item.source.name;
        } else {
          sourceName = extractDomain(item.link);
        }

        sources.push({
          id: `S${sources.length + 1}`,
          title: item.title || "Untitled Source",
          url: item.link,
          snippet: item.snippet || "",
          source: sourceName,
          date: item.date,
          kind: determineKind(item.link, query.engine),
        });

        if (sources.length >= 20) break;
      }
    } catch (err) {
      logger.error({ err, engine: query.engine }, "Error calling SerpApi");
    }

    if (sources.length >= 20) break;
  }

  return sources;
}

async function callGemini(
  claim: string,
  language: string,
  sources: ProcessedSource[],
  geminiKey: string,
  modelName: string
) {
  const sourcesText = sources.length > 0
    ? sources
        .map(
          (s) =>
            `[Source ${s.id}]\nTitle: ${s.title}\nKind: ${s.kind}\nSource: ${s.source}\nURL: ${s.url}\nDate: ${s.date || "N/A"}\nSnippet: ${s.snippet}\n`
        )
        .join("\n")
    : "No live web evidence could be retrieved for this claim.";

  const prompt = `You are ForwardCheck's evidence-based claim verification AI.
Language for response: ${language}

CLAIM TO VERIFY:
"${claim}"

RETRIEVED LIVE WEB EVIDENCE:
${sourcesText}

RULES & INSTRUCTIONS:
1. Evaluate the claim strictly based ONLY on the supplied evidence.
2. Do not invent facts, URLs, quotes, dates, or statistics.
3. Official government sources (.gov.in, PIB) receive highest authority weight. Fact-check organizations (BOOM Live, Alt News, Factly) provide strong verification context.
4. If the evidence directly supports the claim, output verdict "Supported".
5. If the evidence directly contradicts or refutes the claim, output verdict "Debunked".
6. If the evidence is contradictory or inconclusive, output verdict "Mixed".
7. If evidence is sparse, missing, or insufficient to draw a firm conclusion, output verdict "Unverified" or "Insufficient Evidence".
8. Do NOT expose chain-of-thought or reasoning steps in the output.
9. Provide a clear, concise summary explaining the verdict for a general consumer audience.
10. Provide 2 to 4 key bullet points in the "why" field.
11. Generate a polite, safe, WhatsApp-forwardable correction text in the requested language (${language}). It should clearly state whether the claim is true/false/unverified and give brief rationale so users can share it in group chats.
12. "confidence" must be an integer between 0 and 100 representing evidence coverage and confidence (NOT truth probability).

Respond ONLY with strict JSON in this exact structure:
{
  "verdict": "Supported" | "Debunked" | "Mixed" | "Unverified" | "Insufficient Evidence",
  "confidence": 85,
  "summary": "Clear concise explanation of the verdict.",
  "why": ["Key point 1", "Key point 2"],
  "evidence": [
    {
      "sourceId": "S1",
      "stance": "supports" | "contradicts" | "context",
      "point": "Brief explanation of how this source relates to the claim."
    }
  ],
  "correction": "WhatsApp-forwardable text..."
}`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error({ status: response.status, body: errText }, "Gemini API error");
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error("Gemini API returned an empty response.");
  }

  // Clean potential markdown backticks
  const cleanedText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleanedText);

  // Fallback defaults for safety
  const validVerdicts = ["Supported", "Debunked", "Mixed", "Unverified", "Insufficient Evidence"];
  const verdict = validVerdicts.includes(parsed.verdict) ? parsed.verdict : "Unverified";
  const confidence = typeof parsed.confidence === "number" ? Math.min(100, Math.max(0, Math.round(parsed.confidence))) : 50;

  return {
    verdict,
    confidence,
    summary: parsed.summary || "Verification complete based on available evidence.",
    why: Array.isArray(parsed.why) && parsed.why.length > 0 ? parsed.why : ["Evidence evaluation completed."],
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    correction: parsed.correction || `*ForwardCheck Verification*\n\nClaim: ${claim}\nVerdict: ${verdict}\n\nPlease check verified sources before forwarding.`,
  };
}

router.post("/verify", async (req, res) => {
  try {
    const parseResult = VerifyClaimBody.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid input. Claim must be between 8 and 1500 characters.",
      });
    }

    const { claim, language } = parseResult.data;
    const trimmedClaim = claim.trim();

    if (trimmedClaim.length < 8 || trimmedClaim.length > 1500) {
      return res.status(400).json({
        error: "Claim must be between 8 and 1500 characters.",
      });
    }

    const serpApiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";

    if (!serpApiKey) {
      return res.status(500).json({
        error: "Backend configuration error: SERPAPI_KEY is not set. Please configure the SerpApi API key in environment variables.",
      });
    }

    if (!geminiApiKey) {
      return res.status(500).json({
        error: "Backend configuration error: GEMINI_API_KEY is not set. Please configure the Gemini API key in environment variables.",
      });
    }

    // Map language
    let langLabel = "English";
    if (language === "hi" || language === "Hindi") langLabel = "Hindi";
    if (language === "mr" || language === "Marathi") langLabel = "Marathi";

    // 1. Fetch live evidence using SerpApi
    const sources = await fetchSerpApiResults(trimmedClaim, serpApiKey);

    // 2. Evaluate with Gemini
    const evaluation = await callGemini(trimmedClaim, langLabel, sources, geminiApiKey, geminiModel);

    // 3. Return structured response
    return res.json({
      ...evaluation,
      sources,
    });
  } catch (err) {
    logger.error({ err }, "Error processing verification request");
    return res.status(500).json({
      error: err instanceof Error ? err.message : "An unexpected server error occurred during verification.",
    });
  }
});

export default router;
