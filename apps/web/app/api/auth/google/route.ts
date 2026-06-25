import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/server/google-search-console";

export const runtime = "nodejs";

export async function GET() {
  const state = randomUUID();
  const response = NextResponse.redirect(googleAuthUrl(state));
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/"
  });
  return response;
}
