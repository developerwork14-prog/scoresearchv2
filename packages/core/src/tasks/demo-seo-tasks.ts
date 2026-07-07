import { pathToFileURL } from "node:url";
import { generateSeoTasks, type SeoTaskGenerationReport } from "./generate-seo-tasks.js";

export function printSampleSeoTasks() {
  const sampleReport = {
    id: "sample-report-1",
    projectId: "sample-project-1",
    websiteUrl: "https://example.com/",
    createdAt: "2026-06-29T00:00:00.000Z",
    technicalChecks: [
      {
        id: 2,
        category: "HTTP & Server Health",
        name: "HTTPS protocol enabled",
        weight: 10,
        severity: "BLOCKER",
        passed: false,
        evidence: "Homepage was requested over HTTP.",
        recommendation: "Redirect all HTTP requests to HTTPS.",
        scope: "domain"
      },
      {
        id: 20,
        category: "Meta Tags",
        name: "Viewport meta tag present",
        weight: 8,
        severity: "BLOCKER",
        passed: true,
        evidence: "Viewport tag exists.",
        scope: "page"
      },
      {
        id: 35,
        category: "Indexability & Crawlability",
        name: "0 broken internal links",
        weight: 7,
        severity: "MAJOR",
        passed: false,
        evidence: { sampleUrls: ["https://example.com/pricing"], brokenLinks: 3 },
        recommendation: "Fix or redirect broken internal links.",
        scope: "domain"
      },
      {
        id: 66,
        category: "Image SEO",
        name: "Image filenames are descriptive",
        weight: 3,
        severity: "ADVISORY",
        passed: false,
        skipped: true,
        evidence: "Image crawl was limited.",
        scope: "page"
      }
    ]
  } satisfies SeoTaskGenerationReport;

  const tasks = generateSeoTasks(sampleReport, { now: "2026-06-29T00:00:00.000Z" });
  console.log(JSON.stringify(tasks, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printSampleSeoTasks();
}
