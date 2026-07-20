"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, Globe2, Loader2, PlugZap, RefreshCw, ServerCrash, ShieldCheck, WifiOff } from "lucide-react";
import { Button, Card } from "@/components/ui";

interface HealthResponse {
  ok: boolean;
  message?: string;
  storage?: {
    mode?: string;
    mongoConfigured?: boolean;
    database?: string;
    uri?: string;
    lastError?: string | null;
  };
  integrations?: Record<string, boolean>;
}

type Tone = "good" | "warn" | "bad" | "muted";

interface Monitor {
  name: string;
  description: string;
  status: "Operational" | "Attention" | "Down" | "Not configured";
  tone: Tone;
  icon: typeof Activity;
  detail: string;
}

export function ServerStatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setChecking(true);
    setError("");
    const started = performance.now();
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const elapsed = Math.round(performance.now() - started);
      setLatency(elapsed);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message ?? `Health check failed with HTTP ${response.status}.`);
      setHealth(data);
      setLastChecked(new Date());
    } catch (err) {
      setHealth({ ok: false, message: err instanceof Error ? err.message : "Health check failed." });
      setError(err instanceof Error ? err.message : "Health check failed.");
      setLatency(null);
      setLastChecked(new Date());
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const monitors = useMemo(() => buildMonitors(health), [health]);
  const downCount = monitors.filter((monitor) => monitor.status === "Down").length;
  const attentionCount = monitors.filter((monitor) => monitor.status === "Attention" || monitor.status === "Not configured").length;
  const overallTone: Tone = downCount ? "bad" : attentionCount ? "warn" : "good";
  const overallLabel = downCount ? "Server down" : attentionCount ? "Needs attention" : "All systems operational";

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-normal text-teal">Operations</p>
          <h1 className="mt-2 text-3xl font-black text-ink sm:text-4xl">Server Status</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60 sm:text-base">Live uptime and dependency checks for the dashboard, report storage, and connected data services.</p>
        </div>
        <Button onClick={load} disabled={checking} className="bg-white text-ink ring-1 ring-black/10 hover:bg-gold/20">
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </header>

      <Card className={`mt-6 overflow-hidden ${overallBorderClass(overallTone)}`}>
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex items-start gap-4">
            <span className={`grid size-12 shrink-0 place-items-center rounded-lg ${statusClass(overallTone)}`}>
              {overallTone === "bad" ? <ServerCrash className="size-6" /> : overallTone === "warn" ? <AlertTriangle className="size-6" /> : <ShieldCheck className="size-6" />}
            </span>
            <div>
              <Badge label={overallLabel} tone={overallTone} />
              <h2 className="mt-3 text-2xl font-black text-ink">{health?.ok === false ? health.message ?? "Health endpoint is unavailable." : "Production services are being checked every 30 seconds."}</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-ink/58">{error || "Failures are surfaced as down incidents immediately when the health endpoint or required storage checks stop responding."}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric label="Response" value={latency === null ? "-" : `${latency} ms`} />
            <Metric label="Checks" value={String(monitors.length)} />
            <Metric label="Down" value={String(downCount)} tone={downCount ? "bad" : "good"} />
            <Metric label="Updated" value={lastChecked ? lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"} />
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <Activity className="size-5 text-teal" />
            <h2 className="text-lg font-black text-ink">Monitors</h2>
          </div>
          {loading ? (
            <div className="grid gap-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-black/5" />)}</div>
          ) : (
            <div className="grid gap-3">
              {monitors.map((monitor) => {
                const Icon = monitor.icon;
                return (
                  <div key={monitor.name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 bg-white/70 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${statusClass(monitor.tone)}`}><Icon className="size-5" /></span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-black text-ink">{monitor.name}</h3>
                        <p className="mt-1 text-xs font-medium leading-5 text-ink/56">{monitor.description}</p>
                        <p className="mt-1 truncate text-xs font-bold text-ink/42">{monitor.detail}</p>
                      </div>
                    </div>
                    <Badge label={monitor.status} tone={monitor.tone} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="grid gap-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <Clock3 className="size-5 text-teal" />
              <h2 className="text-lg font-black text-ink">Incident Timeline</h2>
            </div>
            <div className="grid gap-3">
              {downCount ? (
                monitors.filter((monitor) => monitor.status === "Down").map((monitor) => <Incident key={monitor.name} tone="bad" title={`${monitor.name} is down`} detail={monitor.detail} />)
              ) : attentionCount ? (
                monitors.filter((monitor) => monitor.status !== "Operational").map((monitor) => <Incident key={monitor.name} tone={monitor.tone} title={`${monitor.name} needs attention`} detail={monitor.detail} />)
              ) : (
                <Incident tone="good" title="No active incidents" detail="All live checks are currently passing." />
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <Database className="size-5 text-teal" />
              <h2 className="text-lg font-black text-ink">Storage Detail</h2>
            </div>
            <div className="grid gap-3 text-sm">
              <Info label="Mode" value={health?.storage?.mode ?? "-"} />
              <Info label="Database" value={health?.storage?.database ?? "-"} />
              <Info label="MongoDB" value={health?.storage?.mongoConfigured ? "Configured" : "Not configured"} />
              <Info label="Last error" value={health?.storage?.lastError ?? "None"} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function buildMonitors(health: HealthResponse | null): Monitor[] {
  if (!health) return [];
  const storageDown = health.ok === false;
  const storageMode = health.storage?.mode ?? "unknown";
  const storageAttention = !storageDown && (storageMode !== "mongodb" || Boolean(health.storage?.lastError));
  const integrations = health.integrations ?? {};

  return [
    {
      name: "Dashboard API",
      description: "Next.js health endpoint and server runtime.",
      status: health.ok ? "Operational" : "Down",
      tone: health.ok ? "good" : "bad",
      icon: health.ok ? Globe2 : WifiOff,
      detail: health.ok ? "GET /api/health returned successfully." : health.message ?? "Health endpoint failed."
    },
    {
      name: "Report Storage",
      description: "Persistence layer for audit reports and subscriptions.",
      status: storageDown ? "Down" : storageAttention ? "Attention" : "Operational",
      tone: storageDown ? "bad" : storageAttention ? "warn" : "good",
      icon: Database,
      detail: storageAttention ? `Running in ${storageMode} mode${health.storage?.lastError ? `: ${health.storage.lastError}` : "."}` : `Connected to ${health.storage?.database ?? "database"}.`
    },
    {
      name: "Google OAuth",
      description: "Search Console and Google Analytics connection flow.",
      status: integrations.googleOAuthConfigured ? "Operational" : "Not configured",
      tone: integrations.googleOAuthConfigured ? "good" : "muted",
      icon: PlugZap,
      detail: integrations.googleOAuthConfigured ? "Client ID, secret, and redirect URI are present." : "Missing one or more OAuth environment variables."
    },
    {
      name: "PageSpeed Insights",
      description: "Performance diagnostics used by SEO reports.",
      status: integrations.pageSpeedConfigured ? "Operational" : "Not configured",
      tone: integrations.pageSpeedConfigured ? "good" : "muted",
      icon: Activity,
      detail: integrations.pageSpeedConfigured ? "API key is configured." : "PAGESPEED_API_KEY or GOOGLE_API_KEY is missing."
    },
    {
      name: "Chrome UX Report",
      description: "Field performance data for Core Web Vitals.",
      status: integrations.cruxConfigured ? "Operational" : "Not configured",
      tone: integrations.cruxConfigured ? "good" : "muted",
      icon: CheckCircle2,
      detail: integrations.cruxConfigured ? "CrUX API access is configured." : "CRUX_API_KEY or GOOGLE_API_KEY is missing."
    }
  ];
}

function Metric({ label, value, tone = "muted" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white/70 p-3">
      <p className="text-xs font-black uppercase text-ink/38">{label}</p>
      <p className={`mt-2 text-xl font-black ${tone === "bad" ? "text-coral" : tone === "good" ? "text-teal" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  const className = tone === "good" ? "bg-teal/10 text-teal" : tone === "warn" ? "bg-gold text-ink" : tone === "bad" ? "bg-coral/10 text-coral" : "bg-black/5 text-ink/50";
  return <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-black ${className}`}>{label}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 border-t border-black/10 pt-3 first:border-t-0 first:pt-0"><span className="text-xs font-black uppercase text-ink/38">{label}</span><span className="break-words font-bold text-ink/72">{value}</span></div>;
}

function Incident({ title, detail, tone }: { title: string; detail: string; tone: Tone }) {
  return (
    <div className="flex gap-3 rounded-lg border border-black/10 bg-white/70 p-3">
      <span className={`mt-1 size-2.5 rounded-full ${tone === "bad" ? "bg-coral" : tone === "warn" ? "bg-[#D4AF37]" : tone === "good" ? "bg-teal" : "bg-black/25"}`} />
      <div>
        <p className="text-sm font-black text-ink">{title}</p>
        <p className="mt-1 text-xs font-medium leading-5 text-ink/56">{detail}</p>
      </div>
    </div>
  );
}

function statusClass(tone: Tone) {
  if (tone === "good") return "bg-teal/10 text-teal";
  if (tone === "warn") return "bg-gold text-ink";
  if (tone === "bad") return "bg-coral/10 text-coral";
  return "bg-black/5 text-ink/50";
}

function overallBorderClass(tone: Tone) {
  if (tone === "bad") return "border-coral/30";
  if (tone === "warn") return "border-[#E8D4A8]";
  if (tone === "good") return "border-teal/30";
  return "border-black/10";
}
