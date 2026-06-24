import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";
import { BUSINESS_EMAIL_MESSAGE, isBusinessEmail } from "@/lib/business-email";

export const runtime = "nodejs";

const callbackSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE),
  phone: z.string().min(7).max(30),
  website: z.string().min(4).max(300)
});

export async function POST(request: NextRequest) {
  try {
    const body = callbackSchema.parse(await request.json());
    const to = process.env.LEAD_NOTIFICATION_EMAIL ?? process.env.BUSINESS_EMAIL ?? "";
    const smtpHost = process.env.SMTP_HOST ?? "";
    const smtpPort = Number(process.env.SMTP_PORT ?? 465);
    const smtpUser = process.env.SMTP_USER ?? "";
    const smtpPass = process.env.SMTP_PASS ?? "";
    const from = process.env.LEAD_EMAIL_FROM ?? process.env.EMAIL_FROM ?? smtpUser;

    if (!to || !smtpHost || !smtpUser || !smtpPass || !from) {
      console.log("Callback request captured, but email sending is not configured.", body);
      return NextResponse.json(
        {
          message: "Callback captured, but SMTP email sending is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and LEAD_NOTIFICATION_EMAIL."
        },
        { status: 503 }
      );
    }

    const submittedAt = new Date().toISOString();
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    const subject = `Callback Request - ${body.name}`;
    const text = [
      "New callback request",
      "",
      `Name: ${body.name}`,
      `Company Email: ${body.email}`,
      `Phone: ${body.phone}`,
      `Website: ${body.website}`,
      `Submitted: ${submittedAt}`,
      `Source: ${origin}`
    ].join("\n");

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    try {
      await transporter.sendMail({
        from,
        to,
        replyTo: body.email,
        subject,
        text
      });
    } catch (error) {
      console.error("Callback SMTP email failed", error);
      if (error && typeof error === "object" && "code" in error && error.code === "EAUTH") {
        return NextResponse.json({ message: "Gmail rejected the SMTP login. Check SMTP_USER and use a valid Gmail App Password for SMTP_PASS." }, { status: 502 });
      }
      return NextResponse.json({ message: "Could not send callback email. Check email provider settings." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, message: "Callback request sent." }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0]?.message;
      return NextResponse.json({ message: firstError ?? "Invalid request", issues: error.flatten() }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ message: "Could not submit callback request." }, { status: 500 });
  }
}
