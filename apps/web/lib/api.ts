import type { CreatedPublicReport, PlaygroundResult, ReportInput, StructuredAiVisibilityReport } from "@aiva/core";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
// Allow the server's five-minute audit budget plus response serialization time.
const REPORT_REQUEST_TIMEOUT_MS = 330000;
const REPORT_CACHE_PREFIX = "aiva-report:";

function cacheReport(report: StructuredAiVisibilityReport) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${REPORT_CACHE_PREFIX}${report.id}`, JSON.stringify(report));
  } catch {
    // Session storage is a best-effort guard against read-after-write misses.
  }
}

function cachedReport(id: string) {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(`${REPORT_CACHE_PREFIX}${id}`);
    return value ? JSON.parse(value) as StructuredAiVisibilityReport : null;
  } catch {
    return null;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error((await response.json().catch(() => null))?.message ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export async function createReport(input: ReportInput) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REPORT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal
    });
    const report = await parseResponse<CreatedPublicReport>(response);
    cacheReport(report);
    return report;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The scan exceeded five minutes. Please try again or check the audit server logs.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getReport(id: string) {
  const response = await fetch(`${API_BASE}/api/reports/${id}`, { cache: "no-store" });
  if (response.ok) {
    const report = await response.json() as StructuredAiVisibilityReport;
    cacheReport(report);
    return report;
  }
  if (response.status === 404) {
    const report = cachedReport(id);
    if (report) return report;
  }
  throw new Error((await response.json().catch(() => null))?.message ?? "Request failed");
}

export async function runPlayground(reportId: string, prompt: string) {
  const response = await fetch(`${API_BASE}/api/playground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, prompt })
  });
  return parseResponse<PlaygroundResult>(response);
}

export async function submitStrategyCall(input: { reportId: string; name: string; email: string; phone: string }) {
  const response = await fetch(`${API_BASE}/api/strategy-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parseResponse<{ ok: boolean; message: string; mailtoUrl: string; whatsappUrl: string }>(response);
}
