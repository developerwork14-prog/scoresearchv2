import { AiVisibilityReport } from "@aiva/core";

const memoryStore = new Map<string, AiVisibilityReport>();

export const reportStore = {
  async save(report: AiVisibilityReport) {
    memoryStore.set(report.id, report);
    return report;
  },
  async get(id: string) {
    return memoryStore.get(id) ?? null;
  }
};
