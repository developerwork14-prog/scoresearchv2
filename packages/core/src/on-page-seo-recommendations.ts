import type { OnPageSeoSeverity, SeoIssueRecommendation } from "./types.js";

const MANUAL_EVIDENCE = "Evidence could not be extracted during crawl. Manual verification required.";

type Guidance = {
  whyItMatters: string;
  howToFix: string;
  bestPracticeExample: string;
  developerNotes: string;
};

const GUIDANCE: Record<string, Guidance> = {
  "Heading Hierarchy No Skips": {
    whyItMatters: "Search engines and AI search systems use the heading outline to identify the primary topic and nested subtopics. Skipped levels make that structure ambiguous. Screen-reader users commonly navigate by headings, and sighted users rely on the same hierarchy to scan the page efficiently.",
    howToFix: "Review each affected heading sequence and make levels increase sequentially. Replace H1→H3 with H1→H2 and H2→H4 with H2→H3. Keep one page-topic H1, use H2 for major sections, and use H3 only for subsections of the preceding H2.",
    bestPracticeExample: "<h1>Enterprise SEO audits</h1><h2>Technical analysis</h2><h3>Crawlability checks</h3>",
    developerNotes: "Do not select heading tags to achieve a font size. Preserve the semantic level in the HTML component and apply visual sizing through CSS classes or design tokens. Add an automated DOM test that rejects adjacent heading-level increases greater than one."
  },
  "Empty Heading Tags": {
    whyItMatters: "Empty headings create blank stops in screen-reader heading navigation and introduce meaningless outline nodes for search engines and AI systems. They also indicate template or content-authoring defects that can disrupt spacing and visual hierarchy.",
    howToFix: "Remove each empty H1-H6 element identified in the evidence, or populate it with a concise heading that accurately labels the following section. If the element exists only to create spacing, replace it with CSS margin or padding.",
    bestPracticeExample: "<section><h2>Technical SEO findings</h2><p>...</p></section>",
    developerNotes: "Prevent heading components from rendering when their trimmed text value is empty. Add a template or component test that rejects empty H1-H6 output, including headings containing only whitespace or non-breaking spaces."
  },
  "Entity Bolding Quality": {
    whyItMatters: "Search engines and AI systems may use semantic emphasis as a supporting content-structure signal, while users rely on emphasis for rapid scanning. Excessive or arbitrary bolding weakens that signal, creates visual noise, and makes important concepts harder to distinguish.",
    howToFix: "Use <strong> only for short, materially important entities, requirements, metrics, or conclusions. Remove emphasis from full sentences, repeated keywords, navigation labels, and decorative text. Use a styled <span> when the weight is visual rather than semantic.",
    bestPracticeExample: "<p>The audit includes <strong>JavaScript rendering analysis</strong> and log-file validation.</p>",
    developerNotes: "Audit rendered <strong> and <b> nodes inside main content. Keep semantic emphasis separate from typography components so a design-system font-weight option does not automatically emit <strong>."
  },
  "HTML Tables for Comparisons": {
    whyItMatters: "Search engines and AI systems extract comparison relationships more reliably when row and column associations are explicit. Screen readers can announce the relevant headers for each cell, and users can compare options without reconstructing relationships from visual cards.",
    howToFix: "Convert genuine two-dimensional comparison data into a semantic <table> with a caption, <thead>, <tbody>, column headers using <th scope=\"col\">, and row headers using <th scope=\"row\">. Do not use tables for layout.",
    bestPracticeExample: "<table><caption>Plan comparison</caption><thead><tr><th scope=\"col\">Feature</th><th scope=\"col\">Enterprise</th></tr></thead><tbody><tr><th scope=\"row\">Log analysis</th><td>Included</td></tr></tbody></table>",
    developerNotes: "Render comparison data from a structured array into native table elements. Preserve the same header-cell relationships at mobile breakpoints; do not replace the table with unlabelled div-based cards."
  },
  "Table Captions": {
    whyItMatters: "A caption programmatically identifies a table before its cells are read. This improves extraction by search and AI systems, orientation for screen-reader users, and comprehension for users scanning several tables.",
    howToFix: "Add a concise <caption> as the first child of each affected table. State what the table compares or measures and include the relevant period or unit when required.",
    bestPracticeExample: "<table><caption>Organic sessions by quarter, 2026</caption>...</table>",
    developerNotes: "Expose a required caption property in the shared table component. If the visual design hides the caption, use a tested visually-hidden utility; never use display:none or aria-hidden."
  },
  "<blockquote>+<cite> for Quotes": {
    whyItMatters: "Semantic quotation and attribution markup helps search engines and AI systems distinguish sourced statements from publisher claims. It improves source transparency, screen-reader interpretation, and user trust.",
    howToFix: "Wrap each standalone quotation in <blockquote> and identify its source with <cite> inside the blockquote or immediately after it. Link the citation to the original source when a URL is available. Use <q> for short inline quotations.",
    bestPracticeExample: "<blockquote><p>Quoted statement.</p><footer>— <cite><a href=\"https://example.com/source\">Source</a></cite></footer></blockquote>",
    developerNotes: "Update quote components to require sourceName and optionally sourceUrl. Emit <blockquote> for the quotation body and <cite> for the source rather than styling a generic div."
  },
  "<dfn> for Key Term Definitions": {
    whyItMatters: "The defining occurrence of a term becomes explicit to browsers, assistive technology, search engines, and AI systems. This reduces ambiguity for specialist terminology and improves user comprehension.",
    howToFix: "Wrap the term—not the entire definition—in <dfn> at its first authoritative definition. Keep the complete plain-language definition in the surrounding sentence. Do not mark every later occurrence.",
    bestPracticeExample: "<p><dfn>Log-file analysis</dfn> is the examination of server requests to understand crawler behavior.</p>",
    developerNotes: "Allow the rich-text or glossary component to emit <dfn>. If the term is an abbreviation, nest <abbr title=\"Expanded term\"> inside <dfn>."
  },
  "<time datetime> on Dates": {
    whyItMatters: "Machine-readable dates help search engines and AI systems distinguish publication, modification, event, and deadline information across locales. They also provide an unambiguous value to assistive technology while preserving a human-readable date.",
    howToFix: "Wrap each meaningful date in <time> and set datetime to a valid ISO 8601 date or timezone-qualified timestamp. Ensure the value matches any corresponding Article or Event structured data.",
    bestPracticeExample: "<p>Updated <time datetime=\"2026-06-20\">20 June 2026</time></p>",
    developerNotes: "Store dates as typed values and format only the visible text. The component must serialize datetime from the source date rather than parsing the localized display string."
  },
  "Breadcrumb Schema-DOM Match": {
    whyItMatters: "Conflicting breadcrumb labels or hierarchy reduce confidence in structured data and may prevent dependable breadcrumb interpretation in search results. AI systems can infer the wrong site relationship, while users see navigation that disagrees with the machine-readable version.",
    howToFix: "Generate the visible breadcrumb and BreadcrumbList JSON-LD from the same ordered data object. Match every label, canonical URL, and position exactly. Start ListItem.position at 1 and include the current page as the final item.",
    bestPracticeExample: "Visible: Home › Services › Technical SEO; schema: positions 1 Home, 2 Services, 3 Technical SEO with matching canonical URLs.",
    developerNotes: "Create one breadcrumb model such as [{name, url}] and pass it to both the UI and JSON-LD serializers. Add a test comparing normalized visible labels and href values with ListItem.name, item, and position."
  },
  "See Also Semantic Paths": {
    whyItMatters: "Clearly labelled related-resource paths help search engines and AI systems discover topic clusters and understand page relationships. They reduce user dead ends and provide predictable navigation for assistive technology.",
    howToFix: "Add a visible related-content section after the main content. Use a descriptive heading, wrap links in <nav aria-labelledby> or <aside>, list multiple resources with <ul>, and use destination-specific anchor text.",
    bestPracticeExample: "<aside><h2 id=\"related\">Related technical SEO guides</h2><nav aria-labelledby=\"related\"><ul><li><a href=\"/guides/log-analysis/\">Log-file analysis guide</a></li></ul></nav></aside>",
    developerNotes: "Build related links from curated page relationships rather than a generic latest-post feed. Ensure links are server-rendered as standard <a href> elements."
  },
  "Contextual Internal Links": {
    whyItMatters: "Contextual links expose deeper URLs, distribute internal authority, and clarify topical relationships for search engines and AI systems. They also let users and screen-reader users continue to a relevant task without relying on global navigation.",
    howToFix: "Add relevant internal links within the body paragraphs identified by the audit. Use descriptive anchor text, point directly to a canonical 200-status URL, and avoid generic anchors, JavaScript-only navigation, redirects, and tracking parameters.",
    bestPracticeExample: "<p>Use the <a href=\"/technical-seo/log-file-analysis/\">log-file analysis methodology</a> to verify crawler behavior.</p>",
    developerNotes: "Render links with native <a href> markup in server output. Validate destination status and canonical URL in the content publishing workflow."
  },
  "Alt Text Non-Empty": {
    whyItMatters: "Alt text gives search engines and AI systems evidence about an image's subject and purpose. It provides equivalent information to screen-reader users and preserves context when images do not load.",
    howToFix: "Add concise, context-specific alt text to each affected meaningful image listed in the evidence. Describe the information or function conveyed by the image. Keep alt=\"\" only for genuinely decorative images and provide adjacent long-form text for complex charts or diagrams.",
    bestPracticeExample: "<img src=\"crawl-trend.webp\" alt=\"Googlebot requests increased from 12,000 to 19,500 per day after migration\">",
    developerNotes: "Make alt mandatory in image components, but allow an explicit decorative flag that emits alt=\"\". Do not derive alt text from filenames. For CMS assets, require authors to choose informative or decorative before publication."
  },
  "Heading Capitalization Consistent": {
    whyItMatters: "Inconsistent capitalization weakens editorial consistency and makes the page outline harder to scan. Search and AI systems receive noisy heading variants, while users—including assistive-technology users navigating by headings—encounter unpredictable section labels.",
    howToFix: "Choose Sentence Case or Title Case and apply it consistently to every conflicting heading shown in the evidence. Preserve official brand and acronym casing. Replace source-text all caps with normally cased text.",
    bestPracticeExample: "Sentence case: “Technical SEO audit process”, “Crawlability findings”, “Implementation plan”.",
    developerNotes: "Normalize heading copy in the CMS or content source. Use CSS text-transform only for visual presentation; keep accessible DOM text in the approved editorial case."
  },
  "H1 Length 20-70 Characters": {
    whyItMatters: "A focused H1 gives search engines and AI systems a strong statement of the page's primary subject. It helps users and screen-reader users confirm they reached the expected page and reduces ambiguity in the page outline.",
    howToFix: "Replace the affected H1 with one descriptive heading between 20 and 70 characters. Put the primary topic near the beginning, remove boilerplate and stacked keyword variants, and move secondary benefits into the introduction or H2 sections.",
    bestPracticeExample: "<h1>Enterprise technical SEO audit services</h1>",
    developerNotes: "Enforce exactly one content H1 in the page template and add a CMS validation rule for 20-70 Unicode characters after trimming whitespace. Do not truncate the H1 with CSS as a substitute for editing the source."
  }
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function affectedPagesFromEvidence(evidence: Record<string, unknown>) {
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value) && !urls.includes(value)) {
      urls.push(value);
    }
  };
  add(evidence.pageUrl);
  if (Array.isArray(evidence.affectedPages)) {
    for (const item of evidence.affectedPages) {
      const entry = record(item);
      add(entry?.url);
    }
  }
  return urls;
}

