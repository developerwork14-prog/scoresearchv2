import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/server/integrations/adapters";
import { createPkcePair, encodeAuthState, parseProvider, requestContext } from "@/lib/server/integrations/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerParam } = await context.params;
    const provider = parseProvider(providerParam);
    const { userId, projectId } = requestContext(request);
    const url = new URL(request.url);
    const requestedReturnTo = url.searchParams.get("returnTo");
    const returnTo = requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : undefined;
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = encodeAuthState({ provider, userId, projectId, codeVerifier, returnTo });
    const response = NextResponse.redirect(adapters[provider].getAuthorizationUrl({ state, codeChallenge }));
    response.cookies.set(`integration_oauth_state_${provider}`, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/"
    });
    return response;
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not start OAuth." }, { status: 400 });
  }
}
