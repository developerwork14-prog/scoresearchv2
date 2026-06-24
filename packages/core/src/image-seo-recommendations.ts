import type { ImageSeoSeverity, SeoIssueRecommendation } from "./types.js";

type Guidance = {
  issueSummary: string;
  whyItMatters: string;
  businessImpact: string;
  aiVisibilityImpact: string;
  fixes: string[];
  implementationGuide: string;
  expectedOutcome: string;
};

const GUIDANCE: Record<string, Guidance> = {
  "Meaningful Images Have Alt Text": {
    issueSummary: "Meaningful images are missing usable alternative text.",
    whyItMatters: "Alternative text communicates an image’s subject or function to search engines and assistive technology.",
    businessImpact: "Missing descriptions can reduce image-search visibility, accessibility, user comprehension, and conversion confidence.",
    aiVisibilityImpact: "AI answer engines receive less evidence about visual content and may interpret affected pages with lower confidence.",
    fixes: [
      "Add concise, descriptive alt text to meaningful images.",
      "Use alt=\"\" for images that are genuinely decorative.",
      "Describe complex charts or diagrams in adjacent visible HTML."
    ],
    implementationGuide: "Update the image field in the CMS or component. Keep existing classes and URLs unchanged; set an explicit empty alt value only for decorative assets.",
    expectedOutcome: "Every meaningful image has context-specific alt text while decorative images use alt=\"\"."
  },
  "WebP/AVIF >=70%": {
    issueSummary: "Too few eligible images use WebP or AVIF.",
    whyItMatters: "Modern image formats usually deliver equivalent visual quality with fewer transferred bytes.",
    businessImpact: "Oversized JPEG and PNG assets can slow rendering, weaken Core Web Vitals, and reduce engagement or conversions.",
    aiVisibilityImpact: "Faster, more accessible pages are easier for search and AI systems to retrieve and process reliably.",
    fixes: [
      "Convert eligible JPEG and PNG assets to WebP or AVIF.",
      "Serve next-generation formats through the CDN, image plugin, or build pipeline.",
      "Reach at least 70% modern-format coverage for eligible meaningful images."
    ],
    implementationGuide: "Enable WebP/AVIF generation in the CMS or CDN and update rendered image sources while retaining compatible fallbacks where necessary.",
    expectedOutcome: "At least 70% of eligible meaningful raster images use WebP or AVIF."
  },
  "LCP Image Preloaded": {
    issueSummary: "The primary LCP image could not be verified as preloaded.",
    whyItMatters: "Preloading the true LCP image can reduce the delay before the browser discovers and downloads the most important visual.",
    businessImpact: "A delayed hero image can worsen LCP, user perception, engagement, and conversion performance.",
    aiVisibilityImpact: "Poor rendering performance can reduce crawl efficiency and the quality signals associated with the page experience.",
    fixes: [
      "Identify the actual LCP image using field performance data.",
      "Preload only the confirmed LCP image.",
      "Do not preload decorative or below-the-fold images."
    ],
    implementationGuide: "Use PageSpeed Insights or browser performance tooling to confirm the LCP element, then add one matching image preload in the document head.",
    expectedOutcome: "The confirmed LCP image is discovered early without unnecessary image preloads."
  },
  "<picture> with WebP+Fallback": {
    issueSummary: "Picture elements do not consistently provide a modern source and fallback image.",
    whyItMatters: "A well-formed picture element lets capable browsers use modern formats while preserving compatibility.",
    businessImpact: "Incomplete picture markup can create unnecessary image weight or broken rendering in some browsers.",
    aiVisibilityImpact: "Reliable image delivery helps crawlers and AI systems retrieve the same meaningful visual content users receive.",
    fixes: [
      "Add a WebP or AVIF source to affected picture elements.",
      "Retain an img fallback with explicit dimensions.",
      "Verify every source resolves successfully."
    ],
    implementationGuide: "Update the shared picture component so modern source elements precede the fallback img element.",
    expectedOutcome: "Every audited picture element provides a modern format and a working fallback."
  },
  "Stable Image URLs": {
    issueSummary: "Image URLs contain unstable cache-busting parameters.",
    whyItMatters: "Frequently changing image URLs fragment crawling, caching, and image indexing signals.",
    businessImpact: "Unstable URLs can increase bandwidth, weaken cache efficiency, and delay image-search consolidation.",
    aiVisibilityImpact: "AI and search crawlers may treat changing asset URLs as separate resources, reducing confidence and reuse.",
    fixes: [
      "Remove volatile timestamp or random query parameters from image URLs.",
      "Use stable, versioned filenames when an asset changes.",
      "Update templates and CDN rules to emit canonical asset URLs."
    ],
    implementationGuide: "Replace runtime cache-buster parameters with content-hashed or versioned filenames managed by the build pipeline or CDN.",
    expectedOutcome: "Image assets use stable crawlable URLs that change only when the underlying file changes."
  },
  "Native Lazy Loading (Not JS)": {
    issueSummary: "Below-the-fold images are missing appropriate native lazy loading.",
    whyItMatters: "Native lazy loading defers non-critical image downloads without depending on JavaScript.",
    businessImpact: "Loading every image immediately can waste bandwidth, delay interactivity, and weaken conversion performance on mobile devices.",
    aiVisibilityImpact: "Efficient loading improves page rendering stability and makes important content easier for crawlers to process.",
    fixes: [
      "Add loading=\"lazy\" to below-the-fold images.",
      "Keep the LCP, hero, logo, and first-viewport images eager.",
      "Replace JavaScript-only lazy loading where native loading is sufficient."
    ],
    implementationGuide: "Apply loading=\"lazy\" in the shared image component only when the image is not marked as hero, priority, logo, or above the fold.",
    expectedOutcome: "Below-the-fold images use native lazy loading while critical first-viewport images remain eager."
  },
  "Responsive srcset+sizes": {
    issueSummary: "Eligible responsive images are missing srcset or sizes attributes.",
    whyItMatters: "Responsive image markup lets browsers choose an appropriately sized asset for each viewport.",
    businessImpact: "Serving desktop-sized images to small screens increases transfer weight and can worsen user experience and conversions.",
    aiVisibilityImpact: "Efficient responsive delivery supports faster rendering and more dependable crawler access.",
    fixes: [
      "Generate multiple width variants for eligible raster images.",
      "Add srcset with width descriptors.",
      "Add a sizes rule matching the rendered layout."
    ],
    implementationGuide: "Configure the CMS image helper or framework component to emit width variants, srcset, and sizes automatically for images wider than 150px.",
    expectedOutcome: "Eligible raster images provide responsive candidates and accurate viewport sizing rules."
  },
  "Descriptive File Names": {
    issueSummary: "Meaningful first-party images use generic filenames.",
    whyItMatters: "Descriptive filenames provide a supporting clue about an image’s subject and simplify asset management.",
    businessImpact: "Generic filenames weaken image-search context and make editorial maintenance more error-prone.",
    aiVisibilityImpact: "Clear first-party asset naming provides additional context when AI and search systems interpret visual resources.",
    fixes: [
      "Rename generic first-party image files before upload.",
      "Use short words describing the actual visual subject.",
      "Update page references and redirects where existing indexed image URLs change."
    ],
    implementationGuide: "Rename the original media asset in the CMS or storage layer, regenerate derivatives, and update references without using keywords unrelated to the image.",
    expectedOutcome: "Meaningful first-party images use stable filenames that describe their visible subject."
  },
  "OCR-HTML Data Parity": {
    issueSummary: "Text inside images could not be compared with visible HTML.",
    whyItMatters: "Important text embedded only in images may be inaccessible to users, crawlers, and assistive technology.",
    businessImpact: "Unverified image text can hide product details, pricing, or instructions and reduce trust or conversions.",
    aiVisibilityImpact: "AI systems may miss or misinterpret facts that are not also available as machine-readable HTML.",
    fixes: [
      "Run OCR on data-heavy images.",
      "Compare extracted text with nearby visible HTML.",
      "Add any missing important information as normal page text."
    ],
    implementationGuide: "Manually review charts, screenshots, and infographics or connect an OCR service before treating this check as confirmed.",
    expectedOutcome: "Important text shown in images is also available accurately in visible HTML."
  },
  "No Key Data as Image-Only": {
    issueSummary: "Images may contain key data that is not available in HTML.",
    whyItMatters: "Image-only facts are difficult for assistive technology and crawlers to retrieve reliably.",
    businessImpact: "Users can miss prices, instructions, comparisons, or evidence, reducing usability and conversion confidence.",
    aiVisibilityImpact: "AI answer engines may omit facts that exist only in pixels instead of machine-readable content.",
    fixes: [
      "Repeat important image-based facts as visible HTML.",
      "Provide a text summary for charts, tables, and infographics.",
      "Verify the HTML and image communicate the same values."
    ],
    implementationGuide: "Review the flagged visual manually and add a nearby paragraph, list, or semantic table containing the same key information.",
    expectedOutcome: "No critical fact depends exclusively on an image."
  },
  "No Images Blocking Text": {
    issueSummary: "Image overlap with readable text could not be verified statically.",
    whyItMatters: "Images that obscure text create accessibility and usability failures across devices.",
    businessImpact: "Blocked content can prevent users from understanding offers or completing conversion actions.",
    aiVisibilityImpact: "Layout failures can reduce rendered-content quality even when the underlying HTML remains crawlable.",
    fixes: [
      "Inspect key templates at mobile, tablet, and desktop widths.",
      "Correct overlapping positioning or z-index rules.",
      "Retest zoom and text-resizing behavior."
    ],
    implementationGuide: "Use browser responsive mode and accessibility zoom testing; static HTML alone cannot confirm visual overlap.",
    expectedOutcome: "Images never obscure readable text or interactive controls at supported viewport sizes."
  },
  "SVG <title>+<desc>": {
    issueSummary: "Meaningful inline SVG graphics are missing accessible descriptions.",
    whyItMatters: "Title and description elements communicate the purpose of informational SVG graphics to assistive technology.",
    businessImpact: "Unlabelled diagrams and illustrations reduce accessibility, comprehension, and user trust.",
    aiVisibilityImpact: "Machine-readable SVG descriptions give AI and search systems clearer context about meaningful graphics.",
    fixes: [
      "Add a concise title element to each meaningful inline SVG.",
      "Add a desc element explaining the graphic’s purpose.",
      "Leave decorative icons hidden from assistive technology instead."
    ],
    implementationGuide: "Update the SVG component to require title and description values for informational graphics; decorative icons should use aria-hidden=\"true\".",
    expectedOutcome: "Meaningful SVG graphics expose accessible titles and descriptions while decorative icons remain excluded."
  },
  "ImageObject Schema": {
    issueSummary: "Content pages use meaningful images without corresponding ImageObject schema.",
    whyItMatters: "ImageObject markup can clarify the primary image URL, caption, and relationship to article or content entities.",
    businessImpact: "Missing image metadata can reduce eligibility for enhanced image understanding and rich discovery surfaces.",
    aiVisibilityImpact: "AI systems receive weaker structured context connecting important images to the page’s content entity.",
    fixes: [
      "Add ImageObject JSON-LD for primary article or content images.",
      "Use the canonical contentUrl and a visible, accurate caption.",
      "Do not create ImageObject entities for logos, icons, UI assets, or decorative graphics."
    ],
    implementationGuide: "Connect the page’s primary content-image field to the Article or WebPage schema generator and emit matching ImageObject data.",
    expectedOutcome: "Primary meaningful content images are represented accurately in structured data."
  }
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function samples(evidence: Record<string, unknown>) {
  if (!Array.isArray(evidence.affectedPages)) return [evidence];
  return evidence.affectedPages.map((item) => record(item)?.sampleEvidence).map(record).filter(Boolean) as Record<string, unknown>[];
}

function sum(evidence: Record<string, unknown>, keys: string[]) {
  return samples(evidence).reduce((total, sample) => {
    for (const key of keys) {
      const value = Number(sample[key]);
      if (Number.isFinite(value)) return total + value;
    }
    return total;
  }, 0);
}

function affectedPageUrls(evidence: Record<string, unknown>) {
  if (!Array.isArray(evidence.affectedPages)) return [];
  return evidence.affectedPages
    .map((item) => record(item)?.url)
    .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url));
}

