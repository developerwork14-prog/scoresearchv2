import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/server/integrations/adapters";
import { parseProvider, requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const connection = await integrationStore.getConnection(userId, projectId, provider);
    if (!connection) return NextResponse.json({ message: "Connect this provider before listing properties." }, { status: 404 });
    const properties = await adapters[provider].listProperties(connection);
    return NextResponse.json({ properties });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not list properties." }, { status: 502 });
  }
}
