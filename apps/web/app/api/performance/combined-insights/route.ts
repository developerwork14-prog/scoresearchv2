import { NextRequest, NextResponse } from "next/server";
import { requestContext } from "@/lib/server/integrations/auth";
import { combinedInsights } from "@/lib/server/integrations/performance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId, projectId } = requestContext(request);
  return NextResponse.json({ insights: await combinedInsights(userId, projectId) });
}
