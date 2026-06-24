import { AiVisibilityReport } from "./types.js";
import { toStructuredAiVisibilityReport } from "./structured-report.js";

export function reportToJson(report: AiVisibilityReport) {
  return JSON.stringify(toStructuredAiVisibilityReport(report), null, 2);
}

export function reportToCsv(report: AiVisibilityReport) {
  const publicReport = toStructuredAiVisibilityReport(report);
  const rows = [
    ["Metric", "Value"],
    ["Brand", publicReport.brand],
    ["AI Visibility Score", `${publicReport.overall_score}%`],
    ["Rating", publicReport.rating_label],
    ["Technical Score", `${publicReport.technical_audit.score}%`],
    ["Technical Grade", publicReport.technical_audit.grade],
    ["Technical Issues Found", publicReport.technical_audit.issues_found],
    ["GEO / AEO Score", `${publicReport.geo_aeo_audit.score}%`],
    ["GEO / AEO Grade", publicReport.geo_aeo_audit.grade],
    ["GEO / AEO Opportunities Found", publicReport.geo_aeo_audit.opportunity_counts.high + publicReport.geo_aeo_audit.opportunity_counts.medium + publicReport.geo_aeo_audit.opportunity_counts.low],
    [],
    ["Technical Category", "Total Checks", "Issues Found", "Category Score", "Status"],
    ...publicReport.technical_categories.map((category) => [
      category.categoryName,
      category.totalChecks,
      category.failedChecks,
      `${category.score}%`,
      category.status
    ]),
    [],
    ["GEO / AEO Category", "Total Checks", "Issues Found", "Category Score", "Status"],
    ...publicReport.geo_aeo_audit.categories.map((category) => [
      category.categoryName,
      category.totalChecks,
      category.failedChecks,
      `${category.score}%`,
      category.status
    ])
  ];
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
}

