import type { AiVisibilityReport, CreatedPublicReport, StructuredAiVisibilityReport } from "@aiva/core";
import { toStructuredAiVisibilityReport } from "@aiva/core";

export function publicReportView(report: AiVisibilityReport): StructuredAiVisibilityReport {
  return toStructuredAiVisibilityReport(report);
}

export function createdPublicReportView(report: AiVisibilityReport): CreatedPublicReport {
  return {
    id: report.id,
    ...toStructuredAiVisibilityReport(report)
  };
}
