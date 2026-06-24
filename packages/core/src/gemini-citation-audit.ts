export const GEMINI_CITATION_CATEGORIES = [
  "Gemini Crawlability",
  "Local & E-Commerce",
  "Schema & Technical",
  "Media & Visuals",
  "Robots & Bot Access",
  "AI Discovery Files"
] as const;

export const GEMINI_CITATION_CATEGORY_SET = new Set<string>(GEMINI_CITATION_CATEGORIES);

export const GEMINI_CITATION_RECOMMENDATIONS: Record<number, string> = {
  67: "Allow Google-Extended in robots.txt when Gemini citation visibility is desired.",
  68: "Remove a verified WAF, CAPTCHA, or bot challenge that blocks Google-Extended from public pages.",
  69: "Unable to verify Google IP access from the current crawl environment; perform an authenticated IP-based test before creating an issue.",
  70: "Compare NAP only when verified Google Business Profile data and applicable local-business page evidence are available.",
  71: "Ensure cookie consent does not replace the crawlable raw HTML body.",
  72: "Render JSON-LD schema server-side instead of injecting it only after JavaScript.",
  73: "Allow GoogleOther in robots.txt for Google systems that support AI and search features.",
  74: "Add speakable schema only where the content is appropriate for voice-style extraction.",
  75: "Replace stock imagery with original images where trust and citation quality matter.",
  76: "Add meaningful alt text to images that communicate important page content.",
  77: "Add VideoObject schema for embedded videos on key pages.",
  78: "Publish crawlable transcript or caption text that aligns with the visible page content."
};

export function isGeminiCitationCategory(categoryName: string) {
  return GEMINI_CITATION_CATEGORY_SET.has(categoryName);
}
