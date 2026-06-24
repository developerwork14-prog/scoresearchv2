import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportStore } from "@/lib/server/report-store";
import { BUSINESS_EMAIL_MESSAGE, isBusinessEmail } from "@/lib/business-email";

export const runtime = "nodejs";

const strategyCallSchema = z.object({
  reportId: z.string().min(1),
  name: z.string().min(2).max(120),
  email: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE),
  phone: z.string().min(7).max(30)
});

export async function POST(request: NextRequest) {
  try {
    const body = strategyCallSchema.parse(await request.json());
    const report = await reportStore.get(body.reportId);
    if (!report) return NextResponse.json({ message: "Report not found" }, { status: 404 });

    const reportUrl = report.shareUrl || `${new URL(request.url).origin}/report/${report.id}`;
    const lead = {
      reportId: report.id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      brand: report.brandName,
      reportUrl,
      createdAt: new Date().toISOString()
    };
    await reportStore.saveLead(lead);

    const message = [
      "Strategy Call Request",
      `Name: ${body.name}`,
      `Email: ${body.email}`,
      `Phone: ${body.phone}`,
      `Brand: ${report.brandName}`,
      `Report: ${reportUrl}`
    ].join("\n");
    const notificationEmail = process.env.LEAD_NOTIFICATION_EMAIL ?? process.env.BUSINESS_EMAIL ?? "";
    const whatsappNumber = process.env.LEAD_WHATSAPP_NUMBER ?? "";
    const mailtoUrl = notificationEmail
      ? `mailto:${encodeURIComponent(notificationEmail)}?subject=${encodeURIComponent(`Strategy Call Request - ${report.brandName}`)}&body=${encodeURIComponent(message)}`
      : "";
    const whatsappUrl = whatsappNumber
      ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`
      : "";

    return NextResponse.json({
      ok: true,
      mailtoUrl,
      whatsappUrl,
      message: notificationEmail || whatsappNumber
        ? "Strategy call request captured."
        : "Strategy call request captured. Configure LEAD_NOTIFICATION_EMAIL and LEAD_WHATSAPP_NUMBER to route leads."
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0]?.message;
      return NextResponse.json({ message: firstError ?? "Invalid request", issues: error.flatten() }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
