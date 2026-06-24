import { NextRequest, NextResponse } from "next/server";
import { runPromptPlayground } from "@aiva/core";
import { z } from "zod";
import { reportStore } from "@/lib/server/report-store";

export const runtime = "nodejs";

const playgroundSchema = z.object({
  reportId: z.string().min(1),
  prompt: z.string().min(4).max(500)
});

export async function POST(request: NextRequest) {
  try {
    const body = playgroundSchema.parse(await request.json());
    const report = await reportStore.get(body.reportId);
    if (!report) return NextResponse.json({ message: "Report not found" }, { status: 404 });

    return NextResponse.json(runPromptPlayground(report.brandName, body.prompt, report.visibilityScore));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid request", issues: error.flatten() }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
