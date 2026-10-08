import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  ExternalLink,
  FileCheck2,
  Globe2,
  LockKeyhole,
  MessageCircle,
  MessageSquareText,
  Newspaper,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

const queryClient = new QueryClient();

type Language = "English" | "Hindi" | "Marathi";
type Source = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
  kind: "official" | "fact-check" | "news" | "web";
};
type Evidence = {
  sourceId: string;
  stance: "supports" | "contradicts" | "context";
  point: string;
};
type VerifyResult = {
  verdict: "Supported" | "Debunked" | "Mixed" | "Unverified" | "Insufficient Evidence";
  confidence: number;
  summary: string;
  why: string[];
  evidence: Evidence[];
  correction: string;
  sources: Source[];
};

const examples = [
  { label: "Government grant", claim: "A message says every student can claim a guaranteed government grant by sharing their bank details." },
  { label: "Health claim", claim: "A forwarded post claims drinking warm water cures every viral infection overnight." },
  { label: "School closure", claim: "A viral message says schools across the country are closed tomorrow. Please share widely." },
  { label: "History fact", claim: "The national flag of India was adopted on 22 July 1947." },
];

const stages = [
  "Understanding the claim",
  "Searching the live web",
  "Checking recent news",
  "Checking official & fact-check sources",
  "Comparing evidence",
];

const verdictMeta: Record<VerifyResult["verdict"], { label: string; icon: typeof ShieldCheck }> = {
  Supported: { label: "Supported by available evidence", icon: ShieldCheck },
  Debunked: { label: "Evidence contradicts this claim", icon: X },
  Mixed: { label: "The evidence is mixed", icon: RotateCcw },
  Unverified: { label: "Not enough reliable evidence", icon: Search },
  "Insufficient Evidence": { label: "Insufficient evidence to conclude", icon: Search },
};

