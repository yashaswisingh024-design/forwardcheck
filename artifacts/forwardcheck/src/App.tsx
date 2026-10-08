import { type CSSProperties, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  Info,
  Loader2,
  MessageCircle,
  MessageSquare,
  Newspaper,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  AlertTriangle,
  Network,
} from "lucide-react";
import { motion } from "framer-motion";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

const queryClient = new QueryClient();

export type Language = "English" | "Hindi" | "Marathi";

export type SourceKind = "official" | "fact-check" | "news" | "web";

export type Source = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
  kind: SourceKind;
};

export type EvidenceItem = {
  sourceId: string;
  stance: "supports" | "contradicts" | "context";
  point: string;
};

export type VerifyResult = {
  verdict: "Supported" | "Debunked" | "Mixed" | "Unverified" | "Insufficient Evidence";
  confidence: number;
  summary: string;
  why: string[];
  evidence: EvidenceItem[];
  correction: string;
  sources: Source[];
  analysisMode?: "gemini" | "evidence-only-fallback";
};

const sampleClaims = [
  {
    label: "Government Student Grant",
    claim: "A viral WhatsApp message claims every Indian student can get ₹50,000 direct bank grant by registering on a link.",
  },
  {
    label: "Health / Medical Claim",
    claim: "A forwarded post claims drinking warm lemon water cures all viral infections overnight without medication.",
  },
  {
    label: "School Closure Rumor",
    claim: "A message says all schools and colleges in India will remain closed for the next two weeks due to emergency directive.",
  },
  {
    label: "Historical Fact",
    claim: "The National Flag of India was adopted by the Constituent Assembly on 22 July 1947.",
  },
];

const verificationStages = [
  "Understanding the claim",
  "Searching the live web",
  "Checking recent news",
  "Checking official sources",
  "Checking fact-check sources",
  "Comparing evidence",
];

const verdictConfig: Record<
  VerifyResult["verdict"],
  {
    label: string;
    sublabel: string;
    icon: typeof ShieldCheck;
    colorClass: string;
    badgeBg: string;
  }
> = {
  Supported: {
    label: "SUPPORTED",
    sublabel: "Available live web evidence strongly supports this claim.",
    icon: CheckCircle2,
    colorClass: "verdict-supported",
    badgeBg: "#e8f5e9",
  },
  Debunked: {
    label: "DEBUNKED",
    sublabel: "Official or credible evidence contradicts this claim.",
    icon: XCircle,
    colorClass: "verdict-debunked",
    badgeBg: "#ffebee",
  },
  Mixed: {
    label: "MIXED EVIDENCE",
    sublabel: "Retrieved evidence presents conflicting or partial reports.",
    icon: AlertTriangle,
    colorClass: "verdict-mixed",
    badgeBg: "#fff8e1",
  },
  Unverified: {
    label: "UNVERIFIED",
    sublabel: "Insufficient authoritative sources exist to confirm or refute.",
    icon: HelpCircle,
    colorClass: "verdict-unverified",
    badgeBg: "#f5f5f5",
  },
  "Insufficient Evidence": {
    label: "INSUFFICIENT EVIDENCE",
    sublabel: "Not enough reliable evidence was found on the live web.",
    icon: HelpCircle,
    colorClass: "verdict-unverified",
    badgeBg: "#f5f5f5",
  },
};

