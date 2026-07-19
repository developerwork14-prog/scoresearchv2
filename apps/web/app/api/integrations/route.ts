import { NextRequest, NextResponse } from "next/server";
import { requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";
import { toPublicConnection } from "@/lib/server/integrations/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { userId, projectId } = requestContext(request);
    const connections = await integrationStore.listConnections(userId, projectId);
    return NextResponse.json({ connections: connections.map(toPublicConnection) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not load integrations." }, { status: 401 });
  }
}
