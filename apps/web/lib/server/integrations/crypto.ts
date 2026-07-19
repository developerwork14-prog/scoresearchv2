import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadServerEnv } from "../env";

const ALGORITHM = "aes-256-gcm";

function keyBytes() {
  loadServerEnv();
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY is required in production.");
    }
    return createHash("sha256").update("glomaudit-local-integration-key").digest();
  }
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) return base64;
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Encrypted secret payload is invalid.");
  const decipher = createDecipheriv(ALGORITHM, keyBytes(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function redactSecret(value: string) {
  if (!value) return "";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
