"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, MousePointerClick, RefreshCw, Search, TrendingUp } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import type { DashboardMetric, DashboardTableRow, PerformanceDashboard } from "@/lib/server/integrations/types";

type TrendPoint = Record<string, number | string>;

const metricStyles: Record<string, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  "Total clicks": { color: "#2563EB", bg: "bg-[#EAF2FF]", icon: MousePointerClick },
  "Total impressions": { color: "#7C3AED", bg: "bg-[#F3ECFF]", icon: Search },
  "Average CTR": { color: "#00856F", bg: "bg-[#E7F8F2]", icon: TrendingUp },
  "Average position": { color: "#C26401", bg: "bg-[#FFF3E0]", icon: ArrowUpRight }
};

const tableLabels = ["Top queries", "Top pages", "Top countries", "Device distribution", "Low CTR, high impression queries", "Keywords positions 4 to 20"];

export function SearchConsoleDashboard() {
  const [data, setData] = useState<PerformanceDashboard>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeTable, setActiveTable] = useState("Top queries");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    const params = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
    try {
      const response = await fetch(`/api/performance/search-console${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "Could not load Search Console data.");
      setData(payload);
      const firstTable = tableLabels.find((label) => payload.tables?.[label]?.length);
      if (firstTable) setActiveTable(firstTable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Search Console data.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const csv = useMemo(() => {
    if (!data?.trends?.length) return "";
    const headers = Object.keys(data.trends[0]);
    return [headers.join(","), ...data.trends.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  }, [data]);

  const availableTables = tableLabels.filter((label) => data?.tables?.[label]);
  const activeRows = data?.tables?.[activeTable] ?? [];

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-normal text-teal">Google Search Console</p>
          <h1 className="mt-2 text-3xl font-black text-ink sm:text-4xl">Search performance</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60 sm:text-base">Clicks, impressions, CTR, ranking position, queries, pages, countries, and devices from the selected property.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={load} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="google-search-console-trends.csv" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold text-ink ring-1 ring-black/10 transition hover:bg-gold/20">
            <Download className="size-4" />Export CSV
          </a>
        </div>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="mt-5 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="mb-1 block text-xs font-black uppercase text-ink/40">Start date</label>
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <label className="mb-1 block text-xs font-black uppercase text-ink/40">End date</label>
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <Button onClick={load} disabled={loading}><RefreshCw className="size-4" />Apply</Button>
      </section>

      {loading && !data ? <LoadingState /> : null}

      {!loading && data && !data.connection ? (
        <div className="mt-6">
          <EmptyState text="Connect Google Search Console, select a property, and sync data before viewing this dashboard." />
        </div>
      ) : null}

      {data ? (
        <>
          <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.metrics.map((metric) => <MetricTile key={metric.label} metric={metric} />)}
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-5 py-4">
                <div>
                  <h2 className="text-lg font-black text-ink">Performance over time</h2>
                  <p className="mt-1 text-sm font-medium text-ink/52">{data.range.startDate} to {data.range.endDate}</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs font-black uppercase text-ink/45">
                  <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#2563EB]" />Clicks</span>
                  <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[#7C3AED]" />Impressions</span>
                </div>
              </div>
              <SearchChart points={data.trends ?? []} />
            </Card>

            <Card className="p-5">
              <h2 className="text-lg font-black text-ink">Property</h2>
              <div className="mt-4 grid gap-4 text-sm">
                <Info label="Account" value={data.connection?.accountEmail ?? "Connected account"} />
                <Info label="Selected property" value={data.connection?.externalPropertyName ?? data.connection?.externalPropertyId ?? "No property selected"} />
                <Info label="Last sync" value={data.connection?.lastSyncedAt ? new Date(data.connection.lastSyncedAt).toLocaleString() : "Not synced"} />
                <Info label="Imported range" value={data.connection?.importedStartDate && data.connection.importedEndDate ? `${data.connection.importedStartDate} to ${data.connection.importedEndDate}` : "No imported data"} />
              </div>
            </Card>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="p-3">
              <div className="grid gap-1">
                {availableTables.map((label) => (
                  <button key={label} type="button" onClick={() => setActiveTable(label)} className={`min-h-11 rounded-md px-3 text-left text-sm font-black transition ${activeTable === label ? "bg-ink text-white" : "text-ink/62 hover:bg-gold/20 hover:text-ink"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Card>
            <TableBlock title={activeTable} rows={activeRows} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function MetricTile({ metric }: { metric: DashboardMetric }) {
  const style = metricStyles[metric.label] ?? metricStyles["Total clicks"];
  const Icon = style.icon;
  const up = Number(metric.changePercent ?? 0) >= 0;
  const ChangeIcon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-ink/40">{metric.label}</p>
          <p className="mt-3 text-3xl font-black text-ink">{metric.value}</p>
        </div>
        <span className={`grid size-10 place-items-center rounded-lg ${style.bg}`} style={{ color: style.color }}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className={`mt-3 inline-flex items-center gap-1 text-sm font-black ${up ? "text-teal" : "text-coral"}`}>
        <ChangeIcon className="size-4" />{metric.changePercent ?? 0}% vs previous
      </p>
    </Card>
  );
}

function SearchChart({ points }: { points: TrendPoint[] }) {
  const visible = points.slice(-90);
  const clickValues = visible.map((point) => Number(point.clicks ?? 0));
  const impressionValues = visible.map((point) => Number(point.impressions ?? 0));
  const clickPath = linePath(clickValues, 680, 250);
  const impressionPath = linePath(impressionValues, 680, 250);
  const clickBarsMax = Math.max(...clickValues, 1);

  if (!visible.length) {
    return <div className="p-5"><EmptyState text="No trend rows were imported for this range." /></div>;
  }

  return (
    <div className="h-[320px] p-4">
      <svg viewBox="0 0 720 300" className="h-full w-full" role="img" aria-label="Search Console clicks and impressions trend">
        {[0, 1, 2, 3].map((line) => <line key={line} x1="20" x2="700" y1={30 + line * 62} y2={30 + line * 62} stroke="#ECECEC" strokeWidth="1" />)}
        {clickValues.map((value, index) => {
          const width = 680 / Math.max(clickValues.length, 1);
          const height = Math.max(2, (value / clickBarsMax) * 88);
          return <rect key={`${visible[index]?.date}-${index}`} x={20 + index * width} y={270 - height} width={Math.max(2, width - 2)} height={height} rx="2" fill="#2563EB" opacity="0.12" />;
        })}
        <path d={impressionPath} fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
        <path d={clickPath} fill="none" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" />
        <text x="20" y="292" fill="#777777" fontSize="12" fontWeight="700">{String(visible[0]?.date ?? "")}</text>
        <text x="700" y="292" textAnchor="end" fill="#777777" fontSize="12" fontWeight="700">{String(visible[visible.length - 1]?.date ?? "")}</text>
      </svg>
    </div>
  );
}

function linePath(values: number[], width: number, height: number) {
  const max = Math.max(...values, 1);
  return values.map((value, index) => {
    const x = 20 + (index / Math.max(values.length - 1, 1)) * width;
    const y = 20 + (1 - value / max) * height;
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function TableBlock({ title, rows }: { title: string; rows: DashboardTableRow[] }) {
  const secondaryLabel = title.includes("CTR") || title.includes("position") ? "Impressions" : "Impressions";
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-black/10 px-5 py-4">
        <h2 className="text-lg font-black text-ink">{title}</h2>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[#FAFAFA] text-xs font-black uppercase text-ink/40">
              <tr>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Primary</th>
                <th className="px-5 py-3">{secondaryLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.label}-${row.value}-${row.secondary}`} className="border-t border-black/10">
                  <td className="max-w-[420px] truncate px-5 py-3 font-bold text-ink" title={row.label}>{row.label}</td>
                  <td className="px-5 py-3 font-black text-ink">{row.value}</td>
                  <td className="px-5 py-3 font-bold text-ink/58">{row.secondary ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="p-5"><EmptyState text="No rows for this range." /></div>}
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg bg-black/5" />)}</div>
      <div className="h-80 animate-pulse rounded-lg bg-black/5" />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1"><span className="text-xs font-black uppercase text-ink/38">{label}</span><span className="break-words font-bold text-ink">{value}</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-black/15 bg-white/60 p-5 text-sm font-bold leading-6 text-ink/50">{text}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="mt-5 flex items-center gap-2 rounded-lg border border-coral/20 bg-coral/10 px-3 py-2 text-sm font-bold text-coral"><AlertTriangle className="size-4" />{message}</div>;
}
