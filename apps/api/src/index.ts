import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import type { AiVisibilityReport, CreatedPublicReport, StructuredAiVisibilityReport } from "@aiva/core";
import { generateVisibilityReport, reportToCsv, reportToHtml, reportToJson, reportToPdf, runPromptPlayground, toStructuredAiVisibilityReport } from "@aiva/core";
import { z } from "zod";
import { env } from "./env.js";
import { reportStore } from "./report-store.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.webOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "rediffmail.com"
]);

const BUSINESS_EMAIL_MESSAGE = "Please use your workspace email. Personal emails (Gmail, Yahoo, Outlook, etc.) are not allowed.";

function isBusinessEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return Boolean(domain) && !PERSONAL_EMAIL_DOMAINS.has(domain);
}

const reportInputSchema = z.object({
  brandName: z.string().min(2).max(120),
  websiteUrl: z.string().min(4).max(300),
  businessEmail: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE)
});

const strategyCallSchema = z.object({
  reportId: z.string().min(1),
  name: z.string().min(2).max(120),
  email: z.string().email().refine(isBusinessEmail, BUSINESS_EMAIL_MESSAGE),
  phone: z.string().min(7).max(30)
});

function publicReportView(report: AiVisibilityReport): StructuredAiVisibilityReport {
  return toStructuredAiVisibilityReport(report);
}

function createdPublicReportView(report: AiVisibilityReport): CreatedPublicReport {
  return {
    id: report.id,
    ...toStructuredAiVisibilityReport(report)
  };
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "ai-visibility-analyzer-api",
    store: await reportStore.health()
  });
});

app.post("/api/reports", async (req, res, next) => {
  try {
    const input = reportInputSchema.parse(req.body);
    const report = await generateVisibilityReport(input, env.webOrigin);
    await reportStore.save(report);
    res.status(201).json(createdPublicReportView(report));
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports/:id", async (req, res) => {
  const report = await reportStore.get(req.params.id);
  if (!report) {
    res.status(404).json({ message: "Report not found" });
    return;
  }
  res.json(publicReportView(report));
});

app.post("/api/playground", async (req, res, next) => {
  try {
    const body = z.object({
      reportId: z.string(),
      prompt: z.string().min(4).max(500)
    }).parse(req.body);
    const report = await reportStore.get(body.reportId);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    res.json(runPromptPlayground(report.brandName, body.prompt, report.visibilityScore));
  } catch (error) {
    next(error);
  }
});

app.post("/api/strategy-call", async (req, res, next) => {
  try {
    const body = strategyCallSchema.parse(req.body);
    const report = await reportStore.get(body.reportId);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }

    const message = [
      "Strategy Call Request",
      `Name: ${body.name}`,
      `Email: ${body.email}`,
      `Phone: ${body.phone}`,
      `Brand: ${report.brandName}`,
      `Report: ${report.shareUrl}`
    ].join("\n");
    const mailtoUrl = env.notificationEmail
      ? `mailto:${encodeURIComponent(env.notificationEmail)}?subject=${encodeURIComponent(`Strategy Call Request - ${report.brandName}`)}&body=${encodeURIComponent(message)}`
      : "";
    const whatsappUrl = env.whatsappNumber
      ? `https://wa.me/${env.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`
      : "";

    if (process.env.RESEND_API_KEY && env.notificationEmail) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "SearchScore.ai <leads@searchscore.ai>",
          to: env.notificationEmail,
          subject: `Strategy Call Request - ${report.brandName}`,
          text: message
        })
      }).catch((err) => console.error("Resend API error:", err));
    } else {
      console.log("Strategy call lead captured (Resend not configured):", message);
    }
    res.status(201).json({
      ok: true,
      mailtoUrl,
      whatsappUrl,
      message: env.notificationEmail || env.whatsappNumber
        ? "Strategy call request captured."
        : "Strategy call request captured. Configure LEAD_NOTIFICATION_EMAIL and LEAD_WHATSAPP_NUMBER to route leads."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports/:id/export/:format", async (req, res) => {
  const report = await reportStore.get(req.params.id);
  if (!report) {
    res.status(404).json({ message: "Report not found" });
    return;
  }

  if (req.params.format === "json") {
    res.type("application/json").send(reportToJson(report));
    return;
  }
  if (req.params.format === "excel") {
    res.setHeader("Content-Disposition", `attachment; filename="${report.brandName}-visibility.csv"`);
    res.type("text/csv").send(reportToCsv(report));
    return;
  }
  if (req.params.format === "pdf") {
    res.setHeader("Content-Disposition", `attachment; filename="${report.brandName}-visibility.pdf"`);
    res.type("application/pdf").send(reportToPdf(report));
    return;
  }

  res.status(400).json({ message: "Unsupported export format" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: error.issues[0]?.message ?? "Invalid request", issues: error.flatten() });
    return;
  }
  console.error(error);
  res.status(500).json({ message: "Internal server error" });
});

app.listen(env.port, () => {
  console.log(`AI Visibility Analyzer API running on http://localhost:${env.port}`);
});
