import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adapters } from "@/lib/server/integrations/adapters";
import { parseProvider, readJson, requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";
import { runIntegrationSync } from "@/lib/server/integrations/sync";
import { toPublicConnection } from "@/lib/server/integrations/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  propertyId: z.string().min(1),
  propertyName: z.string().optional(),
  accountId: z.string().optional(),
  syncNow: z.boolean().optional().default(true)
});

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const body = bodySchema.parse(await readJson(request));
    const connection = await integrationStore.getConnection(userId, projectId, provider);
    if (!connection) return NextResponse.json({ message: "Connect this provider before selecting a property." }, { status: 404 });
    const valid = await adapters[provider].validatePropertyAccess(connection, body.propertyId);
    if (!valid) return NextResponse.json({ message: "The selected property is not available to this account." }, { status: 403 });
    const saved = await integrationStore.saveConnection({
      ...connection,
      externalAccountId: body.accountId ?? connection.externalAccountId,
      externalPropertyId: body.propertyId,
      externalPropertyName: body.propertyName ?? body.propertyId,
      lastSyncStatus: "IDLE",
      lastSyncError: undefined,
      status: "CONNECTED"
    });
    const result = body.syncNow ? await runIntegrationSync(adapters[provider], saved, "initial") : { connection: saved, importedRows: 0 };
    return NextResponse.json({ connection: toPublicConnection(result.connection), importedRows: result.importedRows });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not select property." }, { status: 400 });
  }
}
