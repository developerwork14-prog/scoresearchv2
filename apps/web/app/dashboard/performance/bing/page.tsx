import { PerformancePage } from "@/components/integration-provider-page";

export default function Page() {
  return <PerformancePage endpoint="/api/performance/bing" title="Bing Performance" description="Bing search performance and supported crawl metrics imported from the configured Webmaster API surface." />;
}
