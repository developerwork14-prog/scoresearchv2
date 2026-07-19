import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/server/integrations/adapters";
import { parseProvider, requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const connection = await integrationStore.getConnection(userId, projectId, provider);
    if (!connection) return NextResponse.json({ message: "Connect this provider before testing." }, { status: 404 });
    return NextResponse.json(await adapters[provider].testConnection(connection));
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Connection test failed." }, { status: 502 });
  }
}
