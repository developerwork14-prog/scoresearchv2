import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import type { IntegrationProvider, ProviderAuthState } from "./types";
import { integrationProviders } from "./types";

export const providerParamSchema = z.enum(integrationProviders);

export function requestContext(request: NextRequest) {
  const url = new URL(request.url);
  // A deployment without an application sign-in layer can still operate as a
  // single-tenant workspace when these server-only variables are configured.
  // Request values always take precedence, so an authenticated integration can
  // replace these defaults later without changing this API surface.
  const defaultUserId = process.env.GLOMAUDIT_DEFAULT_USER_ID
    ?? (process.env.NODE_ENV === "production" ? "" : "demo-user");
  const defaultProjectId = process.env.GLOMAUDIT_DEFAULT_PROJECT_ID
    ?? (process.env.NODE_ENV === "production" ? "" : "demo-project");
  const userId = request.headers.get("x-glomaudit-user-id")
    ?? request.cookies.get("glomaudit_user_id")?.value
    ?? defaultUserId;
  const projectId = url.searchParams.get("projectId")
    ?? request.headers.get("x-glomaudit-project-id")
    ?? request.cookies.get("glomaudit_project_id")?.value
    ?? defaultProjectId;
  if (!userId || !projectId) {
    throw new Error("Authenticated user and project context are required.");
  }
  return { userId, projectId };
}

export function parseProvider(value: string): IntegrationProvider {
  return providerParamSchema.parse(value);
}

export function createPkcePair() {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function encodeAuthState(input: Omit<ProviderAuthState, "nonce">) {
  const state: ProviderAuthState = { ...input, nonce: randomBytes(16).toString("base64url") };
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeAuthState(value: string): ProviderAuthState {
  return z.object({
    provider: providerParamSchema,
    userId: z.string().min(1),
    projectId: z.string().min(1),
    nonce: z.string().min(8),
    codeVerifier: z.string().optional(),
    returnTo: z.string().optional()
  }).parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
}

export async function readJson<T>(request: NextRequest) {
  return await request.json().catch(() => ({})) as T;
}
