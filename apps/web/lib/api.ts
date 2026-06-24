import type { CreatedPublicReport, PlaygroundResult, ReportInput, StructuredAiVisibilityReport } from "@aiva/core";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
// Allow the server's five-minute audit budget plus response serialization time.
const REPORT_REQUEST_TIMEOUT_MS = 330000;

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
    return parseResponse<CreatedPublicReport>(response);
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
  return parseResponse<StructuredAiVisibilityReport>(response);
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
