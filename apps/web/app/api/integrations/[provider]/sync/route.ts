import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/server/integrations/adapters";
import { parseProvider, requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";
import { runIntegrationSync } from "@/lib/server/integrations/sync";
import { toPublicConnection } from "@/lib/server/integrations/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const connection = await integrationStore.getConnection(userId, projectId, provider);
    if (!connection) return NextResponse.json({ message: "Connect this provider before syncing." }, { status: 404 });
    const result = await runIntegrationSync(adapters[provider], connection, "incremental");
    return NextResponse.json({ connection: toPublicConnection(result.connection), importedRows: result.importedRows });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not sync provider." }, { status: 409 });
  }
}
