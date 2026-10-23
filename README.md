# DBS Express — implementation scaffold

This is a working, responsive front-end and a configurable Node/Supabase backend scaffold based on the implementation directive. The approved Stitch export, brand assets, exact typography and client copy were not present in the workspace; the visuals and copy here are therefore **provisional**, not a faithful recreation or sign-off of the approved design.

## Run locally

- Node.js 18+ is required.
- `npm install`
- `cp .env.example .env` and fill in the server-side values (never put the service-role key in browser code or commit `.env`).
- `npm start` then open `http://localhost:4173`.
- The frontend can render without backend variables. The form then returns an explicit unavailable state; it does not fake a successful submission.

## Configure the secure services

1. Create a Supabase project. Run `supabase/schema.sql` in its SQL editor. This sets up the enquiry table, editable home-page copy, FAQs, admin membership, RLS and the public image bucket. The SQL seed is provisional copy for this scaffold.
2. Create an Auth user for each administrator, then add its real auth UUID to `public.admins` using the SQL editor. Admins cannot grant themselves access.
3. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` only on the server. The admin endpoints authenticate with Supabase Auth and check membership against the server-side admin table. Enquiries are inserted using the server-only service key; RLS denies client access to the enquiry table.
4. Configure SMTP variables and the notification recipient. The server persists the enquiry first, then sends email. It records `email_status` as sent/failed/pending and reports mail failures separately from database failure.
5. Set `SUPABASE_STORAGE_BUCKET=site-assets` (or align the schema and env if you change the bucket). The admin image upload endpoint only accepts authenticated admins and image formats up to 4 MB.

For an existing database, apply an appropriate migration for the `email_status` column before deploying the updated server. Do not rely on the in-memory rate limiter as a production anti-abuse system; configure an edge/WAF rate limit and monitoring. Use TLS, secure secret management, SMTP SPF/DKIM, backups, retention/deletion policy and an approved privacy notice before collecting real personal data.

## Implemented in this scaffold

- Responsive landing page with usable anchor navigation, mobile menu, FAQs and enquiry form.
- Layered CSS folder/document/magnifier animation: folder rise/settle, open, Basic/Standard/Enhanced sheets emerge in order, magnifier visits the sheets, sheets settle into a stack. It has a reduced-motion resting composition and no animation-driven layout changes.
- Scroll-triggered process reveals, progress line, restrained parallax on the process illustration and a no-IntersectionObserver fallback.
- Client and server-side enquiry validation, in-flight submit lock, unique request IDs, duplicate protection, server-side database insertion and SMTP notification error handling.
- Separate `/admin` sign-in route, gated admin API, editable home-page title/body and FAQs, and Supabase Storage image upload. Public page title/body and active FAQs load from Supabase when configured.
- No public prices, testimonials, performance claims, accreditation, integration claims or live status-check feature.

## Not verified / incomplete

- The supplied approved design and client content were not available, so matching its typography, colors, proportions, exact wording and assets has not been verified. Replace provisional content only with approved client content.
- Production Supabase and SMTP values were not supplied. Database persistence, notification delivery/failure modes, account auth, RLS with a real project, storage and unauthenticated admin denial require deployment-level integration tests and are **not verified here**.
- Responsive layouts and reduced-motion behavior were implemented in CSS, but real-device browser coverage across desktop/tablet/mobile and assistive-technology testing remain outstanding.
- The process, hero, keyboard navigation and form interactions should be checked in the deployed browser. No real email should be sent until recipient and SMTP configuration are confirmed.
- Legal eligibility text and privacy/retention disclosures must be reviewed and approved for the operating service. This page is general guidance and does not determine an individual's or role's eligibility.

## Hero sequence timing

The visual uses independent HTML layers and CSS keyframes rather than a rotating poster: folder rise starts immediately; the folder opens after 1.05 s; three document sheets emerge at staggered delays; the magnifier traverses each document; the sheets settle into their final stack by about 6.2 s. The reduced-motion stylesheet skips the movement and presents the composed documents immediately. Verify this timing with the supplied final design/assets before approval.
