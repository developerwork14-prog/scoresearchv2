import { PerformancePage } from "@/components/integration-provider-page";

export default function Page() {
  return <PerformancePage endpoint="/api/performance/search-console" title="Search Performance" description="Google Search Console clicks, impressions, CTR, positions, queries, pages, countries, and device trends." />;
}
