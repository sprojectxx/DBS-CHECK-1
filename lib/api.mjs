/**
 * Shared API handler for DBS Express.
 *
 * Written with the Web Fetch API (Request in, Response out) so the exact same
 * code runs inside Vercel Functions (`api/*.mjs`) and in the local Node.js
 * development server (`scripts/dev.mjs`).
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

// Vercel rejects request bodies larger than 4.5 MB, so the raw image is capped
// below that once base64 encoding adds ~33%. Locally the same limit applies so
// behaviour is identical in both environments.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_JSON_BYTES = 20_000;

const attempts = new Map();
const duplicateCache = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function config() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anon: process.env.SUPABASE_ANON_KEY || '',
    bucket: process.env.SUPABASE_STORAGE_BUCKET || 'site-assets',
  };
}

function configured() {
  const c = config();
  return Boolean(c.url && c.service && c.anon);
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  return forwarded.split(',')[0].trim();
}

function takeRate(request, max = 5, windowMs = 10 * 60 * 1000) {
  const ip = clientIp(request);
  const now = Date.now();
  let item = attempts.get(ip);
  if (!item || item.until < now) item = { count: 0, until: now + windowMs };
  item.count += 1;
  attempts.set(ip, item);
  if (attempts.size > 5000) {
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  }
  return item.count <= max;
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid request data.');
  }
}

async function supabase(pathname, { method = 'GET', body: payload, token, contentType } = {}) {
  const c = config();
  const headers = { apikey: c.service, Authorization: `Bearer ${c.service}`, 'Content-Type': contentType || 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method === 'POST' && pathname.startsWith('/rest/v1/')) headers.Prefer = 'return=representation';
  const response = await fetch(`${c.url}${pathname}`, { method, headers, body: payload });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function validateEnquiry(d) {
  const name = String(d.name || '').trim();
  const email = String(d.email || '').trim();
  const checkType = String(d.checkType || '').trim();
  const message = String(d.message || '').trim();
  if (name.length < 2 || name.length > 120) return 'Enter a name between 2 and 120 characters.';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address.';
  if (!['Basic DBS', 'Standard DBS', 'Enhanced DBS', 'Not sure yet', 'Other question'].includes(checkType)) return 'Choose a valid enquiry option.';
  if (message.length < 10 || message.length > 3000) return 'Message must be between 10 and 3000 characters.';
  if (d.consent !== true) return 'Please confirm you agree to be contacted.';
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(d.requestId || ''))) return 'Please refresh the page and try again.';
  return null;
}

async function sendMail(enquiry) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.ENQUIRY_TO_EMAIL) {
    throw new Error('SMTP is not configured');
  }
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
    to: process.env.ENQUIRY_TO_EMAIL,
    replyTo: enquiry.email,
    subject: `Website enquiry: ${enquiry.check_type}`,
    text: `A new DBS Express enquiry was received.\n\nName: ${enquiry.name}\nEmail: ${enquiry.email}\nEnquiry about: ${enquiry.check_type}\n\nMessage:\n${enquiry.message}\n\nReference: ${enquiry.request_id}`,
    html: `<h2>Website enquiry received</h2><p><b>Name:</b> ${escapeHtml(enquiry.name)}<br><b>Email:</b> ${escapeHtml(enquiry.email)}<br><b>Enquiry about:</b> ${escapeHtml(enquiry.check_type)}</p><p><b>Message</b></p><p>${escapeHtml(enquiry.message).replace(/\n/g, '<br>')}</p><p>Reference: ${escapeHtml(enquiry.request_id)}</p>`,
  });
}

async function adminUser(token) {
  if (!token || !configured()) return null;
  const c = config();
  const userResponse = await fetch(`${c.url}/auth/v1/user`, { headers: { apikey: c.anon, Authorization: `Bearer ${token}` } });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const membership = await supabase(`/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`);
  return membership.ok && Array.isArray(membership.data) && membership.data.length ? user : null;
}

async function adminRoute(request, url) {
  if (!configured()) return json(503, { message: 'Admin services are not configured on this deployment.' });

  if (url.pathname === '/api/admin/login' && request.method === 'POST') {
    if (!takeRate(request, 8, 15 * 60 * 1000)) return json(429, { message: 'Too many attempts. Please wait a little and try again.' });
    const payload = await readJson(request);
    const c = config();
    const login = await fetch(`${c.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: c.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(payload.email || ''), password: String(payload.password || '') }),
    });
    const data = await login.json().catch(() => ({}));
    if (!login.ok || !data.access_token) return json(401, { message: 'Email or password was not accepted.' });
    const user = await adminUser(data.access_token);
    if (!user) return json(403, { message: 'This account is not authorized for the admin area.' });
    return json(200, { accessToken: data.access_token, expiresIn: data.expires_in, user: { email: user.email } });
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await adminUser(token);
  if (!user) return json(401, { message: 'Sign in with an authorized admin account.' });

  if (url.pathname === '/api/admin/content' && request.method === 'GET') {
    const [pages, faqs] = await Promise.all([
      supabase('/rest/v1/site_content?select=slug,title,body,updated_at&order=slug.asc'),
      supabase('/rest/v1/faqs?select=id,question,answer,sort_order,active&order=sort_order.asc'),
    ]);
    if (!pages.ok || !faqs.ok) return json(502, { message: 'Could not load editable content.' });
    return json(200, { pages: pages.data, faqs: faqs.data });
  }

  if (url.pathname === '/api/admin/content' && request.method === 'PUT') {
    const payload = await readJson(request, 6_000_000);
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    const faqs = Array.isArray(payload.faqs) ? payload.faqs : [];
    if (pages.length > 50 || faqs.length > 100) return json(400, { message: 'Too many content records.' });
    const pageRows = pages.map((p) => ({ slug: String(p.slug || '').slice(0, 100), title: String(p.title || '').slice(0, 180), body: String(p.body || '').slice(0, 20000) }));
    const faqRows = faqs.map((f) => ({ id: f.id || undefined, question: String(f.question || '').slice(0, 300), answer: String(f.answer || '').slice(0, 4000), sort_order: Number(f.sort_order) || 0, active: f.active !== false }));
    if (pageRows.some((p) => !/^[a-z0-9-]+$/.test(p.slug) || !p.title) || faqRows.some((f) => !f.question || !f.answer || !/^[0-9a-f-]{36}$/i.test(String(f.id || '')))) {
      return json(400, { message: 'Please check that every page and FAQ has a valid ID, title and content.' });
    }
    if (pageRows.length) {
      const saved = await supabase('/rest/v1/site_content?on_conflict=slug', { method: 'POST', body: JSON.stringify(pageRows) });
      if (!saved.ok) return json(502, { message: 'Page content could not be saved.' });
    }
    if (faqRows.length) {
      const saved = await supabase('/rest/v1/faqs?on_conflict=id', { method: 'POST', body: JSON.stringify(faqRows) });
      if (!saved.ok) return json(502, { message: 'FAQ content could not be saved.' });
    }
    if (payload.replaceFaqs === true && Array.isArray(payload.faqs)) {
      const keep = faqRows.map((f) => f.id).filter(Boolean);
      const existing = await supabase('/rest/v1/faqs?select=id');
      if (!existing.ok) return json(502, { message: 'Could not reconcile the FAQ list.' });
      const stale = (existing.data || []).map((f) => f.id).filter((id) => !keep.includes(id));
      if (stale.length) {
        const filter = encodeURIComponent(`(${stale.join(',')})`);
        const removed = await supabase(`/rest/v1/faqs?id=in.${filter}`, { method: 'DELETE' });
        if (!removed.ok) return json(502, { message: 'Some removed FAQs could not be deleted.' });
      }
    }
    return json(200, { message: 'Content saved.' });
  }

  if (url.pathname === '/api/admin/assets' && request.method === 'POST') {
    const payload = await readJson(request, 5_000_000);
    const name = String(payload.name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const type = String(payload.contentType || '');
    const b64 = String(payload.data || '');
    if (!name || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(type) || !/^data:[^;]+;base64,/.test(b64)) {
      return json(400, { message: 'Choose a PNG, JPEG, WebP or SVG image.' });
    }
    const raw = Buffer.from(b64.split(',')[1] || '', 'base64');
    if (!raw.length || raw.length > MAX_IMAGE_BYTES) return json(400, { message: 'Images must be smaller than 3 MB.' });
    const c = config();
    const objectPath = `${Date.now()}-${name}`;
    const upload = await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(c.bucket)}/${encodeURIComponent(objectPath)}`, {
      method: 'POST',
      headers: { apikey: c.service, Authorization: `Bearer ${c.service}`, 'Content-Type': type, 'x-upsert': 'false' },
      body: raw,
    });
    if (!upload.ok) return json(502, { message: 'Image upload failed. Check the configured storage bucket.' });
    return json(201, {
      path: objectPath,
      url: `${c.url}/storage/v1/object/public/${encodeURIComponent(c.bucket)}/${encodeURIComponent(objectPath)}`,
    });
  }

  if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
    const c = config();
    const signedOut = await fetch(`${c.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: c.anon, Authorization: `Bearer ${token}` } });
    if (!signedOut.ok) return json(502, { message: 'The Supabase session could not be revoked. Clear this browser session and retry.' });
    return json(200, { message: 'Session revoked.' });
  }

  return json(404, { message: 'Not found.' });
}

/**
 * Routes an API request. `request.url` is the original public URL, because
 * Vercel's file-based `/api` routing does not rewrite it.
 */
