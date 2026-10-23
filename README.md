# DBS Express — implementation scaffold

This is a working, responsive front-end and a configurable Node/Supabase backend scaffold based on the implementation directive. The approved Stitch export, brand assets, exact typography and client copy were not present in the workspace; the visuals and copy here are therefore **provisional**, not a faithful recreation or sign-off of the approved design.

## Project structure

```
public/            static front-end served by the CDN (index, admin, CSS, JS)
api/               Vercel Functions (one per public endpoint)
  enquiries.mjs    POST /api/enquiries
  content.mjs      GET  /api/content
  admin/*.mjs      login, content, assets, logout
lib/api.mjs        shared request handler (Web Fetch API, used by Vercel and local dev)
scripts/dev.mjs    local development server (static + API)
supabase/schema.sql
vercel.json        Vercel build/routing configuration
```

Front-end code lives in `public/` because Vercel serves that directory as the static output. API code lives in `api/` because Vercel deploys each file there as a function. Shared logic stays in `lib/` so both environments run identical code.

## Run locally

- Node.js 20+ is required (Node 22 recommended; Vercel runs 22).
- `npm install`
- `cp .env.example .env` and fill in the server-side values (never put the service-role key in browser code or commit `.env`).
- `npm start` then open `http://localhost:4173`.
- The frontend can render without backend variables. The form then returns an explicit unavailable state; it does not fake a successful submission.

The local server serves `public/` and routes `/api/*` through `lib/api.mjs` — the same handler the deployed functions use.

## Deploy to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` sets the framework preset to "Other", the output directory to `public`, and the function runtime options, so no dashboard overrides are needed.
2. Add the environment variables from `.env.example` in **Project Settings → Environment Variables** (at minimum the three Supabase values for enquiries to work; SMTP values for email).
3. Deploy. `/` and `/admin` are served from the CDN; `/api/*` is handled by the functions.

Notes specific to Vercel:

- Vercel limits request bodies to **4.5 MB**, so admin image uploads are capped at **3 MB** (base64 adds ~33%). The local server enforces the same limit for consistency.
- Functions are stateless and scale horizontally, so the in-memory rate limiter and duplicate-submission cache are per instance. Configure a WAF/edge rate limit before relying on this in production.
- If the project was previously deployed with a different framework preset, `"framework": null` in `vercel.json` forces the correct "Other" preset for each deployment.

## Configure the secure services

1. Create a Supabase project. Run `supabase/schema.sql` in its SQL editor. This sets up the enquiry table, editable home-page copy, FAQs, admin membership, RLS and the public image bucket. The SQL seed is provisional copy for this scaffold.
2. Create an Auth user for each administrator, then add its real auth UUID to `public.admins` using the SQL editor. Admins cannot grant themselves access.
3. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` only on the server. The admin endpoints authenticate with Supabase Auth and check membership against the server-side admin table. Enquiries are inserted using the server-only service key; RLS denies client access to the enquiry table.
4. Configure SMTP variables and the notification recipient. The server persists the enquiry first, then sends email. It records `email_status` as sent/failed/pending and reports mail failures separately from database failure.
5. Set `SUPABASE_STORAGE_BUCKET=site-assets` (or align the schema and env if you change the bucket). The admin image upload endpoint only accepts authenticated admins and image formats up to 3 MB.

For an existing database, apply an appropriate migration for the `email_status` column before deploying the updated server. Do not rely on the in-memory rate limiter as a production anti-abuse system; configure an edge/WAF rate limit and monitoring. Use TLS, secure secret management, SMTP SPF/DKIM, backups, retention/deletion policy and an approved privacy notice before collecting real personal data.

## Implemented in this scaffold

- Responsive landing page with usable anchor navigation, mobile menu, FAQs and enquiry form.
- Layered CSS folder/document/magnifier animation: folder rise/settle, open, Basic/Standard/Enhanced sheets emerge in order, magnifier visits the sheets, sheets settle into a stack. It has a reduced-motion resting composition and no animation-driven layout changes.
- Scroll-triggered process reveals, progress line, restrained parallax on the process illustration and a no-IntersectionObserver fallback.
- Client and server-side enquiry validation, in-flight submit lock, unique request IDs, duplicate protection, server-side database insertion and SMTP notification error handling.
- Separate `/admin` sign-in route, gated admin API, editable home-page title/body and FAQs, and Supabase Storage image upload. Public page title/body and active FAQs load from Supabase when configured.
- Vercel-native deployment: static assets on the CDN, API endpoints as functions, and one shared handler for local and hosted environments.
- No public prices, testimonials, performance claims, accreditation, integration claims or live status-check feature.

## Not verified / incomplete

- The supplied approved design and client content were not available, so matching its typography, colors, proportions, exact wording and assets has not been verified. Replace provisional content only with approved client content.
- Production Supabase and SMTP values were not supplied. Database persistence, notification delivery/failure modes, account auth, RLS with a real project, storage and unauthenticated admin denial require deployment-level integration tests and are **not verified here**.
- Responsive layouts and reduced-motion behavior were implemented in CSS, but real-device browser coverage across desktop/tablet/mobile and assistive-technology testing remain outstanding.
- The process, hero, keyboard navigation and form interactions should be checked in the deployed browser. No real email should be sent until recipient and SMTP configuration are confirmed.
- Legal eligibility text and privacy/retention disclosures must be reviewed and approved for the operating service. This page is general guidance and does not determine an individual's or role's eligibility.

## Hero sequence timing

The visual uses independent HTML layers and CSS keyframes rather than a rotating poster: folder rise starts immediately; the folder opens after 1.05 s; three document sheets emerge at staggered delays; the magnifier traverses each document; the sheets settle into their final stack by about 6.2 s. The reduced-motion stylesheet skips the movement and presents the composed documents immediately. Verify this timing with the supplied final design/assets before approval.
