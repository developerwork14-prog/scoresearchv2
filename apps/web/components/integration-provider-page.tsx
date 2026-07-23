"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, CheckCircle2, Download, ExternalLink, Loader2, Plug, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import type { CombinedInsight, DashboardTableRow, ExternalProperty, IntegrationProvider, PerformanceDashboard, PublicIntegrationConnection, SyncLog } from "@/lib/server/integrations/types";

const providers: Record<IntegrationProvider, { name: string; description: string; logo: string; color: string }> = {
  GOOGLE_SEARCH_CONSOLE: {
    name: "Google Search Console",
    description: "Sync search queries, pages, countries, devices, clicks, impressions, CTR, and ranking positions.",
    logo: "G",
    color: "bg-[#EAF2FF] text-[#174EA6]"
  },
  GOOGLE_ANALYTICS: {
    name: "Google Analytics",
    description: "Import GA4 organic traffic, engagement, landing page, device, geography, and conversion metrics.",
    logo: "A",
    color: "bg-[#FFF3E0] text-[#C26401]"
  },
  BING_WEBMASTER: {
    name: "Bing Webmaster Tools",
    description: "Connect per-user Microsoft authorization for Bing search performance and supported crawl data.",
    logo: "B",
    color: "bg-[#E7F8F2] text-[#00785F]"
  }
};

interface IntegrationsResponse {
  connections: PublicIntegrationConnection[];
}

export function IntegrationOverview() {
  const [connections, setConnections] = useState<PublicIntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load integrations.")))
      .then((data: IntegrationsResponse) => setConnections(data.connections))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load integrations."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Header title="Connection Settings" description="Manage provider connections for the active project." />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {(Object.keys(providers) as IntegrationProvider[]).map((provider) => (
          <ProviderCard key={provider} provider={provider} connection={connections.find((item) => item.provider === provider)} loading={loading} />
        ))}
      </div>
    </div>
  );
}

