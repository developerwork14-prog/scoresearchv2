import { NextRequest, NextResponse } from "next/server";
import { saveGoogleConnectionFromCode } from "@/lib/server/google-search-console";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("google_oauth_state")?.value;
  const origin = url.origin;

  if (!code) {
    return NextResponse.json({ message: "Google OAuth callback did not include a code." }, { status: 400 });
  }
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.json({ message: "Google OAuth state validation failed." }, { status: 400 });
  }

  try {
    const connection = await saveGoogleConnectionFromCode(code);
    const response = NextResponse.redirect(`${origin}/?gsc=connected&sites=${connection.sites.length}`);
    response.cookies.delete("google_oauth_state");
    return response;
  } catch (error) {
    console.error("Google Search Console connection failed", error);
    return NextResponse.json({
      message: error instanceof Error ? error.message : "Could not connect Google Search Console."
    }, { status: 502 });
  }
}