function Home() {
  const [claim, setClaim] = useState("");
  const [language, setLanguage] = useState<Language>("English");
  const [howOpen, setHowOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const evidenceBySource = useMemo(() => {
    const map = new Map<string, Evidence>();
    result?.evidence.forEach((item) => map.set(item.sourceId, item));
    return map;
  }, [result]);

  async function verify() {
    if (!claim.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError("");
    setCopied(false);
    setStage(0);

    const timer = window.setInterval(() => setStage((current) => (current + 1) % stages.length), 850);

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed.");
      setResult(data as VerifyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      window.clearInterval(timer);
      setLoading(false);
    }
  }

  async function copyCorrection() {
    if (!result) return;
    await navigator.clipboard.writeText(result.correction);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function shareWhatsApp() {
    if (!result) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(result.correction)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fc-page">
      <div className="fc-grid" aria-hidden="true" />
      <div className="fc-orbit fc-orbit-one" aria-hidden="true" />
      <div className="fc-orbit fc-orbit-two" aria-hidden="true" />
      <div className="fc-shell">
        <header className="fc-header">
          <div className="fc-brand">
            <span className="fc-brand-mark"><ShieldCheck size={15} /></span>
            <span className="fc-brand-name">Forward<span>Check</span></span>
          </div>
          <div className="fc-header-right">
            <span className="fc-live-dot"><span /> Live evidence</span>
            <button className="fc-how" type="button" onClick={() => setHowOpen(true)}>
              HOW IT WORKS <ChevronDown size={13} />
            </button>
          </div>
        </header>

        {howOpen && (
          <div className="fc-modal-backdrop" onClick={() => setHowOpen(false)}>
            <section className="fc-modal" onClick={(event) => event.stopPropagation()}>
              <button className="fc-modal-close" onClick={() => setHowOpen(false)} aria-label="Close"><X size={16} /></button>
              <div className="fc-modal-icon"><Sparkles size={18} /></div>
              <p className="fc-kicker">Evidence-first</p>
              <h2>A pause before the forward.</h2>
              <p>ForwardCheck searches current web and news results, prioritises official and reputable sources, then uses AI to compare the evidence. It does not invent citations or treat uncertainty as a fact.</p>
              <div className="fc-modal-steps">
                {["Search current evidence", "Compare credible sources", "Explain the result"].map((item, index) => (
                  <div key={item}><b>0{index + 1}</b><span>{item}</span></div>
                ))}
              </div>
            </section>
          </div>
        )}

        <main className="fc-main">
          {!result && !loading && (
            <>
              <div className="fc-hero">
                <div className="fc-eyebrow"><span /> A pause before the forward <span /></div>
                <h1>Stop. Search. <em>Verify.</em><br /><strong>Before You Forward.</strong></h1>
                <p>A message landed in your group chat. Check what the evidence says before you pass it on.</p>
              </div>

              <section className="fc-console">
                <div className="fc-console-head">
                  <label htmlFor="claim-input"><MessageSquareText size={15} /> What did you receive?</label>
                  <span><LockKeyhole size={12} /> Nothing is posted or shared</span>
                </div>
                <textarea
                  id="claim-input"
                  value={claim}
                  maxLength={1500}
                  onChange={(event) => setClaim(event.target.value)}
                  placeholder="Paste the forwarded message here..."
                />
                <div className="fc-console-meta"><span>A sentence is enough. Add context if you have it.</span><b>{claim.length.toLocaleString()} / 1,500</b></div>

                <div className="fc-console-row">
                  <div className="fc-languages" role="group" aria-label="Response language">
                    {(["English", "Hindi", "Marathi"] as Language[]).map((item) => (
                      <button key={item} type="button" aria-pressed={language === item} onClick={() => setLanguage(item)}>
                        {item === "Hindi" ? "हिन्दी" : item === "Marathi" ? "मराठी" : item}
                      </button>
                    ))}
                  </div>
                  <span className="fc-evidence-badge"><ShieldCheck size={12} /> Evidence-led</span>
                </div>

                <button className="fc-verify" type="button" onClick={verify} disabled={!claim.trim()}>
                  <span>VERIFY THIS CLAIM</span><ArrowRight size={17} />
                </button>

                <div className="fc-examples">
                  <span>Try an example</span>
                  {examples.map((item) => (
                    <button key={item.label} type="button" onClick={() => setClaim(item.claim)}>{item.label}</button>
                  ))}
                </div>
              </section>
            </>
          )}

          {loading && (
            <section className="fc-loading">
              <div className="fc-scan-ring"><Search size={26} /></div>
              <p className="fc-kicker">LIVE VERIFICATION</p>
              <h2>Following the evidence.</h2>
              <p className="fc-loading-claim">“{claim}”</p>
              <div className="fc-stage-list">
                {stages.map((item, index) => (
                  <div key={item} className={index === stage ? "active" : index < stage ? "done" : ""}>
                    <span>{index < stage ? <Check size={12} /> : index + 1}</span><b>{item}</b>
                  </div>
                ))}
              </div>
              <div className="fc-loading-foot"><span>SerpApi</span><span>→</span><span>Google Search</span><span>+</span><span>Google News</span><span>+</span><span>Official sources</span></div>
            </section>
          )}

          {result && !loading && (
            <section className="fc-results">
              <button className="fc-back" type="button" onClick={() => setResult(null)}><ArrowRight size={14} className="flip" /> Check another claim</button>

              <div className={`fc-verdict fc-verdict-${result.verdict.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="fc-verdict-icon">{(() => { const Icon = verdictMeta[result.verdict].icon; return <Icon size={24} />; })()}</div>
                <div>
                  <p className="fc-kicker">VERDICT</p>
                  <h1>{result.verdict}</h1>
                  <p>{verdictMeta[result.verdict].label}</p>
                </div>
                <div className="fc-score">
                  <div className="fc-score-ring" style={{ "--score": result.confidence } as CSSProperties}><strong>{result.confidence}</strong><span>%</span></div>
                  <small>evidence<br />coverage</small>
                </div>
              </div>

              <div className="fc-result-grid">
                <div className="fc-result-main">
                  <article className="fc-panel fc-summary">
                    <div className="fc-panel-label"><FileCheck2 size={14} /> What the evidence says</div>
                    <h2>{result.summary}</h2>
                    <div className="fc-why">
                      <h3>Why this verdict?</h3>
                      {result.why.map((item, index) => <div key={index}><Check size={13} /> <span>{item}</span></div>)}
                    </div>
                  </article>

                  <article className="fc-panel">
                    <div className="fc-panel-label"><Globe2 size={14} /> Evidence trail <span>{result.sources.length} sources</span></div>
                    <div className="fc-sources">
                      {result.sources.map((source) => {
                        const evidence = evidenceBySource.get(source.id);
                        return (
                          <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="fc-source">
                            <div className="fc-source-top">
                              <span className={`fc-source-kind fc-kind-${source.kind}`}>{source.kind.replace("-", " ")}</span>
                              {source.date && <span>{source.date}</span>}
                            </div>
                            <h3>{source.title}</h3>
                            <p>{source.snippet || "Open source to inspect the full context."}</p>
                            <div className="fc-source-bottom"><b>{source.source}</b><span>{evidence?.stance || "context"} <ExternalLink size={12} /></span></div>
                          </a>
                        );
                      })}
                    </div>
                  </article>
                </div>

                <aside className="fc-result-side">
                  <article className="fc-panel fc-correction">
                    <div className="fc-panel-label"><MessageCircle size={14} /> Shareable correction</div>
                    <p>{result.correction}</p>
                    <button type="button" onClick={copyCorrection}><Clipboard size={14} /> {copied ? "Copied" : "Copy correction"}</button>
                    <button type="button" className="fc-whatsapp" onClick={shareWhatsApp}><MessageCircle size={14} /> Share on WhatsApp</button>
                  </article>

                  <article className="fc-panel fc-method">
                    <div className="fc-panel-label"><Newspaper size={14} /> Search coverage</div>
                    <div><span>Google web</span><b>{result.sources.filter((s) => s.kind === "web" || s.kind === "official" || s.kind === "fact-check").length}</b></div>
                    <div><span>Google News</span><b>{result.sources.filter((s) => s.kind === "news").length}</b></div>
                    <div><span>Official / fact-check</span><b>{result.sources.filter((s) => s.kind === "official" || s.kind === "fact-check").length}</b></div>
                  </article>
                </aside>
              </div>
            </section>
          )}

          {error && !loading && (
            <div className="fc-error" role="alert">
              <div><b>Verification couldn't complete.</b><span>{error}</span></div>
              <button type="button" onClick={verify}>Try again</button>
            </div>
          )}
        </main>

        {!result && !loading && (
          <footer className="fc-footer">
            <span><b>ForwardCheck.</b> Evidence before forwarding.</span>
            <span>SerpApi × Gemini · Public-interest tool</span>
          </footer>
        )}
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

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
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