function exactEvidence(evidence: Record<string, unknown>) {
  if (Array.isArray(evidence.affectedPages) && evidence.affectedPages.length) {
    return {
      pagesCrawled: evidence.pagesCrawled,
      pagesChecked: evidence.pagesChecked,
      pagesFailed: evidence.pagesFailed,
      affectedPages: evidence.affectedPages
    };
  }
  if (Object.keys(evidence).length) return evidence;
  return { message: MANUAL_EVIDENCE };
}

function evidenceAvailable(evidence: Record<string, unknown>) {
  if (!Object.keys(evidence).length) return false;
  if (Array.isArray(evidence.affectedPages) && Number(evidence.pagesFailed) > 0) {
    return evidence.affectedPages.length > 0;
  }
  return true;
}

function failedSamples(evidence: Record<string, unknown>) {
  if (!Array.isArray(evidence.affectedPages)) return [evidence];
  return evidence.affectedPages
    .map((item) => record(item)?.sampleEvidence)
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function quotedList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item)).map((item) => `"${item}"`).join(", ")
    : "";
}

function sampleFailurePattern(checkName: string, sample: Record<string, unknown>) {
  if (checkName === "Heading Hierarchy No Skips") {
    const sequence = Array.isArray(sample.headingSequence) ? sample.headingSequence.join(" → ") : "";
    const problem = typeof sample.problem === "string" ? sample.problem : "";
    return sequence && problem
      ? `${sequence}: ${problem}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Breadcrumb Schema-DOM Match") {
    const visible = quotedList(sample.visibleBreadcrumb);
    const schema = quotedList(sample.schemaBreadcrumb);
    if (sample.issue === "Visible Breadcrumb Missing") {
      return schema
        ? `Schema breadcrumb [${schema}] exists, but the visible breadcrumb is missing`
        : MANUAL_EVIDENCE;
    }
    return visible || schema
      ? `Visible [${visible || "not extracted"}] differs from schema [${schema || "not extracted"}]`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Empty Heading Tags") {
    const count = Number(sample.emptyHeadingCount);
    const headings = Array.isArray(sample.emptyHeadings)
      ? sample.emptyHeadings.map((item) => record(item)?.level).filter(Boolean).join(", ")
      : "";
    return Number.isFinite(count)
      ? `${count} empty heading tag${count === 1 ? "" : "s"} in primary content${headings ? ` (${headings})` : ""}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Heading Capitalization Consistent") {
    const groups = [
      ["Title Case", quotedList(sample.titleCase)],
      ["sentence case", quotedList(sample.sentenceCase)],
      ["ALL CAPS", quotedList(sample.allCaps)],
      ["mixed case", quotedList(sample.mixed)]
    ].filter(([, values]) => values);
    return groups.length > 1
      ? groups.map(([label, values]) => `${label}: ${values}`).join("; ")
      : MANUAL_EVIDENCE;
  }
  if (checkName === "H1 Length 20-70 Characters") {
    const h1 = typeof sample.h1 === "string" ? sample.h1 : "";
    const length = Number(sample.length);
    return Number.isFinite(length)
      ? `H1 "${h1}" is ${length} characters; required range is 20-70`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Alt Text Non-Empty") {
    const missing = Number(sample.missingAlt);
    return Number.isFinite(missing)
      ? `${missing} meaningful image${missing === 1 ? "" : "s"} with missing or empty alt text`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Contextual Internal Links") {
    const links = Number(sample.contextualInternalLinks);
    return Number.isFinite(links)
      ? `${links} qualifying contextual internal link${links === 1 ? "" : "s"} in main paragraph content`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Table Captions") {
    const tables = Number(sample.tables);
    const captions = Number(sample.captions);
    return Number.isFinite(tables) && Number.isFinite(captions)
      ? `${tables} table${tables === 1 ? "" : "s"} with ${captions} caption${captions === 1 ? "" : "s"}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "HTML Tables for Comparisons") {
    const tables = Number(sample.tables);
    return sample.comparisonIntent === true && Number.isFinite(tables)
      ? `Comparison intent detected with ${tables} qualifying comparison table${tables === 1 ? "" : "s"}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "<blockquote>+<cite> for Quotes") {
    const quotes = Number(sample.blockquotes);
    return Number.isFinite(quotes)
      ? `${quotes} blockquote element${quotes === 1 ? "" : "s"} without complete citation coverage`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "<dfn> for Key Term Definitions") {
    const definitions = Number(sample.definitions ?? sample.dfnCount);
    return Number.isFinite(definitions)
      ? `Definition-style content with ${definitions} populated <dfn> element${definitions === 1 ? "" : "s"}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "<time datetime> on Dates") {
    const dates = Number(sample.dateTextCount);
    const times = Number(sample.timeDatetimeCount);
    return Number.isFinite(dates) && Number.isFinite(times)
      ? `${dates} visible date${dates === 1 ? "" : "s"} with ${times} populated <time datetime> element${times === 1 ? "" : "s"}`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "See Also Semantic Paths") {
    const links = Number(sample.seeAlsoLinks);
    return Number.isFinite(links)
      ? `${links} clearly labelled related-resource link${links === 1 ? "" : "s"} on long-form content`
      : MANUAL_EVIDENCE;
  }
  if (checkName === "Entity Bolding Quality") {
    const density = Number(sample.boldDensity);
    const phrases = Number(sample.boldPhrases);
    return Number.isFinite(density) && Number.isFinite(phrases)
      ? `${phrases} bold phrase${phrases === 1 ? "" : "s"} at ${density}% bold-text density`
      : MANUAL_EVIDENCE;
  }
  return MANUAL_EVIDENCE;
}

function plainIssueSummary(checkName: string, evidence: Record<string, unknown>) {
  const sample = failedSamples(evidence)[0];
  if (!sample) return MANUAL_EVIDENCE;
  if (checkName === "Heading Hierarchy No Skips") return "Heading levels skip an intermediate level within primary page content.";
  if (checkName === "Empty Heading Tags") return "Primary content contains heading elements without readable text.";
  if (checkName === "Breadcrumb Schema-DOM Match") {
    return sample.issue === "Visible Breadcrumb Missing"
      ? "Structured breadcrumb data exists, but users are not shown a visible breadcrumb trail."
      : "Visible breadcrumb labels or hierarchy differ from the structured breadcrumb data.";
  }
  if (checkName === "Heading Capitalization Consistent") return "The page mixes multiple heading-capitalization conventions.";
  if (checkName === "H1 Length 20-70 Characters") return "The primary heading falls outside the configured clarity range.";
  if (checkName === "Alt Text Non-Empty") return "Meaningful images are missing usable alternative text.";
  if (checkName === "Contextual Internal Links") return "Main content contains too few relevant contextual internal links.";
  if (checkName === "Table Captions") return "One or more data tables do not provide a descriptive caption.";
  if (checkName === "HTML Tables for Comparisons") return "Comparison content is not represented with a semantic data table.";
  if (checkName === "<blockquote>+<cite> for Quotes") return "Quoted content does not provide complete semantic attribution.";
  if (checkName === "<dfn> for Key Term Definitions") return "Definition-style content does not identify the defining term semantically.";
  if (checkName === "<time datetime> on Dates") return "Visible dates are missing corresponding machine-readable date values.";
  if (checkName === "See Also Semantic Paths") return "Long-form content lacks a clearly labelled path to related resources.";
  if (checkName === "Entity Bolding Quality") return "Semantic emphasis is overused or applied to low-value phrases.";
  return "The audited parameter failed on one or more analyzed pages.";
}

function representativeExample(checkName: string, evidence: Record<string, unknown>) {
  const sample = failedSamples(evidence)[0];
  if (!sample) return MANUAL_EVIDENCE;
  if (checkName === "Heading Hierarchy No Skips") {
    const skips = Array.isArray(sample.headings) ? sample.headings.length : 0;
    return `A sampled page contains a heading-level jump in primary content${skips ? ` across ${skips} extracted headings` : ""}.`;
  }
  if (checkName === "Breadcrumb Schema-DOM Match") {
    return sample.issue === "Visible Breadcrumb Missing"
      ? "A sampled page contains breadcrumb schema but no visible breadcrumb navigation."
      : "A sampled page uses different labels in visible and structured breadcrumbs.";
  }
  if (checkName === "Heading Capitalization Consistent") return "A sampled page mixes sentence case, title case, or all-capital headings.";
  if (checkName === "H1 Length 20-70 Characters") {
    const length = Number(sample.length);
    return Number.isFinite(length)
      ? `A sampled page has a primary heading of ${length} characters.`
      : "A sampled page has a primary heading outside the accepted range.";
  }
  if (checkName === "Empty Heading Tags") {
    const count = Number(sample.emptyHeadingCount);
    return Number.isFinite(count)
      ? `A sampled page contains ${count} empty heading tag${count === 1 ? "" : "s"}.`
      : "A sampled page contains an empty heading tag.";
  }
  const pattern = sampleFailurePattern(checkName, sample);
  return pattern === MANUAL_EVIDENCE ? pattern : `${pattern}.`;
}

function expectedOutcome(checkName: string) {
  if (/Heading Hierarchy|Empty Heading/.test(checkName)) return "A clean primary-content outline with predictable heading navigation.";
  if (/Breadcrumb/.test(checkName)) return "Visible and structured navigation provide one consistent hierarchy.";
  if (/Capitalization/.test(checkName)) return "Headings follow one consistent editorial convention.";
  if (/H1 Length/.test(checkName)) return "The primary heading clearly communicates page topic and intent.";
  if (/Alt Text/.test(checkName)) return "Meaningful images provide equivalent context to crawlers and assistive technology.";
  if (/Internal Links|See Also/.test(checkName)) return "Users and crawlers can discover relevant supporting pages more reliably.";
  if (/Table/.test(checkName)) return "Comparison data becomes easier to extract, navigate, and understand.";
  return "The affected content provides clearer semantic structure for search, AI systems, and users.";
}

function priorityForSeverity(severity: OnPageSeoSeverity) {
  if (severity === "Critical" || severity === "High") return "High";
  if (severity === "Medium") return "Medium";
  return "Low";
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function affectedRate(evidence: Record<string, unknown>) {
  const analyzed = count(evidence.pagesChecked);
  const affected = count(evidence.pagesFailed) ?? affectedPagesFromEvidence(evidence).length;
  return analyzed && analyzed > 0 ? Math.round((affected / analyzed) * 1000) / 10 : 0;
}

function businessImpact(checkName: string) {
  if (/Heading|H1|Definition|Bolding/.test(checkName)) {
    return "Weak semantic structure can reduce topical clarity, make content harder to scan, and lower engagement or conversion confidence.";
  }
  if (/Breadcrumb|Internal Links|See Also/.test(checkName)) {
    return "Poor navigation signals can weaken crawl paths and internal authority flow, reducing discovery, rankings, and user progression.";
  }
  if (/Alt Text/.test(checkName)) {
    return "Missing image context can reduce image-search visibility, accessibility, user trust, and comprehension of conversion-critical content.";
  }
  if (/Table/.test(checkName)) {
    return "Unclear comparison structure can make key product or service information harder to understand, reducing trust and conversion efficiency.";
  }
  return "The issue can weaken content understanding, organic visibility, user trust, and the ability of visitors to complete their intended task.";
}

function aiVisibilityImpact(checkName: string) {
  if (/Breadcrumb|Internal Links|See Also/.test(checkName)) {
    return "ChatGPT, Gemini, and Google AI Overviews may infer weaker page relationships and overlook supporting content.";
  }
  if (/Alt Text/.test(checkName)) {
    return "AI answer engines may receive less context about meaningful images, reducing confidence when interpreting or citing visual information.";
  }
  if (/Table/.test(checkName)) {
    return "AI answer engines may extract comparisons less reliably when row, column, and caption relationships are not explicit.";
  }
  return "AI answer engines may interpret the page topic and supporting facts with less confidence, which can reduce inclusion, summarization, or citation potential.";
}

function actionableSteps(howToFix: string) {
  return howToFix
    .split(/(?<=[.!?])\s+/)
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function sentenceLimit(value: string, max: number) {
  return value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).slice(0, max).join(" ");
}

function topFixCandidates(evidence: Record<string, unknown>) {
  return affectedPagesFromEvidence(evidence).slice(0, 3);
}

function detectionConfidence(evidence: Record<string, unknown>) {
  const samples = failedSamples(evidence);
  if (samples.length) return { score: 95, reason: "The issue was confirmed on sampled affected pages." };
  if (count(evidence.pagesChecked) !== null && count(evidence.pagesFailed) !== null) {
    return { score: 78, reason: "Page-level counts were available, but no representative failure sample was extracted." };
  }
  return { score: 60, reason: "The crawl did not provide enough page-level evidence for high-confidence validation." };
}

function shorten(value: string, max = 150) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function whatWeChecked(checkName: string, evidence: Record<string, unknown>) {
  const pagesCrawled = Number(evidence.pagesCrawled);
  const pagesChecked = Number(evidence.pagesChecked);
  const pagesAffected = Number(evidence.pagesFailed);
  const affectedPages = affectedPagesFromEvidence(evidence);
  const rate = affectedRate(evidence);
  return [
    `Pages crawled: ${Number.isFinite(pagesCrawled) ? pagesCrawled : "Unavailable"}`,
    `Pages analyzed: ${Number.isFinite(pagesChecked) ? pagesChecked : "Unavailable"}`,
    `Pages affected: ${Number.isFinite(pagesAffected) ? pagesAffected : affectedPages.length}`,
    `Affected rate: ${rate}% (${Number.isFinite(pagesAffected) ? pagesAffected : affectedPages.length} of ${Number.isFinite(pagesChecked) ? pagesChecked : "Unavailable"} pages)`,
    `Most common issue: ${plainIssueSummary(checkName, evidence)}`,
    `Expected outcome: ${expectedOutcome(checkName)}`
  ].map((line) => shorten(line));
}

export function onPageSeoRecommendation(
  checkName: string,
  severity: OnPageSeoSeverity,
  evidence: Record<string, unknown>
): SeoIssueRecommendation {
  const guidance = GUIDANCE[checkName];
  if (!guidance) throw new Error(`Missing On-Page SEO recommendation for check: ${checkName}`);
  const hasEvidence = evidenceAvailable(evidence);
  const sample = failedSamples(evidence)[0];
  const issue = checkName === "Breadcrumb Schema-DOM Match" && typeof sample?.issue === "string"
    ? sample.issue
    : checkName;
  const summary = plainIssueSummary(checkName, evidence);
  const pagesCrawled = count(evidence.pagesCrawled);
  const pagesAnalyzed = count(evidence.pagesChecked);
  const pagesAffected = count(evidence.pagesFailed) ?? affectedPagesFromEvidence(evidence).length;
  const rate = affectedRate(evidence);
  const confidence = detectionConfidence(evidence);
  const technicalEvidence = exactEvidence(evidence);
  return {
    issue,
    issueSummary: summary,
    severity,
    priority: priorityForSeverity(severity),
    affectedRate: rate,
    affectedPages: affectedPagesFromEvidence(evidence),
    whatIsWrong: hasEvidence ? summary : MANUAL_EVIDENCE,
    whyItMatters: sentenceLimit(guidance.whyItMatters, 2),
    businessImpact: businessImpact(checkName),
    aiVisibilityImpact: aiVisibilityImpact(checkName),
    recommendedFix: hasEvidence ? actionableSteps(guidance.howToFix) : [MANUAL_EVIDENCE],
    validationSummary: {
      pagesCrawled,
      pagesAnalyzed,
      pagesAffected,
      affectedRate: rate,
      mostCommonIssue: summary,
      expectedOutcome: expectedOutcome(checkName)
    },
    detectionConfidence: confidence.score < 80 ? confidence : undefined,
    topFixCandidates: topFixCandidates(evidence),
    technicalEvidence,
    whatWeChecked: whatWeChecked(checkName, evidence),
    rawEvidence: technicalEvidence,
    howToFix: hasEvidence ? guidance.howToFix : MANUAL_EVIDENCE,
    bestPracticeExample: guidance.bestPracticeExample,
    developerNotes: hasEvidence ? guidance.developerNotes : MANUAL_EVIDENCE
  };
}
