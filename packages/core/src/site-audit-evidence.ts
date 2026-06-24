import type { CrawledPage } from "./site-crawler.js";

interface PageEvaluation {
  applicable?: boolean;
  passed: boolean;
  issueCount?: number;
  evidence?: unknown;
}

interface PageCollection {
  pages: CrawledPage[];
}

export interface SiteAuditEvidence {
  [key: string]: unknown;
  scope: "page-level-site-wide";
  pagesCrawled: number;
  pagesChecked: number;
  pagesPassed: number;
  pagesFailed: number;
  passRate: number;
  affectedPages: Array<{
    url: string;
    issueCount: number;
    sampleEvidence?: unknown;
  }>;
  sampleEvidence: unknown[];
}

export function aggregatePages(
  crawl: PageCollection,
  evaluate: (page: CrawledPage) => PageEvaluation
): SiteAuditEvidence {
  const evaluated = crawl.pages.map((page) => ({ page, result: evaluate(page) }));
  const applicable = evaluated.filter(({ result }) => result.applicable !== false);
  const failed = applicable.filter(({ result }) => !result.passed);
  const pagesPassed = applicable.length - failed.length;
  const passRate = applicable.length
    ? Number(((pagesPassed / applicable.length) * 100).toFixed(1))
    : 100;

  return {
    scope: "page-level-site-wide",
    pagesCrawled: crawl.pages.length,
    pagesChecked: applicable.length,
    pagesPassed,
    pagesFailed: failed.length,
    passRate,
    affectedPages: failed.slice(0, 10).map(({ page, result }) => ({
      url: page.finalUrl,
      issueCount: Math.max(1, result.issueCount ?? 1),
      sampleEvidence: result.evidence
    })),
    sampleEvidence: failed
      .map(({ result }) => result.evidence)
      .filter((evidence): evidence is NonNullable<typeof evidence> => evidence != null)
      .slice(0, 10)
  };
}

export function outcomeForEvidence(evidence: SiteAuditEvidence) {
  if (evidence.pagesChecked === 0) {
    return { passed: true, skipped: true, warning: false, severity: "Low" as const };
  }
  if (evidence.pagesFailed === 0) {
    return { passed: true, skipped: false, warning: false, severity: "Low" as const };
  }
  return {
    passed: false,
    skipped: false,
    warning: false,
    severity: evidence.pagesFailed === evidence.pagesChecked ? "High" as const : "Medium" as const
  };
}
