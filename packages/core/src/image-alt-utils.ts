import type * as cheerio from "cheerio";

type CheerioElement = Parameters<cheerio.CheerioAPI>[0];

function normalizedAttribute(
  $: cheerio.CheerioAPI,
  element: CheerioElement,
  name: string
) {
  return ($(element).attr(name) ?? "").trim().toLowerCase();
}

export function isLikelyDecorativeImage(
  $: cheerio.CheerioAPI,
  element: CheerioElement
) {
  const image = $(element);
  const role = normalizedAttribute($, element, "role");
  const ariaHidden = normalizedAttribute($, element, "aria-hidden");
  const src = [
    image.attr("src"),
    image.attr("data-src"),
    image.attr("data-lazy-src")
  ].filter(Boolean).join(" ");
  const descriptors = [
    image.attr("class"),
    image.attr("id"),
    image.attr("title"),
    src
  ].filter(Boolean).join(" ");
  const width = Number.parseFloat(image.attr("width") ?? "");
  const height = Number.parseFloat(image.attr("height") ?? "");

  if (role === "presentation" || role === "none" || ariaHidden === "true") {
    return true;
  }

  if (
    Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && width <= 32
    && height <= 32
  ) {
    return true;
  }

  return /\b(?:spacer|tracking[-_ ]?pixel|beacon|transparent[-_ ]?pixel|decorative|decoration|divider|separator|social[-_ ]?icon|facebook|linkedin|youtube|instagram|twitter|x-icon)\b/i.test(descriptors)
    || /(?:^|[/_.-])(?:spacer|pixel|blank|transparent|beacon)(?:[/_.?-]|$)/i.test(src);
}

function cleanContext(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(?:image|photo|picture|graphic)\s+(?:of|showing)\s+/i, "")
    .trim();
}

function words(value: string) {
  return cleanContext(value).split(/\s+/).filter(Boolean);
}

function boundedAlt(value: string) {
  const tokens = words(value);
  if (tokens.length < 5) return null;
  return tokens.slice(0, 15).join(" ").replace(/[.,;:!?]+$/, "");
}

export function suggestedAltFromPageContext(
  $: cheerio.CheerioAPI,
  element: CheerioElement
) {
  const image = $(element);
  const figureCaption = image.closest("figure").find("figcaption").first().text();
  const describedBy = (image.attr("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => $(`#${id.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1")}`).text())
    .join(" ");
  const nearbyHeading = image.closest("section,article,figure,main,div")
    .find("h1,h2,h3,h4")
    .first()
    .text();
  const imageTitle = image.attr("title") ?? "";
  const safeHeading = /\b(?:buy|apply|click|offer|save|unlock|limited|money|ready|now|today|free|discount|₹|\$|€)\b/i.test(nearbyHeading)
    ? ""
    : nearbyHeading;
  const candidates = [
    figureCaption,
    describedBy,
    imageTitle,
    safeHeading
  ];

  for (const candidate of candidates) {
    const suggestion = boundedAlt(candidate);
    if (suggestion) return suggestion;
  }
  return null;
}
