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

export const BUSINESS_EMAIL_MESSAGE = "Please use your workspace email. Personal emails (Gmail, Yahoo, Outlook, etc.) are not allowed.";

export function isBusinessEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return Boolean(domain) && !PERSONAL_EMAIL_DOMAINS.has(domain);
}
