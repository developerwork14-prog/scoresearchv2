import { NextRequest, NextResponse } from "next/server";
import { requestContext } from "@/lib/server/integrations/auth";
import { performanceDashboard } from "@/lib/server/integrations/performance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId, projectId } = requestContext(request);
  const url = new URL(request.url);
  return NextResponse.json(await performanceDashboard({
    userId,
    projectId,
    provider: "GOOGLE_SEARCH_CONSOLE",
    range: dateRange(url)
  }));
}

function dateRange(url: URL) {
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  return startDate && endDate ? { startDate, endDate } : undefined;
}