function templateEvidencePages(evidence: Record<string, unknown>) {
  if (!Array.isArray(evidence.allAffectedPageUrls)) return affectedPageUrls(evidence);
  return evidence.allAffectedPageUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url));
}

function affectedAssetRecords(evidence: Record<string, unknown>) {
  if (!Array.isArray(evidence.affectedAssets)) return [];
  return evidence.affectedAssets
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function affectedAssetNames(evidence: Record<string, unknown>) {
  return affectedAssetRecords(evidence)
    .map((item) => String(item.assetName ?? item.assetUrl ?? ""))
    .filter(Boolean);
}

function levelValue(level: "Low" | "Medium" | "High") {
  return level === "High" ? 3 : level === "Medium" ? 2 : 1;
}

function impactLevel(checkName: string): "Low" | "Medium" | "High" {
  if (["Meaningful Images Have Alt Text", "Native Lazy Loading (Not JS)", "No Key Data as Image-Only"].includes(checkName)) return "High";
  if (["WebP/AVIF >=70%", "Responsive srcset+sizes", "SVG <title>+<desc>", "ImageObject Schema"].includes(checkName)) return "Medium";
  return "Low";
}

function effortLevel(checkName: string): "Low" | "Medium" | "High" {
  if (["Meaningful Images Have Alt Text", "Native Lazy Loading (Not JS)", "SVG <title>+<desc>"].includes(checkName)) return "Low";
  if (["Responsive srcset+sizes", "WebP/AVIF >=70%", "Descriptive File Names", "ImageObject Schema"].includes(checkName)) return "Medium";
  return "High";
}

function scaleLevel(rate: number): "Low" | "Medium" | "High" {
  if (rate >= 50) return "High";
  if (rate >= 15) return "Medium";
  return "Low";
}

function priorityScore(impact: "Low" | "Medium" | "High", scale: "Low" | "Medium" | "High", effort: "Low" | "Medium" | "High") {
  const impactScore = levelValue(impact) / 3;
  const scaleScore = levelValue(scale) / 3;
  const easeScore = (4 - levelValue(effort)) / 3;
  return Math.round(impactScore * scaleScore * easeScore * 100);
}

function boundedPriorityScore(checkName: string, score: number) {
  const ranges: Record<string, [number, number]> = {
    "Meaningful Images Have Alt Text": [60, 80],
    "WebP/AVIF >=70%": [50, 75],
    "Native Lazy Loading (Not JS)": [45, 70],
    "Responsive srcset+sizes": [50, 70],
    "Descriptive File Names": [10, 40],
    "SVG <title>+<desc>": [30, 60],
    "ImageObject Schema": [30, 60]
  };
  const [min, max] = ranges[checkName] ?? [10, 80];
  return Math.max(min, Math.min(max, score));
}

function metrics(evidence: Record<string, unknown>) {
  const pagesCrawled = Number(evidence.pagesCrawled);
  const pagesAnalyzed = Number(evidence.pagesChecked);
  const pagesAffected = Number(evidence.pagesFailed);
  const analyzed = Number.isFinite(pagesAnalyzed) ? pagesAnalyzed : 0;
  const affected = Number.isFinite(pagesAffected) ? pagesAffected : 0;
  return {
    pagesCrawled: Number.isFinite(pagesCrawled) ? pagesCrawled : null,
    pagesAnalyzed: Number.isFinite(pagesAnalyzed) ? pagesAnalyzed : null,
    pagesAffected: affected,
    affectedRate: analyzed > 0 ? Math.round((affected / analyzed) * 1000) / 10 : 0
  };
}

function whatIsWrong(checkName: string, evidence: Record<string, unknown>) {
  if (checkName === "Meaningful Images Have Alt Text") {
    return `${sum(evidence, ["missingAlt"])} meaningful image instances are missing alt text.`;
  }
  if (checkName === "WebP/AVIF >=70%") {
    const images = sum(evidence, ["images"]);
    const modern = sum(evidence, ["modernImages"]);
    const rate = images ? Math.round((modern / images) * 100) : 0;
    return `Only ${rate}% of ${images} eligible analyzed image instances use WebP or AVIF.`;
  }
  if (checkName === "Native Lazy Loading (Not JS)") {
    const pageMetrics = metrics(evidence);
    return `${pageMetrics.pagesAffected} analyzed page${pageMetrics.pagesAffected === 1 ? "" : "s"} contain below-the-fold images without appropriate native lazy loading.`;
  }
  if (checkName === "Responsive srcset+sizes") {
    const images = sum(evidence, ["images"]);
    const responsive = sum(evidence, ["responsive"]);
    return `${Math.max(0, images - responsive)} eligible image instances are missing srcset or sizes attributes.`;
  }
  if (checkName === "Descriptive File Names") {
    return `${sum(evidence, ["nonDescriptiveCount"])} meaningful first-party image instances use generic filenames.`;
  }
  if (checkName === "SVG <title>+<desc>") {
    return `${sum(evidence, ["missingTitleOrDescription"])} meaningful inline SVG graphics are missing a title or description.`;
  }
  if (checkName === "ImageObject Schema") {
    const pageMetrics = metrics(evidence);
    return `${pageMetrics.pagesAffected} content page${pageMetrics.pagesAffected === 1 ? "" : "s"} use meaningful images without matching ImageObject schema.`;
  }
  return GUIDANCE[checkName]?.issueSummary ?? "The collected image evidence requires review.";
}

function confidence(checkName: string, evidence: Record<string, unknown>) {
  if (["LCP Image Preloaded", "OCR-HTML Data Parity", "No Key Data as Image-Only", "No Images Blocking Text"].includes(checkName)) {
    return { score: 55, reason: "Evidence requires rendered-page, field-performance, OCR, or visual validation. Manual verification recommended." };
  }
  const pageMetrics = metrics(evidence);
  const sampleCount = samples(evidence).length;
  const assetCount = Number(evidence.uniqueAssetsAffected);
  const coverage = pageMetrics.pagesAnalyzed && pageMetrics.pagesCrawled
    ? pageMetrics.pagesAnalyzed / pageMetrics.pagesCrawled
    : 0;
  const checkBase: Record<string, number> = {
    "Meaningful Images Have Alt Text": 98,
    "WebP/AVIF >=70%": 96,
    "Native Lazy Loading (Not JS)": 78,
    "Responsive srcset+sizes": 94,
    "Descriptive File Names": 95,
    "SVG <title>+<desc>": 78,
    "ImageObject Schema": 82
  };
  let score = checkBase[checkName] ?? 80;
  if (coverage < 0.8) score -= 8;
  if (!sampleCount) score -= 5;
  if (!Number.isFinite(assetCount) && !["ImageObject Schema"].includes(checkName)) score -= 4;
  score = Math.max(45, Math.min(99, score));
  const band = score >= 95 ? "Direct evidence" : score >= 80 ? "Strong evidence" : score >= 60 ? "Moderate evidence" : "Manual verification recommended";
  return { score, reason: score < 60 ? `${band}.` : `${band} from page-level HTML and deduplicated asset evidence.` };
}

function validatedAssetCount(evidence: Record<string, unknown>, affectedAssets: string[]) {
  const reported = Number(evidence.uniqueAssetsAffected);
  const failedInstances = Number(evidence.failedInstances);
  const deduplicated = new Set(affectedAssets).size;
  const candidate = Number.isFinite(reported) ? reported : deduplicated;
  return Number.isFinite(failedInstances)
    ? Math.max(0, Math.min(candidate, failedInstances))
    : Math.max(0, candidate);
}

function templateName(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return "Homepage Template";
    if (/\/(?:blog|news|articles?)\//i.test(path)) return "Blog Post Template";
    if (/\/(?:glossary|definitions?|terms?)\//i.test(path)) return "Glossary Template";
    if (/\/(?:products?|services?)\//i.test(path)) return "Product or Service Template";
    if (/\/(?:category|tag|topics?)\//i.test(path)) return "Category Template";
    return "Standard Content Template";
  } catch {
    return "Standard Content Template";
  }
}

function likelyTemplates(pages: string[]) {
  const counts = new Map<string, number>();
  pages.forEach((page) => {
    const name = templateName(page);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
}

function rootCauses(checkName: string, evidence: Record<string, unknown>, pageMetrics: ReturnType<typeof metrics>) {
  const hints = affectedAssetRecords(evidence)
    .map((item) => String(item.componentHint ?? ""))
    .filter(Boolean);
  const counts = new Map<string, number>();
  hints.forEach((hint) => counts.set(hint, (counts.get(hint) ?? 0) + 1));
  const repeated = [...counts.entries()]
    .filter(([hint]) => hint !== "Unclassified image renderer")
    .sort((a, b) => b[1] - a[1])
    .map(([hint]) => `${hint} emits the affected markup`);
  const defaults: Record<string, string> = {
    "Meaningful Images Have Alt Text": "CMS image library does not require alt values",
    "WebP/AVIF >=70%": "Modern image generation is disabled in the media pipeline",
    "LCP Image Preloaded": "Critical-image discovery is not configured from measured LCP data",
    "<picture> with WebP+Fallback": "The image renderer does not emit modern sources with compatible fallbacks",
    "Stable Image URLs": "CDN or build pipeline appends volatile cache-busting parameters",
    "Native Lazy Loading (Not JS)": "Theme image renderer treats all images as critical",
    "Responsive srcset+sizes": "srcset generation is disabled",
    "Descriptive File Names": "Media upload workflow preserves generic source filenames",
    "OCR-HTML Data Parity": "No OCR validation step exists for data-heavy visual content",
    "No Key Data as Image-Only": "Content workflow allows important facts to remain embedded only in images",
    "No Images Blocking Text": "Responsive layout has not been validated visually across supported viewports",
    "SVG <title>+<desc>": "SVG publishing workflow does not require accessible title and description elements",
    "ImageObject Schema": "Schema generator omits primary image entities"
  };
  const causes = repeated.slice(0, 2);
  if (defaults[checkName]) causes.push(defaults[checkName]);
  return [...new Set(causes)].slice(0, 3);
}

function overallAiVisibilityImpact(checkName: string, impact: "Low" | "Medium" | "High") {
  const mappings: Record<string, "Low" | "Moderate" | "High"> = {
    "Meaningful Images Have Alt Text": "Moderate",
    "WebP/AVIF >=70%": "Low",
    "LCP Image Preloaded": "Low",
    "<picture> with WebP+Fallback": "Low",
    "Stable Image URLs": "Low",
    "Native Lazy Loading (Not JS)": "Low",
    "Responsive srcset+sizes": "Low",
    "Descriptive File Names": "Low",
    "OCR-HTML Data Parity": "Moderate",
    "No Key Data as Image-Only": "Moderate",
    "No Images Blocking Text": "Low",
    "SVG <title>+<desc>": "Moderate",
    "ImageObject Schema": "Moderate"
  };
  const level = mappings[checkName] ?? (impact === "High" ? "Moderate" : "Low");
  return {
    level,
    explanation: GUIDANCE[checkName].aiVisibilityImpact
  };
}

function estimatedFixScope(checkName: string, pagesAffected: number) {
  const approximately = `${pagesAffected} affected page${pagesAffected === 1 ? "" : "s"}`;
  if (checkName === "WebP/AVIF >=70%" || checkName === "Stable Image URLs") {
    return {
      level: "Infrastructure-level fix" as const,
      description: `Updating the image optimization or delivery pipeline is expected to improve approximately ${approximately}.`
    };
  }
  if (checkName === "ImageObject Schema") {
    return {
      level: "Schema generator fix" as const,
      description: "Updating the schema generator is expected to resolve the issue across affected content templates."
    };
  }
  if (["Meaningful Images Have Alt Text", "Native Lazy Loading (Not JS)", "Responsive srcset+sizes", "<picture> with WebP+Fallback", "SVG <title>+<desc>"].includes(checkName)) {
    return {
      level: "Template-level fix" as const,
      description: `Updating the shared renderer or template is expected to resolve approximately ${approximately}.`
    };
  }
  if (["OCR-HTML Data Parity", "No Key Data as Image-Only", "No Images Blocking Text", "LCP Image Preloaded"].includes(checkName)) {
    return {
      level: "Manual review" as const,
      description: `Manual validation is required before estimating how many of the ${approximately} can be resolved by one shared change.`
    };
  }
  return {
    level: "Asset-level fix" as const,
    description: `Updating the affected media assets is expected to resolve approximately ${approximately}.`
  };
}

export function imageSeoRecommendation(
  checkName: string,
  severity: ImageSeoSeverity,
  evidence: Record<string, unknown>
): SeoIssueRecommendation {
  const guidance = GUIDANCE[checkName];
  if (!guidance) throw new Error(`Missing Image SEO recommendation for check: ${checkName}`);
  const pageMetrics = metrics(evidence);
  const issue = whatIsWrong(checkName, evidence);
  const detection = confidence(checkName, evidence);
  const affectedPages = affectedPageUrls(evidence);
  const collectedAssets = affectedAssetNames(evidence);
  const uniqueAssetsAffected = validatedAssetCount(evidence, collectedAssets);
  const affectedAssets = collectedAssets.slice(0, uniqueAssetsAffected);
  const impact = impactLevel(checkName);
  const scale = scaleLevel(pageMetrics.affectedRate);
  const effort = effortLevel(checkName);
  const score = boundedPriorityScore(checkName, priorityScore(impact, scale, effort));
  const templates = likelyTemplates(templateEvidencePages(evidence));
  const priority = score >= 81 ? "Critical" : score >= 61 ? "High" : score >= 41 ? "Medium" : score >= 21 ? "Low" : "Very Low";
  return {
    issue: checkName,
    issueSummary: guidance.issueSummary,
    severity,
    priority,
    priorityScore: score,
    impactLevel: impact,
    scaleLevel: scale,
    effortLevel: effort,
    affectedRate: pageMetrics.affectedRate,
    affectedPages,
    affectedAssets,
    uniqueAssetsAffected,
    rootCause: rootCauses(checkName, { ...evidence, uniqueAssetsAffected }, pageMetrics),
    likelyTemplates: templates,
    estimatedFixScope: estimatedFixScope(checkName, pageMetrics.pagesAffected),
    overallAiVisibilityImpact: overallAiVisibilityImpact(checkName, impact),
    whatIsWrong: issue,
    whyItMatters: guidance.whyItMatters,
    businessImpact: guidance.businessImpact,
    aiVisibilityImpact: guidance.aiVisibilityImpact,
    recommendedFix: guidance.fixes,
    validationSummary: {
      ...pageMetrics,
      uniqueAssetsAffected,
      mostCommonIssue: issue,
      expectedOutcome: guidance.expectedOutcome
    },
    detectionConfidence: detection,
    topFixCandidates: templates.length ? templates : affectedPages.slice(0, 3),
    technicalEvidence: evidence,
    whatWeChecked: [
      `Pages crawled: ${pageMetrics.pagesCrawled ?? "Unavailable"}`,
      `Pages analyzed: ${pageMetrics.pagesAnalyzed ?? "Unavailable"}`,
      `Pages affected: ${pageMetrics.pagesAffected}`,
      `Unique assets affected: ${uniqueAssetsAffected}`,
      `Affected rate: ${pageMetrics.affectedRate}% (${pageMetrics.pagesAffected} of ${pageMetrics.pagesAnalyzed ?? "Unavailable"} pages)`,
      `Most common issue: ${issue}`,
      `Expected outcome: ${guidance.expectedOutcome}`
    ],
    rawEvidence: evidence,
    howToFix: guidance.fixes.join(" "),
    bestPracticeExample: "",
    developerNotes: guidance.implementationGuide
  };
}