function Home() {
  const [claim, setClaim] = useState("");
  const [verificationClaim, setVerificationClaim] = useState("");
  const [language, setLanguage] = useState<Language>("English");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "official" | "fact-check" | "news">("all");

  const evidenceBySourceId = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    if (result?.evidence) {
      for (const item of result.evidence) {
        map.set(item.sourceId, item);
      }
    }
    return map;
  }, [result]);

  const filteredSources = useMemo(() => {
    if (!result?.sources) return [];
    if (activeTab === "all") return result.sources;
    return result.sources.filter((s) => s.kind === activeTab);
  }, [result, activeTab]);

  const networkCounts = useMemo(() => {
    if (!result?.sources) return { official: 0, news: 0, factCheck: 0, web: 0 };
    return {
      official: result.sources.filter((s) => s.kind === "official").length,
      news: result.sources.filter((s) => s.kind === "news").length,
      factCheck: result.sources.filter((s) => s.kind === "fact-check").length,
      web: result.sources.filter((s) => s.kind === "web").length,
    };
  }, [result]);

  const langCodeMap: Record<Language, string> = {
    English: "en",
    Hindi: "hi",
    Marathi: "mr",
  };

  async function handleVerify() {
    const trimmed = claim.trim();
    if (!trimmed || loading) return;

    if (trimmed.length < 8) {
      setError("Please enter a claim with at least 8 characters.");
      return;
    }

    setVerificationClaim(trimmed);
    setLoading(true);
    setResult(null);
    setError(null);
    setCopied(false);
    setCurrentStageIndex(0);

    const interval = window.setInterval(() => {
      setCurrentStageIndex((prev) => Math.min(prev + 1, verificationStages.length - 1));
    }, 700);

    try {
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 45000);

      let response: Response;
      try {
        response = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim: trimmed,
            language: langCodeMap[language],
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(requestTimeout);
      }

      const contentType = response.headers.get("content-type") || "";
      const responseText = await response.text();

      let data: any = null;
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error("The verification server returned invalid JSON. Please try again.");
        }
      } else {
        // Never expose the browser's raw JSON parser error when a proxy/server
        // accidentally returns HTML.
        throw new Error(
          `Verification API returned an unexpected response (HTTP ${response.status}). Please try again.`
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || `Verification failed (HTTP ${response.status}).`);
      }

      if (!data?.verdict || !Array.isArray(data?.sources)) {
        throw new Error("The verification server returned an incomplete result. Please try again.");
      }

      setResult(data as VerifyResult);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Verification is taking longer than expected. Please try again.");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Verification service experienced an error. Please try again."
        );
      }
    } finally {
      window.clearInterval(interval);
      setLoading(false);
    }
  }

  async function handleCopyCorrection() {
    if (!result?.correction) return;
    try {
      await navigator.clipboard.writeText(result.correction);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback copy
    }
  }

  function handleShareWhatsApp() {
    if (!result?.correction) return;
    const text = encodeURIComponent(result.correction);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fc-app-shell">
      {/* Background Orbits & Grid */}
      <div className="fc-bg-grid" aria-hidden="true" />
      <div className="fc-bg-orbit fc-orbit-1" aria-hidden="true" />
      <div className="fc-bg-orbit fc-orbit-2" aria-hidden="true" />

      <div className="fc-container">
        {/* Navigation Header */}
        <header className="fc-navbar">
          <div className="fc-brand-group">
            <div className="fc-logo-badge">
              <ShieldCheck size={18} className="fc-logo-icon" />
            </div>
            <div className="fc-brand-title">
              Forward<span className="fc-brand-accent">Check</span>
            </div>
          </div>

          <div className="fc-nav-actions">
            <div className="fc-lang-picker">
              {(["English", "Hindi", "Marathi"] as Language[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`fc-lang-btn ${language === lang ? "active" : ""}`}
                  onClick={() => setLanguage(lang)}
                >
                  {lang === "Hindi" ? "हिन्दी" : lang === "Marathi" ? "मराठी" : "EN"}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="fc-how-btn"
              onClick={() => setHowItWorksOpen(true)}
            >
              <Info size={14} />
              <span>How it works</span>
            </button>
          </div>
        </header>

        {/* How It Works Modal */}
        {howItWorksOpen && (
          <div
            className="fc-modal-overlay"
            onClick={() => setHowItWorksOpen(false)}
          >
            <div
              className="fc-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="fc-modal-close-btn"
                onClick={() => setHowItWorksOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>

              <div className="fc-modal-badge">
                <Sparkles size={16} />
                <span>Evidence-First Protocol</span>
              </div>

              <h2>How ForwardCheck Works</h2>
              <p className="fc-modal-desc">
                ForwardCheck performs real-time internet verification using live Google Search, Google News, official government domain registries, and India fact-check databases.
              </p>

              <div className="fc-modal-steps-list">
                <div className="fc-step-item">
                  <div className="fc-step-num">01</div>
                  <div className="fc-step-content">
                    <h4>Paste Viral Claim</h4>
                    <p>Enter any forwarded WhatsApp message, news rumor, or social media post.</p>
                  </div>
                </div>

                <div className="fc-step-item">
                  <div className="fc-step-num">02</div>
                  <div className="fc-step-content">
                    <h4>Live SerpApi Search</h4>
                    <p>We query live web evidence across official portals (.gov.in, PIB), news, and fact-check archives.</p>
                  </div>
                </div>

                <div className="fc-step-item">
                  <div className="fc-step-num">03</div>
                  <div className="fc-step-content">
                    <h4>AI Gemini Synthesis</h4>
                    <p>Gemini strictly evaluates only the retrieved evidence and surfaces consensus or conflicts.</p>
                  </div>
                </div>

                <div className="fc-step-item">
                  <div className="fc-step-num">04</div>
                  <div className="fc-step-content">
                    <h4>Shareable Correction</h4>
                    <p>Get a friendly, pre-formatted WhatsApp correction to post straight into group chats.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Body Area */}
        <main className="fc-main-content">
          {/* SEARCH CONSOLE STATE */}
          {!result && !loading && (
            <motion.div
              className="fc-hero-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              <motion.div
                className="fc-hero-signal fc-signal-search"
                initial={{ opacity: 0, x: -28, y: 14, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{ delay: 0.75, type: "spring", stiffness: 180, damping: 16 }}
              >
                <Search size={12} />
                <span>LIVE SEARCH</span>
              </motion.div>

              <motion.div
                className="fc-hero-signal fc-signal-official"
                initial={{ opacity: 0, x: 28, y: 14, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{ delay: 0.95, type: "spring", stiffness: 180, damping: 16 }}
              >
                <ShieldCheck size={12} />
                <span>OFFICIAL SOURCES</span>
              </motion.div>

              <motion.div
                className="fc-hero-tag"
                initial={{ opacity: 0, y: 18, scale: 0.88 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 180, damping: 17 }}
              >
                <span className="fc-dot-pulse" />
                <span>A pause before the forward</span>
              </motion.div>

              <motion.h1
                className="fc-hero-headline"
                initial={{ opacity: 0, scale: 0.78, y: 34, filter: "blur(12px)" }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.28, duration: 0.9, type: "spring", stiffness: 145, damping: 15 }}
              >
                <span className="fc-headline-line">
                  <motion.span
                    className="fc-headline-word"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.38, type: "spring", stiffness: 220, damping: 16 }}
                  >
                    Stop.
                  </motion.span>{" "}
                  <motion.span
                    className="fc-headline-word"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.48, type: "spring", stiffness: 220, damping: 16 }}
                  >
                    Search.
                  </motion.span>{" "}
                  <motion.span
                    className="fc-headline-word fc-accent-text"
                    initial={{ opacity: 0, y: 24, scale: 0.86 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.58, type: "spring", stiffness: 220, damping: 14 }}
                  >
                    Verify.
                  </motion.span>
                </span>
                <span className="fc-headline-line fc-headline-line-second">
                  <motion.span
                    className="fc-headline-word"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.68, type: "spring", stiffness: 190, damping: 16 }}
                  >
                    Before You Forward.
                  </motion.span>
                </span>
              </motion.h1>

              <motion.div
                className="fc-hero-glow"
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 0.9, scale: 1 }}
                transition={{ delay: 0.35, duration: 1.1, ease: "easeOut" }}
              />

              <motion.p
                className="fc-hero-subtext"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.82, duration: 0.55, ease: "easeOut" }}
              >
                Check viral WhatsApp messages and social media claims against live official government sources, press bureaus, and verified fact-checkers.
              </motion.p>

              {/* Console Input Card */}
              <motion.div
                className="fc-console-card"
                initial={{ opacity: 0, y: 42, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 1.0, duration: 0.65, type: "spring", stiffness: 130, damping: 18 }}
              >
                <div className="fc-console-header">
                  <div className="fc-console-title">
                    <MessageSquare size={16} className="fc-icon-green" />
                    <span>Paste forwarded text or claim</span>
                  </div>
                  <div className="fc-console-limit">
                    {claim.length} / 1,500
                  </div>
                </div>

                <textarea
                  className="fc-claim-textarea"
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                  maxLength={1500}
                  placeholder="Paste a viral WhatsApp message, social post, or claim here..."
                  rows={4}
                />

                <div className="fc-console-footer">
                  <div className="fc-console-lang-picker">
                    <span className="fc-lang-label">Response language:</span>
                    {(["English", "Hindi", "Marathi"] as Language[]).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`fc-lang-chip ${language === lang ? "active" : ""}`}
                        onClick={() => setLanguage(lang)}
                      >
                        {lang === "Hindi" ? "हिन्दी" : lang === "Marathi" ? "मराठी" : lang}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="fc-verify-btn"
                    onClick={handleVerify}
                    disabled={!claim.trim() || claim.trim().length < 8}
                  >
                    <span>Verify with live evidence</span>
                    <ArrowRight size={16} />
                  </button>
                </div>

                {/* Example Claims */}
                <div className="fc-examples-group">
                  <span className="fc-examples-label">Try an example:</span>
                  <div className="fc-examples-chips">
                    {sampleClaims.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className="fc-example-chip"
                        onClick={() => setClaim(item.claim)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* LOADING VERIFICATION STAGE */}
          {loading && (
            <div className="fc-loading-section">
              <div className="fc-loader-ring">
                <Loader2 size={32} className="fc-spinner-icon" />
              </div>

              <div className="fc-loading-tag font-mono">LIVE EVIDENTIAL SCAN</div>
              <h2 className="fc-loading-title">Verifying against live web...</h2>

              <div className="fc-loading-claim-quote">
                “{verificationClaim}”
              </div>

              <div className="fc-stages-timeline">
                {verificationStages.map((stageText, idx) => {
                  const isDone = idx < currentStageIndex;
                  const isActive = idx === currentStageIndex;
                  return (
                    <div
                      key={stageText}
                      className={`fc-timeline-step ${isActive ? "active" : isDone ? "done" : ""}`}
                    >
                      <div className="fc-step-indicator">
                        {isDone ? (
                          <Check size={12} />
                        ) : (
                          <span>{idx + 1}</span>
                        )}
                      </div>
                      <span className="fc-step-label">{stageText}</span>
                    </div>
                  );
                })}
              </div>

              <div className="fc-loading-source-badges">
                <span>SerpApi</span>
                <span>•</span>
                <span>Google Search</span>
                <span>•</span>
                <span>Google News</span>
                <span>•</span>
                <span>PIB & .gov.in</span>
              </div>
            </div>
          )}

          {/* RESULTS STATE */}
          {result && !loading && (
            <div className="fc-results-section">
              <button
                type="button"
                className="fc-back-btn"
                onClick={() => setResult(null)}
              >
                <RotateCcw size={14} />
                <span>Verify another claim</span>
              </button>

              {/* Main Verdict Card */}
              {(() => {
                const config = verdictConfig[result.verdict] || verdictConfig["Unverified"];
                const VerdictIcon = config.icon;
                return (
                  <div className={`fc-verdict-banner ${config.colorClass}`}>
                    <div className="fc-verdict-left">
                      <div className="fc-verdict-icon-box">
                        <VerdictIcon size={28} />
                      </div>
                      <div>
                        <div className="fc-verdict-eyebrow">VERDICT</div>
                        <h1 className="fc-verdict-heading">{config.label}</h1>
                        <p className="fc-verdict-sublabel">{config.sublabel}</p>
                      </div>
                    </div>

                    <div className="fc-verdict-right">
                      <div className="fc-confidence-meter">
                        <svg className="fc-meter-svg" viewBox="0 0 36 36">
                          <path
                            className="fc-meter-bg"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="fc-meter-fill"
                            strokeDasharray={`${result.confidence}, 100`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="fc-meter-val">
                          <span>{result.confidence}%</span>
                        </div>
                      </div>
                      <div className="fc-meter-caption">
                        Evidence<br />Confidence
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Results Grid */}
              <div className="fc-results-grid">
                {/* Left Column: Summary & Evidence */}
                <div className="fc-results-left">
                  {/* Summary Card */}
                  <div className="fc-card fc-summary-card">
                    <div className="fc-card-label">
                      <FileText size={15} />
                      <span>Summary Explanation</span>
                    </div>
                    <p className="fc-summary-text">{result.summary}</p>
                    {result.analysisMode === "evidence-only-fallback" && (
                      <div className="fc-fallback-note">
                        <Info size={14} />
                        <span>AI synthesis is temporarily unavailable. This conservative result is based only on signals found in the retrieved live sources.</span>
                      </div>
                    )}

                    <div className="fc-why-section">
                      <h3>Why this verdict?</h3>
                      <ul className="fc-why-list">
                        {result.why.map((reason, i) => (
                          <li key={i}>
                            <ChevronRight size={14} className="fc-icon-green" />
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Evidence Network Card */}
                  <div className="fc-card fc-network-card">
                    <div className="fc-card-label">
                      <Network size={15} />
                      <span>Evidence Source Coverage</span>
                    </div>

                    <div className="fc-network-grid">
                      <div className="fc-network-stat">
                        <span className="fc-stat-num">{networkCounts.official}</span>
                        <span className="fc-stat-name">Official (.gov.in)</span>
                      </div>
                      <div className="fc-network-stat">
                        <span className="fc-stat-num">{networkCounts.factCheck}</span>
                        <span className="fc-stat-name">Fact-Checkers</span>
                      </div>
                      <div className="fc-network-stat">
                        <span className="fc-stat-num">{networkCounts.news}</span>
                        <span className="fc-stat-name">News Outlets</span>
                      </div>
                      <div className="fc-network-stat">
                        <span className="fc-stat-num">{networkCounts.web}</span>
                        <span className="fc-stat-name">General Web</span>
                      </div>
                    </div>
                  </div>

                  {/* Sources List Card */}
                  <div className="fc-card fc-sources-card">
                    <div className="fc-sources-header">
                      <div className="fc-card-label">
                        <Globe size={15} />
                        <span>Retrieved Sources ({result.sources.length})</span>
                      </div>

                      {/* Source Filters */}
                      <div className="fc-source-filter-tabs">
                        <button
                          type="button"
                          className={`fc-filter-btn ${activeTab === "all" ? "active" : ""}`}
                          onClick={() => setActiveTab("all")}
                        >
                          All ({result.sources.length})
                        </button>
                        <button
                          type="button"
                          className={`fc-filter-btn ${activeTab === "official" ? "active" : ""}`}
                          onClick={() => setActiveTab("official")}
                        >
                          Official ({networkCounts.official})
                        </button>
                        <button
                          type="button"
                          className={`fc-filter-btn ${activeTab === "fact-check" ? "active" : ""}`}
                          onClick={() => setActiveTab("fact-check")}
                        >
                          Fact-Check ({networkCounts.factCheck})
                        </button>
                        <button
                          type="button"
                          className={`fc-filter-btn ${activeTab === "news" ? "active" : ""}`}
                          onClick={() => setActiveTab("news")}
                        >
                          News ({networkCounts.news})
                        </button>
                      </div>
                    </div>

                    {filteredSources.length === 0 ? (
                      <div className="fc-empty-sources">
                        No sources found matching this filter.
                      </div>
                    ) : (
                      <div className="fc-sources-list">
                        {filteredSources.map((source) => {
                          const evidenceItem = evidenceBySourceId.get(source.id);
                          const stance = evidenceItem?.stance || "context";

                          return (
                            <a
                              key={source.id}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="fc-source-item"
                            >
                              <div className="fc-source-item-head">
                                <div className="fc-source-tags">
                                  <span className={`fc-kind-badge fc-kind-${source.kind}`}>
                                    {source.kind.replace("-", " ")}
                                  </span>
                                  <span className={`fc-stance-badge fc-stance-${stance}`}>
                                    {stance}
                                  </span>
                                </div>
                                {source.date && (
                                  <span className="fc-source-date">{source.date}</span>
                                )}
                              </div>

                              <h4 className="fc-source-title">{source.title}</h4>
                              <p className="fc-source-snippet">
                                {source.snippet || "Click to inspect the full source context."}
                              </p>

                              <div className="fc-source-foot">
                                <span className="fc-source-domain">{source.source}</span>
                                <span className="fc-source-link-action">
                                  <span>Open link</span>
                                  <ExternalLink size={12} />
                                </span>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Shareable Correction */}
                <div className="fc-results-right">
                  <div className="fc-card fc-correction-card">
                    <div className="fc-correction-header">
                      <MessageCircle size={18} />
                      <span>Shareable Correction</span>
                    </div>

                    <p className="fc-correction-subtext">
                      Copy this polite, verified response to paste into WhatsApp group chats:
                    </p>

                    <div className="fc-correction-box font-sans">
                      {result.correction}
                    </div>

                    <div className="fc-correction-actions">
                      <button
                        type="button"
                        className="fc-btn-copy"
                        onClick={handleCopyCorrection}
                      >
                        <Copy size={14} />
                        <span>{copied ? "Copied!" : "Copy Correction"}</span>
                      </button>

                      <button
                        type="button"
                        className="fc-btn-whatsapp"
                        onClick={handleShareWhatsApp}
                      >
                        <MessageCircle size={14} />
                        <span>Share on WhatsApp</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ERROR STATE */}
          {error && !loading && (
            <div className="fc-error-card">
              <AlertTriangle size={20} className="fc-error-icon" />
              <div className="fc-error-text">
                <strong>Verification Failed</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="fc-error-retry-btn"
                onClick={handleVerify}
              >
                Try Again
              </button>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="fc-footer font-sans">
          <div className="fc-footer-disclaimer">
            ForwardCheck uses live internet evidence. Results depend on available sources and should be treated as evidence-based assistance, not absolute truth.
          </div>
          <div className="fc-footer-copyright">
            © {new Date().getFullYear()} ForwardCheck • Evidence-First Verification Platform
          </div>
        </footer>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
