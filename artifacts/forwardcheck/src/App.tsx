import { type ReactNode } from 'react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ArrowRight, Check, ChevronDown, LockKeyhole, MessageSquareText, Shield } from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Home() {
  const [claim, setClaim] = useState('');
  const [language, setLanguage] = useState('English');
  const [howOpen, setHowOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const maxLength = 1500;
  const examples = [
    { label: 'Student grant scam', claim: 'A message says every student can claim a guaranteed government grant by sharing their bank details.' },
    { label: 'Health myth', claim: 'A forwarded post claims drinking warm water cures every viral infection overnight.' },
    { label: 'Viral news', claim: 'A viral message says schools across the country are closed tomorrow. Please share widely.' },
    { label: 'A checkable fact', claim: 'The national flag of India was adopted on 22 July 1947.' },
  ];

  function updateClaim(value: string) {
    setClaim(value.slice(0, maxLength));
    setFeedback('');
  }

  return (
    <div className="fc-page">
      <div className="fc-shell">
        <header className="fc-header" data-testid="region-header">
          <div className="fc-brand" data-testid="brand-forwardcheck">
            <span className="fc-brand-mark" aria-hidden="true"><Check /></span>
            <span className="fc-brand-name">Forward<span>Check</span></span>
          </div>
          <nav className="fc-nav" aria-label="Main navigation">
            <span className="fc-nav-note" data-testid="text-evidence-note">Evidence, not instinct</span>
            <button
              type="button"
              className="fc-how"
              data-testid="button-how-it-works"
              aria-expanded={howOpen}
              aria-controls="how-it-works-note"
              onClick={() => setHowOpen((open) => !open)}
            >
              HOW IT WORKS <ChevronDown aria-hidden="true" />
            </button>
          </nav>
        </header>
        {howOpen && (
          <aside className="fc-popover" id="how-it-works-note" data-testid="panel-how-it-works">
            <h2>A pause before the forward</h2>
            <p>Bring a claim here, then check it against reliable evidence before you pass it on. ForwardCheck is a public-interest tool; no message is posted or shared.</p>
            <button type="button" className="fc-popover-close" data-testid="button-close-how-it-works" onClick={() => setHowOpen(false)}>Got it</button>
          </aside>
        )}
        <main className="fc-main">
          <p className="fc-eyebrow" data-testid="text-eyebrow">A pause before the forward</p>
          <h1 className="fc-headline" data-testid="text-hero-headline">
            <span className="fc-first-line">
              <span className="fc-word">Stop.</span>
              {' '}
              <span className="fc-word">Search.</span>
              {' '}
              <span className="fc-word">Verify.</span>
              <span className="fc-shield-pill" aria-hidden="true"><Shield /><Check /></span>
            </span>
            <span className="fc-second-line">Before You Forward.</span>
          </h1>
          <p className="fc-subtitle" data-testid="text-hero-subtitle">A message landed in your group chat. Let’s check what the evidence says.</p>

          <form
            className="fc-card"
            data-testid="form-claim-check"
            onSubmit={(event) => {
              event.preventDefault();
              if (claim.trim()) setFeedback('This preview does not connect to a verification service yet. Your message has not been checked.');
            }}
          >
            <div className="fc-card-top">
              <label className="fc-label" htmlFor="claim-input"><MessageSquareText aria-hidden="true" /> What did you receive?</label>
              <span className="fc-privacy" data-testid="text-privacy"><LockKeyhole aria-hidden="true" /> Nothing is posted or shared.</span>
            </div>
            <textarea
              id="claim-input"
              className="fc-textarea"
              data-testid="input-claim"
              value={claim}
              maxLength={maxLength}
              onChange={(event) => updateClaim(event.target.value)}
              placeholder="Paste the forwarded message here..."
              aria-describedby="claim-helper claim-count"
            />
            <div className="fc-input-meta">
              <span id="claim-helper" data-testid="text-input-helper">A sentence is enough. Add context if you have it.</span>
              <span className="fc-count" id="claim-count" data-testid="text-character-count">{claim.length.toLocaleString()} / 1,500</span>
            </div>
            <div className="fc-card-bottom">
              <div className="fc-languages" role="group" aria-label="Choose message language" data-testid="control-language">
                {['English', 'हिन्दी', 'मराठी'].map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="fc-language"
                    data-testid={`button-language-${item === 'English' ? 'english' : item === 'हिन्दी' ? 'hindi' : 'marathi'}`}
                    aria-pressed={language === item}
                    onClick={() => setLanguage(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <span className="fc-privacy fc-evidence-note">Evidence-led. Human-readable.</span>
            </div>
            <div className="fc-card-actions">
              <button className="fc-submit" data-testid="button-verify-claim" type="submit" disabled={!claim.trim()}>
                VERIFY THIS CLAIM <ArrowRight aria-hidden="true" />
              </button>
            </div>
            <div className="fc-examples" aria-label="Example messages">
              <span className="fc-example-label">Try a message</span>
              {examples.map((example, index) => (
                <button
                  key={example.label}
                  type="button"
                  className="fc-example"
                  data-testid={`button-example-${index + 1}`}
                  onClick={() => updateClaim(example.claim)}
                >
                  {example.label}
                </button>
              ))}
            </div>
            <p className="fc-feedback" role="status" aria-live="polite" data-testid="status-verification">{feedback}</p>
          </form>
          <footer className="fc-footer" data-testid="region-footer">
            <span><span className="fc-footer-brand">ForwardCheck.</span> Powered by evidence.</span>
            <span>Human-readable. Public-interest.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
