import { NextRequest, NextResponse } from "next/server";
import { reportToCsv, reportToHtml, reportToJson, reportToPdf } from "@aiva/core";
import { reportStore } from "@/lib/server/report-store";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  const report = await reportStore.get(id);
  if (!report) return NextResponse.json({ message: "Report not found" }, { status: 404 });

  if (format === "json") {
    return new NextResponse(reportToJson(report), {
      headers: { "content-type": "application/json" }
    });
  }

  if (format === "excel") {
    return new NextResponse(reportToCsv(report), {
      headers: {
        "content-disposition": `attachment; filename="${report.brandName}-visibility.csv"`,
        "content-type": "text/csv"
      }
    });
  }

  if (format === "pdf") {
    return new NextResponse(reportToPdf(report), {
      headers: {
        "content-disposition": `attachment; filename="${report.brandName}-visibility.pdf"`,
        "content-type": "application/pdf"
      }
    });
  }

  if (format === "html") {
    return new NextResponse(reportToHtml(report), {
      headers: { "content-type": "text/html" }
    });
  }

  return NextResponse.json({ message: "Unsupported export format" }, { status: 400 });
}
