import { NextRequest, NextResponse } from "next/server";
import { generateVisibilityReport } from "@aiva/core";
import { z } from "zod";
import { reportStore } from "@/lib/server/report-store";
import { createdPublicReportView } from "@/lib/server/report-views";
import { BUSINESS_EMAIL_MESSAGE, isBusinessEmail } from "@/lib/business-email";
import { loadServerEnv } from "@/lib/server/env";
import { googleSearchConsoleContextForWebsite } from "@/lib/server/google-search-console";

export const runtime = "nodejs";
export const maxDuration = 300;
const REPORT_ROUTE_TIMEOUT_MS = 285000;

class ReportRouteTimeoutError extends Error {
  constructor() {
    super("The audit server exceeded its processing budget. Please try again in a few minutes.");
  }
}

const reportInputSchema = z.object({
  brandName: z.string().min(2).max(120),
  websiteUrl: z.string().min(4).max(300),
  businessEmail: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE)
});

async function withRouteTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new ReportRouteTimeoutError()), REPORT_ROUTE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await withRouteTimeout((async () => {
      loadServerEnv();
      const input = reportInputSchema.parse(await request.json());
      const googleSearchConsole = await googleSearchConsoleContextForWebsite(input.websiteUrl);
      const report = await generateVisibilityReport({ ...input, googleSearchConsole }, new URL(request.url).origin);
      await reportStore.save(report);
      return NextResponse.json(createdPublicReportView(report), { status: 201 });
    })());
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0]?.message;
      return NextResponse.json({ message: firstError ?? "Invalid request", issues: error.flatten() }, { status: 400 });
    }
    if (error instanceof ReportRouteTimeoutError) {
      console.error(error);
      return NextResponse.json({ message: error.message }, { status: 504 });
    }
    console.error(error);
    return NextResponse.json({
      message: error instanceof Error ? error.message : "Internal server error"
    }, { status: 500 });
  }
}
