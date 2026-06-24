import { NextRequest, NextResponse } from "next/server";
import { reportStore } from "@/lib/server/report-store";
import { publicReportView } from "@/lib/server/report-views";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await reportStore.get(id);
  if (!report) return NextResponse.json({ message: "Report not found" }, { status: 404 });

  return NextResponse.json(publicReportView(report));
}
