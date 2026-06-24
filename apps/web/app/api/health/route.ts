import { NextResponse } from "next/server";
import { reportStoreHealth } from "@/lib/server/report-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      storage: await reportStoreHealth()
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      ok: false,
      message: error instanceof Error ? error.message : "Health check failed"
    }, { status: 500 });
  }
}
