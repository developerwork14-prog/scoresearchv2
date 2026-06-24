import { NextRequest, NextResponse } from "next/server";
import { generateVisibilityReport } from "@aiva/core";
import { z } from "zod";
import { reportStore } from "@/lib/server/report-store";
import { createdPublicReportView } from "@/lib/server/report-views";
import { BUSINESS_EMAIL_MESSAGE, isBusinessEmail } from "@/lib/business-email";
import { loadServerEnv } from "@/lib/server/env";

export const runtime = "nodejs";
export const maxDuration = 300;

const reportInputSchema = z.object({
  brandName: z.string().min(2).max(120),
  websiteUrl: z.string().min(4).max(300),
  businessEmail: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE)
});

export async function POST(request: NextRequest) {
  try {
    loadServerEnv();
    const input = reportInputSchema.parse(await request.json());
    const report = await generateVisibilityReport(input, new URL(request.url).origin);
    await reportStore.save(report);
    return NextResponse.json(createdPublicReportView(report), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0]?.message;
      return NextResponse.json({ message: firstError ?? "Invalid request", issues: error.flatten() }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({
      message: error instanceof Error ? error.message : "Internal server error"
    }, { status: 500 });
  }
}
