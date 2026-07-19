import { NextRequest, NextResponse } from "next/server";
import { parseProvider, requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const deleteData = new URL(request.url).searchParams.get("deleteData") === "1";
    await integrationStore.deleteConnection(userId, projectId, provider, deleteData);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not disconnect provider." }, { status: 400 });
  }
}
