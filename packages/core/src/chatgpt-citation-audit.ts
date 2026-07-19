export const CHATGPT_CITATION_CATEGORIES = [
  "General",
  "Robots & Bot Access",
  "Indexability",
  "Crawlability",
  "Technical Access",
  "Content Structure",
  "E-commerce Signals",
  "Content Quality",
  "Content Opportunities"
] as const;

export const CHATGPT_CITATION_CATEGORY_SET = new Set<string>(CHATGPT_CITATION_CATEGORIES);
export const CHATGPT_CITATION_CHECK_IDS = new Set<number>([
  38, 39, 40, 41, 42, 49, 50, 52, 54, 55, 65, 66,
  106, 108, 109, 110, 111, 112, 113, 114, 115
]);

export const CHATGPT_CITATION_RECOMMENDATIONS: Record<number, string> = {
  38: "Allow OAI-SearchBot in robots.txt so ChatGPT search can crawl public pages.",
  39: "Allow ChatGPT-User in robots.txt for user-triggered browsing and citations.",
  40: "Separate GPTBot training rules from OAI-SearchBot and ChatGPT-User access rules.",
  41: "Remove WAF, CAPTCHA, or bot challenges only for the affected OAI agents on public pages.",
  42: "Make citable page content visible without login, interstitials, or paywalls.",
  49: "Opportunity: Create comparison or alternatives pages to increase citation coverage.",
  50: "Opportunity: Create use-case pages targeting specific audiences or scenarios.",
  52: "Complete Product schema with name plus offers, reviews, or aggregate ratings where applicable.",
  54: "Show reviews from diverse sources or multiple trust platforms.",
  55: "Link merchant trust pages such as privacy, terms, refund, warranty, shipping, contact, and secure payment.",
  65: "Remove nosnippet, max-snippet:0, X-Robots-Tag restrictions, and data-nosnippet from citable content.",
  66: "Ensure OAI-SearchBot receives raw HTML content comparable to normal page content.",
  106: "Implement IndexNow with a reachable key file and URL submission workflow.",
  108: "Structure H2 headings around clear user intent progression.",
  109: "Create comparison, versus, or alternatives pages where they match search intent.",
  110: "Complete Product schema with name, brand, offers, availability, price, and aggregate rating or reviews.",
  111: "Keep visible product price, Product schema offers, and feed/source price-stock values in sync.",
  112: "Expose review volume and recent review dates in Product schema or visible page content.",
  113: "Show natural review distribution rather than a suspiciously uniform rating profile.",
  114: "Link merchant trust pages such as privacy, terms, refund, shipping, and contact pages.",
  115: "Create product comparison pages for relevant products, collections, or competitors."
};

export function isChatgptCitationCategory(categoryName: string) {
  return CHATGPT_CITATION_CATEGORY_SET.has(categoryName);
}

export function isChatgptCitationCheck(id: number, categoryName: string) {
  return CHATGPT_CITATION_CHECK_IDS.has(id) || (categoryName !== "Robots & Bot Access" && isChatgptCitationCategory(categoryName));
}
