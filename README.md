# AI Visibility Analyzer

A production-oriented SaaS scaffold for business-focused AI visibility reporting. Users enter only a brand name, website URL, and business email; the platform returns a single AI Visibility Score with business-facing insights.

## Run locally

```bash
npm install
npm run dev
```

- Web app: `http://localhost:3000`
- API: `http://localhost:4000`

## Architecture

- `apps/web`: Next.js, React, Tailwind CSS, Recharts UI.
- `apps/api`: Node.js and Express API for report generation, prompt playground, and exports.
- `packages/core`: Shared scoring, report generation, prompt simulation, and export helpers.

Technical SEO checks are modeled as hidden scoring signals and only rolled into the public business-facing score.

## Deploy to Vercel

Deploy `apps/web` as the Vercel project root. The Next app now includes production API routes for report creation, report viewing, PDF export, playground, and strategy-call leads.

Recommended Vercel settings:

- Root Directory: `apps/web`
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

Add these Environment Variables in Vercel:

```bash
MONGODB_URI=your_mongodb_atlas_connection_string
MONGODB_DB=aiva
LEAD_NOTIFICATION_EMAIL=your@email.com
LEAD_WHATSAPP_NUMBER=919999999999
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/callback/google
PAGESPEED_API_KEY=your_pagespeed_api_key
CRUX_API_KEY=your_crux_api_key
```

Do not set `NEXT_PUBLIC_API_BASE` on Vercel unless you intentionally want the web app to call a separate API. Leaving it empty makes the app use its own `/api/*` routes.

`PAGESPEED_API_KEY` powers PageSpeed Insights/Lighthouse performance data. `CRUX_API_KEY` powers Chrome UX Report field metrics. A shared `GOOGLE_API_KEY` can be used as a fallback for both, but separate keys make usage easier to monitor.