export function IntegrationProviderPage({ provider }: { provider: IntegrationProvider }) {
  const [connection, setConnection] = useState<PublicIntegrationConnection | undefined>();
  const [properties, setProperties] = useState<ExternalProperty[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const providerMeta = providers[provider];

  const refresh = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const integrations = await fetch("/api/integrations", { cache: "no-store" }).then((response) => response.json()) as IntegrationsResponse;
      const nextConnection = integrations.connections.find((item) => item.provider === provider);
      setConnection(nextConnection);
      if (nextConnection) {
        const [propsData, logsData] = await Promise.all([
          fetch(`/api/integrations/${provider}/properties`, { cache: "no-store" }).then((response) => response.ok ? response.json() : { properties: [] }),
          fetch(`/api/integrations/${provider}/sync-logs`, { cache: "no-store" }).then((response) => response.ok ? response.json() : { logs: [] })
        ]);
        setProperties(propsData.properties ?? []);
        setLogs(logsData.logs ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load provider.");
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function post(path: string, body?: unknown) {
    setWorking(path);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Request failed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setWorking("");
    }
  }

  async function disconnect(deleteData: boolean) {
    setWorking("disconnect");
    setError("");
    try {
      const response = await fetch(`/api/integrations/${provider}?deleteData=${deleteData ? "1" : "0"}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Disconnect failed.");
      setConnection(undefined);
      setProperties([]);
      setLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setWorking("");
    }
  }

  const selected = properties.find((property) => property.id === selectedProperty);

  return (
    <div>
      <Header title={providerMeta.name} description={providerMeta.description} />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ProviderCard provider={provider} connection={connection} loading={loading} detailed onSync={() => post(`/api/integrations/${provider}/sync`)} onDisconnect={() => disconnect(false)} />
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <Plug className="size-5 text-teal" />
            <h2 className="text-lg font-black text-ink">Property mapping</h2>
          </div>
          {!connection ? (
            <EmptyState text="Connect the provider before selecting a property." />
          ) : properties.length ? (
            <div className="grid gap-3">
              <select className="min-h-12 rounded-md border border-black/10 bg-white px-3 text-sm font-bold" value={selectedProperty} onChange={(event) => setSelectedProperty(event.target.value)}>
                <option value="">Select property</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
              <Button disabled={!selectedProperty || Boolean(working)} onClick={() => post(`/api/integrations/${provider}/select-property`, { propertyId: selectedProperty, propertyName: selected?.name, accountId: selected?.accountId, syncNow: true })}>
                {working.includes("select-property") ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Save and sync 90 days
              </Button>
            </div>
          ) : (
            <EmptyState text={provider === "BING_WEBMASTER" ? "No Bing sites were returned. Confirm the configured Bing API surface supports site listing." : "No properties were returned for this account."} />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <RefreshCw className="size-5 text-teal" />
            <h2 className="text-lg font-black text-ink">Sync logs</h2>
          </div>
          {logs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs font-black uppercase text-ink/40">
                  <tr><th className="py-2">Started</th><th>Status</th><th>Rows</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-black/10">
                      <td className="py-3 font-bold">{new Date(log.startedAt).toLocaleString()}</td>
                      <td>{log.status}</td>
                      <td>{log.importedRows}</td>
                      <td className="max-w-sm truncate text-coral">{log.error ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState text="No syncs have run yet." />}
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <ShieldAlert className="size-5 text-coral" />
            <h2 className="text-lg font-black text-ink">Disconnect policy</h2>
          </div>
          <p className="text-sm leading-6 text-ink/60">Disconnect removes encrypted tokens. You can keep imported reports for historical analysis or delete imported provider rows.</p>
          <div className="mt-4 grid gap-2">
            <Button disabled={!connection || Boolean(working)} className="bg-white text-ink ring-1 ring-black/10 hover:bg-gold/20" onClick={() => disconnect(false)}><Trash2 className="size-4" />Disconnect only</Button>
            <Button disabled={!connection || Boolean(working)} className="bg-coral hover:bg-coral/90" onClick={() => disconnect(true)}><Trash2 className="size-4" />Disconnect and delete data</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProviderCard({ provider, connection, loading, detailed = false, onSync, onDisconnect }: {
  provider: IntegrationProvider;
  connection?: PublicIntegrationConnection;
  loading?: boolean;
  detailed?: boolean;
  onSync?: () => void;
  onDisconnect?: () => void;
}) {
  const meta = providers[provider];
  const connected = connection?.status === "CONNECTED";
  const expired = connection?.status === "EXPIRED";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid size-11 place-items-center rounded-lg text-lg font-black ${meta.color}`}>{meta.logo}</span>
          <div>
            <h2 className="text-lg font-black text-ink">{meta.name}</h2>
            <p className="mt-1 text-sm leading-5 text-ink/58">{meta.description}</p>
          </div>
        </div>
        <Badge label={loading ? "Loading" : connected ? "Connected" : expired ? "Expired" : "Not Connected"} tone={connected ? "good" : expired ? "warn" : "muted"} />
      </div>
      {loading ? (
        <div className="mt-5 h-24 animate-pulse rounded-lg bg-black/5" />
      ) : connection ? (
        <div className="mt-5 grid gap-3 text-sm">
          <Info label="Account" value={connection.accountEmail ?? "Connected account"} />
          <Info label="Property" value={connection.externalPropertyName ?? connection.externalPropertyId ?? "No property selected"} />
          <Info label="Last successful sync" value={connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "Not synced"} />
          <Info label="Imported range" value={connection.importedStartDate && connection.importedEndDate ? `${connection.importedStartDate} to ${connection.importedEndDate}` : "No imported data"} />
          {connection.lastSyncError ? <ErrorBanner message={connection.lastSyncError} compact /> : null}
        </div>
      ) : (
        <p className="mt-5 text-sm font-medium leading-6 text-ink/58">Connect this provider to select a project property and import the previous 90 days of data.</p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {!connection || expired ? (
          <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-bold text-white shadow-soft transition hover:bg-teal" href={`/api/integrations/${provider}/connect`}>
            <ExternalLink className="size-4" />{expired ? "Reconnect" : "Connect"}
          </a>
        ) : null}
        {connection ? <Button onClick={onSync} className="bg-teal hover:bg-ink"><RefreshCw className="size-4" />Sync Now</Button> : null}
        {detailed && connection ? <Button onClick={onDisconnect} className="bg-white text-ink ring-1 ring-black/10 hover:bg-gold/20"><Trash2 className="size-4" />Disconnect</Button> : null}
        {!detailed ? <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold text-ink ring-1 ring-black/10 transition hover:bg-gold/20" href={`/dashboard/integrations/${provider}`}>Manage</a> : null}
      </div>
    </Card>
  );
}

export function PerformancePage({ endpoint, title, description }: { endpoint: string; title: string; description: string }) {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const [data, setData] = useState<PerformanceDashboard>();
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams();
    if (startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    if (projectId) params.set("projectId", projectId);
    try {
      const response = await fetch(params.size ? `${endpoint}?${params.toString()}` : endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Could not load performance data.");
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load performance data.");
    }
  }, [endpoint, projectId, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const csv = useMemo(() => {
    if (!data?.trends) return "";
    const headers = Object.keys(data.trends[0] ?? { date: "" });
    return [headers.join(","), ...data.trends.map((row: Record<string, string | number>) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  }, [data]);

  return (
    <div>
      <Header title={title} description={description} />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs font-black uppercase text-ink/40">Start</label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-black uppercase text-ink/40">End</label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        <Button onClick={load}><RefreshCw className="size-4" />Apply</Button>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`${title.toLowerCase().replace(/\s+/g, "-")}.csv`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold text-ink ring-1 ring-black/10"><Download className="size-4" />Export CSV</a>
      </div>
      {!data ? <div className="mt-6 grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-black/5" />)}</div> : (
        <>
          {!data.connection ? <div className="mt-6"><EmptyState text="Connect this provider and sync data before viewing reports." /></div> : null}
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.metrics.map((metric) => (
              <Card key={metric.label} className="p-4">
                <p className="text-xs font-black uppercase text-ink/40">{metric.label}</p>
                <p className="mt-3 text-3xl font-black text-ink">{metric.value}</p>
                <p className={`mt-2 text-sm font-bold ${Number(metric.changePercent) >= 0 ? "text-teal" : "text-coral"}`}>{metric.changePercent}% vs previous</p>
              </Card>
            ))}
          </div>
          <Card className="mt-6 p-5">
            <div className="mb-4 flex items-center gap-3"><BarChart3 className="size-5 text-teal" /><h2 className="text-lg font-black">Trend</h2></div>
            <div className="grid h-48 grid-cols-12 items-end gap-1">
              {(data.trends ?? []).slice(-30).map((point, index) => {
                const value = Number(point.clicks ?? point.sessions ?? point.activeUsers ?? point.impressions ?? 0);
                const max = Math.max(...(data.trends ?? []).map((item) => Number(item.clicks ?? item.sessions ?? item.activeUsers ?? item.impressions ?? 0)), 1);
                return <div key={`${point.date}-${index}`} title={`${point.date}: ${value}`} className="rounded-t bg-teal/70" style={{ height: `${Math.max(6, (value / max) * 100)}%` }} />;
              })}
            </div>
          </Card>
          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {Object.entries(data.tables ?? {}).map(([name, rows]) => <TableBlock key={name} title={name} rows={rows} />)}
          </div>
          {data.unsupported?.length ? (
            <Card className="mt-6 p-5">
              <h2 className="mb-3 text-lg font-black">Unavailable metrics</h2>
              <div className="grid gap-2">{data.unsupported.map((item) => <p key={item.label} className="text-sm text-ink/60"><span className="font-black text-ink">{item.label}:</span> {item.reason}</p>)}</div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CombinedInsightsPage() {
  const [insights, setInsights] = useState<CombinedInsight[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/performance/combined-insights", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load insights.")))
      .then((data) => setInsights(data.insights ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load insights."));
  }, []);
  return (
    <div>
      <Header title="Combined Insights" description="Rule-based opportunities joining technical audit context, Search Console, GA4, and Bing imports." />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mt-6 grid gap-4">
        {insights.length ? insights.map((item) => (
          <Card key={item.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-ink/40">{item.dataSource}</p>
                <h2 className="mt-1 text-lg font-black text-ink">{item.pageOrQuery}</h2>
              </div>
              <Badge label={`${item.priority} · ${item.priorityScore}`} tone={item.priorityScore >= 60 ? "warn" : "muted"} />
            </div>
            <p className="mt-3 text-sm font-medium leading-6 text-ink/62">{item.recommendedAction}</p>
            <p className="mt-3 text-sm font-bold text-ink">{item.evidence}</p>
          </Card>
        )) : <EmptyState text="No combined opportunities yet. Sync provider data to generate rule-based insights." />}
      </div>
    </div>
  );
}

function Header({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <p className="text-sm font-black uppercase tracking-normal text-teal">Dashboard</p>
      <h1 className="mt-2 text-3xl font-black text-ink sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60 sm:text-base">{description}</p>
    </header>
  );
}

function Badge({ label, tone }: { label: string; tone: "good" | "warn" | "muted" }) {
  const className = tone === "good" ? "bg-teal/10 text-teal" : tone === "warn" ? "bg-coral/10 text-coral" : "bg-black/5 text-ink/50";
  return <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-black ${className}`}>{label}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1"><span className="text-xs font-black uppercase text-ink/38">{label}</span><span className="font-bold text-ink">{value}</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-black/15 bg-white/60 p-5 text-sm font-bold leading-6 text-ink/50">{text}</div>;
}

function ErrorBanner({ message, compact = false }: { message: string; compact?: boolean }) {
  return <div className={`${compact ? "mt-1" : "mt-5"} flex items-center gap-2 rounded-lg border border-coral/20 bg-coral/10 px-3 py-2 text-sm font-bold text-coral`}><AlertTriangle className="size-4" />{message}</div>;
}

function TableBlock({ title, rows }: { title: string; rows: DashboardTableRow[] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-lg font-black">{title}</h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-sm">
            <thead className="text-xs font-black uppercase text-ink/40"><tr><th className="py-2">Item</th><th>Value</th><th>Secondary</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={`${row.label}-${row.value}`} className="border-t border-black/10"><td className="max-w-xs truncate py-3 font-bold">{row.label}</td><td>{row.value}</td><td>{row.secondary ?? "-"}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text="No rows for this range." />}
    </Card>
  );
}
