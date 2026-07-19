# Technology Stack

This project is a TypeScript monorepo for a web application platform. It contains a customer-facing web app, an optional standalone API service, and a shared core package.

## Project Structure

| Path | Purpose |
| --- | --- |
| `apps/web` | Main Next.js web application and production API routes. |
| `apps/api` | Standalone Express API service for local or separate API deployments. |
| `packages/core` | Shared analysis, crawling, data-processing, and export logic. |

The repo uses **npm workspaces**:

```bash
apps/*
packages/*
```

## Runtime and Language

- **Node.js:** `>=20`
- **Language:** TypeScript
- **Module format:** ESM for app packages
- **Package manager:** npm with `package-lock.json`

## Frontend Stack

The frontend lives in `apps/web`.

- **Framework:** Next.js `15`
- **UI runtime:** React `19`, React DOM `19`
- **Routing:** Next.js App Router
- **Styling:** Tailwind CSS `3`
- **CSS tooling:** PostCSS, Autoprefixer
- **Icons:** `lucide-react`
- **Utility libraries:** `clsx`, `tailwind-merge`
- **Validation:** `zod`

The web app includes server-side API routes under `apps/web/app/api/*`, so it can run as a single deployable Next.js application in production.

## Backend/API Stack

There are two backend surfaces:

1. **Next.js API routes** in `apps/web/app/api/*`
2. **Standalone Express API** in `apps/api`

The standalone API uses:

- **Server framework:** Express `4`
- **Security middleware:** Helmet
- **CORS:** `cors`
- **Logging:** Morgan
- **Runtime TypeScript execution:** `tsx`
- **Validation:** `zod`
- **Environment loading:** `dotenv`

## Shared Core Package

The shared package lives in `packages/core` and is imported by both the web app and API.

Main responsibilities:

- Site analysis and quality checks
- Technical SEO and indexability checks
- Structured data processing
- Content and entity checks
- Image metadata checks
- Trust signal checks
- Sitemap/site crawling
- Summary generation and export helpers
- Interactive prompt utilities

Key dependency:

- **HTML parsing/crawling:** `cheerio`

## Database and Persistence

- **Database:** MongoDB
- **Driver:** Official `mongodb` Node.js driver
- **Default database name:** configured per deployment
- **Main environment variables:**
  - `MONGODB_URI`
  - `MONGODB_DB`

In non-production environments, the app can fall back to in-memory storage if MongoDB is not configured.

## Email and Lead Capture

The web app includes lead/callback routes that can send email notifications.

- **Email library:** `nodemailer`
- **SMTP variables:**
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `LEAD_EMAIL_FROM` or `EMAIL_FROM`
  - `LEAD_NOTIFICATION_EMAIL` or `BUSINESS_EMAIL`
- **Lead routing variable:**
  - `LEAD_WHATSAPP_NUMBER`

The standalone API also supports Resend for strategy-call notifications when configured:

- `RESEND_API_KEY`

## External Integrations

The project has optional integrations for search, SEO, performance, and verification data.

| Integration | Purpose | Environment Variables |
| --- | --- | --- |
| Google OAuth/Search Console | Site ownership and Search Console data | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| PageSpeed Insights | Lighthouse/PageSpeed metrics | `PAGESPEED_API_KEY` or `GOOGLE_API_KEY` |
| Chrome UX Report | Field performance metrics | `CRUX_API_KEY` or `GOOGLE_API_KEY` |
| Serper | Live SERP signals | `SERPER_API_KEY` |
| Bing Webmaster | Bing webmaster verification/signals | `BING_WEBMASTER_API_KEY` |
| Bing Maps | Local/business geo signals | `BING_MAPS_API_KEY` |

Optional feature flags are configured through environment variables when enabled for a deployment.

## Deployment

Recommended production deployment is the Next.js app in `apps/web`.

Current Vercel settings:

- **Framework:** Next.js
- **Root directory:** `apps/web`
- **Build command:** `npm run build`
- **Output directory:** `.next`

The Next.js app is configured with:

```ts
outputFileTracingRoot: path.join(process.cwd(), "../..")
```

This allows Vercel/Next.js output tracing to include monorepo dependencies from the repo root.

## Local Development

Install dependencies:

```bash
npm install
```

Run the full local stack:

```bash
npm run dev
```

Default local URLs:

- Web app: `http://localhost:3000`
- Standalone API: `http://localhost:4000`

## Build and Quality Commands

From the repo root:

```bash
npm run build
npm run typecheck
npm run lint
```

Workspace-specific commands:

```bash
npm run build -w <core-workspace>
npm run test -w <core-workspace>
npm run dev -w <web-workspace>
npm run dev -w <api-workspace>
```

## Important Notes

- The shared core workspace must be built before the web and API packages because both depend on its compiled output.
- The production path is centered on `apps/web`; the standalone Express API is available if a separate API deployment is needed.
- The README previously mentioned Recharts, but the current `apps/web/package.json` does not include `recharts`.
