import { NextRequest, NextResponse } from "next/server";
import { adapters, createPendingConnection } from "@/lib/server/integrations/adapters";
import { decodeAuthState, parseProvider } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const code = url.searchParams.get("code");
    const stateValue = url.searchParams.get("state");
    const expectedState = request.cookies.get(`integration_oauth_state_${provider}`)?.value;
    if (url.searchParams.get("error")) throw new Error(`OAuth was denied: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
    if (!code) throw new Error("OAuth callback did not include an authorization code.");
    if (!stateValue || !expectedState || stateValue !== expectedState) throw new Error("OAuth state validation failed.");
    const state = decodeAuthState(stateValue);
    if (state.provider !== provider) throw new Error("OAuth state provider mismatch.");
    const tokenSet = await adapters[provider].handleOAuthCallback(code, state.codeVerifier);
    await integrationStore.saveConnection(createPendingConnection({
      userId: state.userId,
      projectId: state.projectId,
      provider,
      tokenSet
    }));
    const destination = state.returnTo ?? `/report/${encodeURIComponent(state.projectId)}?integration=1&connected=${provider}`;
    const response = NextResponse.redirect(`${url.origin}${destination}`);
    response.cookies.delete(`integration_oauth_state_${provider}`);
    return response;
  } catch (error) {
    console.error("Integration OAuth callback failed", error);
    return NextResponse.redirect(`${url.origin}/dashboard/integrations?error=${encodeURIComponent(error instanceof Error ? error.message : "OAuth failed")}`);
  }
}
