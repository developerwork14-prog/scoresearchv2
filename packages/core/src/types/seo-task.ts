export type SeoTaskPriority = "high" | "medium" | "low";

export type SeoTaskStatus = "open" | "assigned" | "in_progress" | "fixed" | "verified" | "closed";

export type SeoTaskOwnerTeam = "technical" | "content" | "developer" | "design" | "analytics" | "seo";

export type SeoTaskSource = "audit";

export interface SeoTask {
  id: string;
  reportId: string;
  projectId?: string;
  domain?: string;
  auditArea: string;
  checkGroup: string;
  issueTitle: string;
  issueDescription: string;
  affectedPages: string[];
  priority: SeoTaskPriority;
  status: SeoTaskStatus;
  ownerTeam: SeoTaskOwnerTeam;
  source: SeoTaskSource;
  evidence: unknown;
  recommendation?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SeoTaskGenerationOptions {
  now?: Date | string;
  defaultStatus?: SeoTaskStatus;
}