export async function handleApi(request) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/enquiries' && request.method === 'POST') {
      if (!takeRate(request, 6, 10 * 60 * 1000)) return json(429, { message: 'Too many attempts. Please wait a little and try again.' });
      const d = await readJson(request);
      const error = validateEnquiry(d);
      if (error) return json(400, { message: error });
      if (!configured()) {
        return json(503, { message: 'Enquiries are temporarily unavailable because secure submission is not configured. Please try again later.' });
      }
      const id = String(d.requestId);
      if (duplicateCache.has(id)) return json(200, { ok: true, notification: duplicateCache.get(id).notification });
      const enquiry = {
        request_id: id,
        name: String(d.name).trim(),
        email: String(d.email).trim(),
        check_type: String(d.checkType),
        message: String(d.message).trim(),
        consent: true,
        email_status: 'pending',
      };
      const saved = await supabase('/rest/v1/enquiries', { method: 'POST', body: JSON.stringify(enquiry) });
      if (!saved.ok) {
        if (saved.status === 409) {
          const prior = await supabase(`/rest/v1/enquiries?request_id=eq.${encodeURIComponent(id)}&select=email_status&limit=1`);
          if (prior.ok && prior.data?.length) {
            const notification = prior.data[0].email_status;
            duplicateCache.set(id, { notification, at: Date.now() });
            return json(200, { ok: true, notification });
          }
        }
        console.error('Enquiry persistence error:', saved.status, saved.data);
        return json(502, { message: 'We could not safely save your enquiry. Please try again later.' });
      }
      let notification = 'sent';
      try {
        await sendMail(enquiry);
      } catch (err) {
        notification = 'failed';
        console.error('Enquiry email failure:', err.message);
      }
      const emailStatus = await supabase(`/rest/v1/enquiries?request_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ email_status: notification }) });
      if (!emailStatus.ok) {
        console.error('Could not update enquiry notification status:', emailStatus.status);
        notification = 'pending';
      }
      duplicateCache.set(id, { notification, at: Date.now() });
      setTimeout(() => duplicateCache.delete(id), 24 * 60 * 60 * 1000).unref?.();
      return json(201, { ok: true, notification });
    }

    if (url.pathname === '/api/content' && request.method === 'GET') {
      if (!configured()) return json(200, { pages: [], faqs: [] });
      const [pages, faqs] = await Promise.all([
        supabase('/rest/v1/site_content?select=slug,title,body,updated_at'),
        supabase('/rest/v1/faqs?select=id,question,answer,sort_order&active=eq.true&order=sort_order.asc'),
      ]);
      if (!pages.ok || !faqs.ok) return json(502, { message: 'Published content is temporarily unavailable.' });
      return json(200, { pages: pages.data, faqs: faqs.data });
    }

    if (url.pathname.startsWith('/api/admin/')) return await adminRoute(request, url);

    return json(404, { message: 'Not found.' });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { message: error.message });
    console.error(error);
    return json(500, { message: 'An unexpected server error occurred.' });
  }
}