export function reportToHtml(report: AiVisibilityReport) {
  const publicReport = toStructuredAiVisibilityReport(report);
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${publicReport.brand} AI Visibility Report</title></head>
<body style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5;padding:32px">
<h1>${publicReport.brand} AI Visibility Report</h1>
<h2>${publicReport.overall_score}% - ${publicReport.rating_label}</h2>
<p>${publicReport.rating_description}</p>
<h3>Top Summary</h3>
<p><strong>Technical Audit:</strong> ${publicReport.technical_audit.score}% - Grade ${publicReport.technical_audit.grade} - ${publicReport.technical_audit.issues_found} Issues Found</p>
<p><strong>GEO / AEO Audit:</strong> ${publicReport.geo_aeo_audit.score}% - Grade ${publicReport.geo_aeo_audit.grade} - ${publicReport.geo_aeo_audit.opportunity_counts.high + publicReport.geo_aeo_audit.opportunity_counts.medium + publicReport.geo_aeo_audit.opportunity_counts.low} Opportunities Found</p>
<h3>GEO / AEO Summary</h3>
<p><strong>${publicReport.geo_aeo_audit.score}%</strong> - Grade ${publicReport.geo_aeo_audit.grade} (${publicReport.geo_aeo_audit.grade_description})</p>
<table style="border-collapse:collapse;width:100%">
<thead><tr><th align="left">Category</th><th align="left">Total Checks</th><th align="left">Issues Found</th><th align="left">Score</th><th align="left">Status</th></tr></thead>
<tbody>
${publicReport.geo_aeo_audit.categories.map((category) => `<tr><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.categoryName}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.totalChecks}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0;color:${category.failedChecks > 0 ? "#e95f5c" : "#187c72"};font-weight:700">${category.failedChecks}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.score}%</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.status}</td></tr>`).join("")}
</tbody>
</table>
<h3>Technical Category Summary</h3>
<table style="border-collapse:collapse;width:100%">
<thead><tr><th align="left">Category</th><th align="left">Total Checks</th><th align="left">Issues Found</th><th align="left">Score</th><th align="left">Status</th></tr></thead>
<tbody>
${publicReport.technical_categories.map((category) => `<tr><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.categoryName}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.totalChecks}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0;color:${category.failedChecks > 0 ? "#e95f5c" : "#187c72"};font-weight:700">${category.failedChecks}</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.score}%</td><td style="border-top:1px solid #e5e7eb;padding:8px 0">${category.status}</td></tr>`).join("")}
</tbody>
</table>
</body>
</html>`;
}

function pdfText(value: string | number) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(value: string, maxLength = 88) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function reportToPdf(report: AiVisibilityReport) {
  const publicReport = toStructuredAiVisibilityReport(report);
  const auditGroups = [
    { label: "Technical Audit", categories: publicReport.technical_categories },
    { label: "Indexability", categories: publicReport.indexability_audit.categories },
    { label: "Schema & Structured Data", categories: publicReport.structured_data_audit.categories },
    { label: "On-Page SEO", categories: publicReport.on_page_seo_audit.categories },
    { label: "Image SEO", categories: publicReport.image_seo_audit.categories },
    { label: "E-E-A-T Audit", categories: publicReport.eeat_audit.categories },
    { label: "Trust Signals", categories: publicReport.trust_signals_audit.categories },
    { label: "GEO / AEO Signals", categories: publicReport.geo_aeo_audit.categories }
  ].filter((group) => group.categories.length > 0);
  const allCategories = auditGroups.flatMap((group) => group.categories.map((category) => ({ ...category, group: group.label })));
  const totalIssues = allCategories.reduce((sum, category) => sum + category.failedChecks, 0);
  const priorityIssues = allCategories
    .filter((category) => category.failedChecks > 0)
    .sort((a, b) => b.failedChecks - a.failedChecks || a.score - b.score);
  const scoreTiles = [
    { label: "AI Visibility", score: publicReport.overall_score, issues: totalIssues },
    { label: "Technical Audit", score: publicReport.technical_audit.score, issues: publicReport.technical_audit.issues_found },
    { label: "GEO / AEO Audit", score: publicReport.geo_aeo_audit.score, issues: publicReport.geo_aeo_audit.opportunity_counts.high + publicReport.geo_aeo_audit.opportunity_counts.medium + publicReport.geo_aeo_audit.opportunity_counts.low },
    { label: "Indexability", score: publicReport.indexability_audit.score, issues: publicReport.indexability_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) },
    { label: "Structured Data", score: publicReport.structured_data_audit.score, issues: publicReport.structured_data_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) },
    { label: "On-Page SEO", score: publicReport.on_page_seo_audit.score, issues: publicReport.on_page_seo_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) },
    { label: "Image SEO", score: publicReport.image_seo_audit.score, issues: publicReport.image_seo_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) },
    { label: "E-E-A-T", score: publicReport.eeat_audit.score, issues: publicReport.eeat_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) },
    { label: "Trust Signals", score: publicReport.trust_signals_audit.score, issues: publicReport.trust_signals_audit.categories.reduce((sum, category) => sum + category.failedChecks, 0) }
  ];
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 742;
  const exportedAt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());

  const color = {
    bg: "0.98 0.98 0.98",
    ink: "0.07 0.07 0.07",
    secondary: "0.40 0.40 0.40",
    muted: "0.60 0.60 0.60",
    border: "0.90 0.90 0.90",
    gold: "0.90 0.77 0.42",
    goldDark: "0.54 0.43 0.12",
    goldSoft: "0.99 0.96 0.89",
    teal: "0.12 0.62 0.33",
    tealSoft: "0.92 0.96 0.94",
    coral: "0.86 0.15 0.15",
    coralSoft: "0.99 0.96 0.92",
    cloud: "0.99 0.99 0.99",
    white: "1 1 1"
  };

  const push = (command: string) => commands.push(command);
  const setFill = (rgb: string) => push(`${rgb} rg`);
  const setStroke = (rgb: string) => push(`${rgb} RG`);
  const rect = (x: number, top: number, width: number, height: number, fill: string, stroke?: string) => {
    setFill(fill);
    if (stroke) setStroke(stroke);
    push(`${x} ${top - height} ${width} ${height} re ${stroke ? "B" : "f"}`);
  };
  const roundedRect = (x: number, top: number, width: number, height: number, radius: number, fill: string, stroke?: string) => {
    const right = x + width;
    const bottom = top - height;
    const r = Math.min(radius, width / 2, height / 2);
    const c = r * 0.5522847498;
    setFill(fill);
    if (stroke) setStroke(stroke);
    push([
      `${x + r} ${top} m`,
      `${right - r} ${top} l`,
      `${right - r + c} ${top} ${right} ${top - r + c} ${right} ${top - r} c`,
      `${right} ${bottom + r} l`,
      `${right} ${bottom + r - c} ${right - r + c} ${bottom} ${right - r} ${bottom} c`,
      `${x + r} ${bottom} l`,
      `${x + r - c} ${bottom} ${x} ${bottom + r - c} ${x} ${bottom + r} c`,
      `${x} ${top - r} l`,
      `${x} ${top - r + c} ${x + r - c} ${top} ${x + r} ${top} c`,
      `h ${stroke ? "B" : "f"}`
    ].join(" "));
  };
  const text = (value: string | number, x: number, top: number, size = 10, fill = color.ink, font = "F1") => {
    setFill(fill);
    push(`BT /${font} ${size} Tf ${x} ${top} Td (${pdfText(value)}) Tj ET`);
  };
  const wrapped = (value: string, x: number, top: number, maxLength: number, size = 10, fill = color.ink, font = "F1", lineGap = 14) => {
    const lines = wrapText(value, maxLength);
    lines.forEach((line, index) => text(line, x, top - index * lineGap, size, fill, font));
    return top - Math.max(1, lines.length) * lineGap;
  };
  const watermark = () => {
    setFill("0.88 0.88 0.88");
    push("q 0.707 0.707 -0.707 0.707 186 230 cm BT /F2 54 Tf 0 0 Td (glomaudit.com) Tj ET Q");
  };
  const drawPageChrome = (title = "AI Visibility Report") => {
    rect(0, 792, 612, 792, color.bg);
    watermark();
    text("GLOMAUDIT.COM", 42, 758, 12, color.ink, "F2");
    text(title, 430, 758, 9, color.muted, "F1");
    setStroke(color.border);
    push("42 730 m 570 730 l S");
    setStroke(color.border);
    push("42 44 m 570 44 l S");
    text("GLOMAUDIT.COM", 250, 28, 8, color.muted, "F2");
    y = 700;
  };
  const newPage = (title?: string) => {
    if (commands.length) pages.push(commands);
    commands = [];
    drawPageChrome(title);
  };
  const ensure = (height: number, title?: string) => {
    if (y - height < 56) newPage(title);
  };
  const toneForScore = (score: number) => score < 55 ? color.coral : score < 75 ? color.gold : color.teal;
  const severityFill = (score: number) => score < 70 ? color.goldSoft : "0.995 0.995 0.995";
  const issueLabel = (count: number) => count === 1 ? "1 issue" : `${count} issues`;
  const pill = (value: string, x: number, top: number, width: number, fill = color.goldSoft, textColor = color.ink) => {
    roundedRect(x, top, width, 22, 7, fill, color.border);
    text(value, x + 10, top - 14, 8, textColor, "F2");
  };
  const statCard = (x: number, top: number, width: number, title: string, value: string, note: string, fill = color.white) => {
    roundedRect(x, top, width, 96, 10, fill, color.border);
    text(title, x + 14, top - 20, 9, color.secondary, "F2");
    text(value, x + 14, top - 52, 24, color.ink, "F2");
    wrapped(note, x + 14, top - 72, 30, 8, color.secondary, "F1", 10);
  };
  const sectionTitle = (title: string, subtitle?: string) => {
    ensure(subtitle ? 62 : 36, title);
    text(title, 42, y, 18, color.ink, "F2");
    y -= 18;
    if (subtitle) y = wrapped(subtitle, 42, y, 92, 10, color.secondary, "F1", 13) - 8;
  };
  const categoryRow = (category: { categoryName: string; score: number; failedChecks: number; status: string; group?: string }, index: number, x: number, width: number) => {
    const rowTop = y;
    rect(x, rowTop, width, 32, index % 2 === 0 ? "0.995 0.995 0.995" : color.cloud, color.border);
    text(category.categoryName.slice(0, 44), x + 12, rowTop - 13, 9, color.ink, "F2");
    if (category.group) text(category.group.slice(0, 36), x + 12, rowTop - 25, 7, color.muted, "F1");
    text(`${category.score}%`, x + width - 218, rowTop - 19, 9, toneForScore(category.score), "F2");
    text(issueLabel(category.failedChecks), x + width - 166, rowTop - 19, 9, category.failedChecks > 0 ? color.coral : color.teal, "F2");
    text(category.status, x + width - 94, rowTop - 18, 8, color.muted, "F1");
    y -= 32;
  };
  const issueList = (title: string, items: typeof priorityIssues, x: number, width: number) => {
    ensure(90, title);
    text(title, x, y, 14, color.ink, "F2");
    y -= 20;
    if (!items.length) {
      roundedRect(x, y, width, 38, 9, color.cloud, color.border);
      text("No urgent issues detected in this section.", x + 12, y - 20, 10, color.teal, "F2");
      y -= 52;
      return;
    }
    items.slice(0, 10).forEach((category, index) => {
      ensure(42, title);
      categoryRow(category, index, x, width);
    });
    y -= 4;
  };

  drawPageChrome(`Downloaded ${exportedAt}`);
  roundedRect(42, y, 528, 126, 14, color.ink);
  text("AI VISIBILITY REPORT", 62, y - 28, 9, color.gold, "F2");
  wrapped(publicReport.brand, 62, y - 58, 36, 28, color.white, "F2", 30);
  text(publicReport.url, 62, y - 110, 9, color.muted, "F1");
  roundedRect(430, y - 32, 104, 62, 10, color.gold);
  text("Overall Score", 446, y - 54, 8, color.ink, "F2");
  text(`${publicReport.overall_score}%`, 446, y - 82, 26, color.ink, "F2");
  y -= 160;

  statCard(42, y, 160, "AI Visibility Score", `${publicReport.overall_score}%`, publicReport.rating_label, color.white);
  statCard(224, y, 160, "Open Issues", String(totalIssues), "Prioritized findings across the audit.", color.white);
  statCard(406, y, 164, "AI Citation Readiness", `${publicReport.geo_aeo_audit.score}%`, "GEO, AEO and answer-readiness signals.", color.white);
  y -= 122;

  roundedRect(42, y, 528, 92, 12, color.goldSoft, "0.91 0.83 0.66");
  text("Priority Action", 62, y - 26, 15, color.ink, "F2");
  wrapped(`We identified ${totalIssues} issues that can materially improve AI visibility and citation readiness. Start with crawl access, entity trust, structured data, local discovery, and answer-ready content.`, 62, y - 48, 82, 10, color.ink, "F1", 13);
  y -= 122;

  sectionTitle("Visibility Snapshot", "A board-level summary of how the brand performs across AI visibility, search readiness, trust signals, and technical accessibility.");
  scoreTiles.slice(0, 6).forEach((tile, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    statCard(42 + col * 176, y - row * 110, 160, tile.label, `${tile.score}%`, `${issueLabel(tile.issues)} found`, severityFill(tile.score));
  });
  y -= 236;

  roundedRect(42, y, 528, 62, 12, color.white, color.border);
  text("Want to improve your score?", 62, y - 24, 12, color.ink, "F2");
  wrapped("Request a free AEO, GEO action plan from the Glomaudit team.", 62, y - 42, 74, 9, color.secondary, "F1", 11);
  roundedRect(440, y - 16, 96, 30, 8, color.gold, "0.83 0.69 0.22");
  text("Action Plan", 462, y - 36, 10, color.ink, "F2");

  newPage("AI Readiness");
  sectionTitle("AI Readiness", "Implemented audit signals for citation, crawl, and answer visibility.");
  scoreTiles.slice(3).forEach((tile, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    statCard(42 + col * 176, y - row * 108, 160, tile.label, `${tile.score}%`, `${issueLabel(tile.issues)} found`, severityFill(tile.score));
  });
  y -= 256;

  sectionTitle("Top Issues To Fix First", "These are the highest-friction areas found in the audit. Fixing them first can improve how search engines and AI systems crawl, understand, trust, and recommend the brand.");
  issueList("Priority Findings", priorityIssues, 42, 528);

  if (y < 190) {
    newPage("Audit Categories");
  } else {
    y -= 18;
  }
  sectionTitle("Audit Categories");
  auditGroups.forEach((group) => {
    y -= 8;
    ensure(92, group.label);
    text(group.label, 42, y, 14, color.ink, "F2");
    y -= 24;
    group.categories.forEach((category, index) => {
      ensure(40, group.label);
      rect(42, y, 528, 28, severityFill(category.score), color.border);
      text(category.categoryName.slice(0, 48), 54, y - 18, 9, color.ink, "F2");
      text(`${category.score}%`, 348, y - 18, 9, toneForScore(category.score), "F2");
      text(issueLabel(category.failedChecks), 406, y - 18, 9, category.failedChecks > 0 ? color.coral : color.teal, "F2");
      text(category.status, 482, y - 18, 8, color.muted, "F1");
      y -= 28;
      if (index === group.categories.length - 1) y -= 18;
    });
  });

  if (commands.length) pages.push(commands);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`
  ];

  pages.forEach((pageCommands, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const stream = pageCommands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(""), "latin1");
}
