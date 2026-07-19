import { PerformancePage } from "@/components/integration-provider-page";

export default function Page() {
  return <PerformancePage endpoint="/api/performance/analytics" title="Website Analytics" description="GA4 users, sessions, engagement, organic landing pages, sources, devices, geography, and conversion trends." />;
}
