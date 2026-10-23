import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon' };
const attempts = new Map();
const duplicateCache = new Map();

function config() {
  return { url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''), service: process.env.SUPABASE_SERVICE_ROLE_KEY || '', anon: process.env.SUPABASE_ANON_KEY || '', bucket: process.env.SUPABASE_STORAGE_BUCKET || 'site-assets' };
}
function configured() { const c=config(); return Boolean(c.url && c.service && c.anon); }
function json(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(data)); }
function safeEqual(a,b) { return a.length===b.length && Buffer.from(a).equals(Buffer.from(b)); }
function takeRate(req, res, max=5, windowMs=10*60*1000) {
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();
  const now=Date.now(); let item=attempts.get(ip); if(!item||item.until<now)item={count:0,until:now+windowMs}; item.count++; attempts.set(ip,item);
  if(item.count>max){json(res,429,{message:'Too many attempts. Please wait a little and try again.'});return false;} return true;
}
async function body(req, maxBytes=20000) {
  let size=0, chunks=[]; for await (const chunk of req) { size+=chunk.length; if(size>maxBytes) throw new Error('Request too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
async function supabase(pathname, {method='GET', body: payload, token, contentType, raw}={}) {
  const c=config(); const headers={ apikey:c.service, Authorization:`Bearer ${c.service}`, 'Content-Type':contentType||'application/json' };
  if(token) headers.Authorization=`Bearer ${token}`;
  if(method==='POST' && !raw && pathname.startsWith('/rest/v1/')) headers.Prefer='return=representation';
  const response=await fetch(`${c.url}${pathname}`,{method,headers,body:payload});
  const text=await response.text(); let data; try{data=text?JSON.parse(text):null;}catch{data=text;}
  return {ok:response.ok,status:response.status,data,headers:response.headers};
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function validateEnquiry(d) {
  const name=String(d.name||'').trim(), email=String(d.email||'').trim(), checkType=String(d.checkType||'').trim(), message=String(d.message||'').trim();
  if(name.length<2||name.length>120) return 'Enter a name between 2 and 120 characters.';
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address.';
  if(!['Basic DBS','Standard DBS','Enhanced DBS','Not sure yet','Other question'].includes(checkType)) return 'Choose a valid enquiry option.';
  if(message.length<10||message.length>3000) return 'Message must be between 10 and 3000 characters.';
  if(d.consent!==true) return 'Please confirm you agree to be contacted.';
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(String(d.requestId||''))) return 'Please refresh the page and try again.';
  return null;
}
async function sendMail(enquiry) {
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD||!process.env.ENQUIRY_TO_EMAIL) throw new Error('SMTP is not configured');
  const nodemailer=(await import('nodemailer')).default;
  const port=Number(process.env.SMTP_PORT||587);
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:process.env.SMTP_SECURE==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});
  await transport.sendMail({from:process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER,to:process.env.ENQUIRY_TO_EMAIL,replyTo:enquiry.email,subject:`Website enquiry: ${enquiry.check_type}`,text:`A new DBS Express enquiry was received.\n\nName: ${enquiry.name}\nEmail: ${enquiry.email}\nEnquiry about: ${enquiry.check_type}\n\nMessage:\n${enquiry.message}\n\nReference: ${enquiry.request_id}`,html:`<h2>Website enquiry received</h2><p><b>Name:</b> ${escapeHtml(enquiry.name)}<br><b>Email:</b> ${escapeHtml(enquiry.email)}<br><b>Enquiry about:</b> ${escapeHtml(enquiry.check_type)}</p><p><b>Message</b></p><p>${escapeHtml(enquiry.message).replace(/\n/g,'<br>')}</p><p>Reference: ${escapeHtml(enquiry.request_id)}</p>`});
}
async function adminUser(token) {
  if(!token||!configured()) return null;
  const c=config();
  const userResponse=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.anon,Authorization:`Bearer ${token}`}});
  if(!userResponse.ok)return null;
  const user=await userResponse.json();
  const membership=await supabase(`/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`);
  return membership.ok&&Array.isArray(membership.data)&&membership.data.length?user:null;
}
async function adminRoute(req,res,url) {
  if(!configured()) return json(res,503,{message:'Admin services are not configured on this deployment.'});
  const payload=(req.method==='POST'||req.method==='PUT')?await body(req,6_000_000):{};
  if(url.pathname==='/api/admin/login'&&req.method==='POST') {
    if(!takeRate(req,res,8,15*60*1000))return;
    const c=config(); const login=await fetch(`${c.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:c.anon,'Content-Type':'application/json'},body:JSON.stringify({email:String(payload.email||''),password:String(payload.password||'')})});
    const data=await login.json().catch(()=>({}));
    if(!login.ok||!data.access_token)return json(res,401,{message:'Email or password was not accepted.'});
    const user=await adminUser(data.access_token);
    if(!user)return json(res,403,{message:'This account is not authorized for the admin area.'});
    return json(res,200,{accessToken:data.access_token,expiresIn:data.expires_in,user:{email:user.email}});
  }
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const user=await adminUser(token);
  if(!user)return json(res,401,{message:'Sign in with an authorized admin account.'});
  if(url.pathname==='/api/admin/content'&&req.method==='GET') {
    const [pages,faqs]=await Promise.all([supabase('/rest/v1/site_content?select=slug,title,body,updated_at&order=slug.asc'),supabase('/rest/v1/faqs?select=id,question,answer,sort_order,active&order=sort_order.asc')]);
    if(!pages.ok||!faqs.ok)return json(res,502,{message:'Could not load editable content.'});
    return json(res,200,{pages:pages.data,faqs:faqs.data});
  }
  if(url.pathname==='/api/admin/content'&&req.method==='PUT') {
    const pages=Array.isArray(payload.pages)?payload.pages:[]; const faqs=Array.isArray(payload.faqs)?payload.faqs:[];
    if(pages.length>50||faqs.length>100)return json(res,400,{message:'Too many content records.'});
    const pageRows=pages.map(p=>({slug:String(p.slug||'').slice(0,100),title:String(p.title||'').slice(0,180),body:String(p.body||'').slice(0,20000)}));
    const faqRows=faqs.map(f=>({id:f.id||undefined,question:String(f.question||'').slice(0,300),answer:String(f.answer||'').slice(0,4000),sort_order:Number(f.sort_order)||0,active:f.active!==false}));
    if(pageRows.some(p=>! /^[a-z0-9-]+$/.test(p.slug)||!p.title)||faqRows.some(f=>!f.question||!f.answer||! /^[0-9a-f-]{36}$/i.test(String(f.id||''))))return json(res,400,{message:'Please check that every page and FAQ has a valid ID, title and content.'});
    if(pageRows.length){const p=await supabase('/rest/v1/site_content?on_conflict=slug',{method:'POST',body:JSON.stringify(pageRows)}); if(!p.ok)return json(res,502,{message:'Page content could not be saved.'});}
    if(faqRows.length){const f=await supabase('/rest/v1/faqs?on_conflict=id',{method:'POST',body:JSON.stringify(faqRows)}); if(!f.ok)return json(res,502,{message:'FAQ content could not be saved.'});}
    if(payload.replaceFaqs===true&&Array.isArray(payload.faqs)){
      const keep=faqRows.map(f=>f.id).filter(Boolean);
      const existing=await supabase('/rest/v1/faqs?select=id');
      if(!existing.ok)return json(res,502,{message:'Could not reconcile the FAQ list.'});
      const stale=(existing.data||[]).map(f=>f.id).filter(id=>!keep.includes(id));
      if(stale.length){const filter=encodeURIComponent(`(${stale.join(',')})`);const removed=await supabase(`/rest/v1/faqs?id=in.${filter}`,{method:'DELETE'});if(!removed.ok)return json(res,502,{message:'Some removed FAQs could not be deleted.'});}
    }
    return json(res,200,{message:'Content saved.'});
  }
  if(url.pathname==='/api/admin/assets'&&req.method==='POST') {
    const name=String(payload.name||'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120); const type=String(payload.contentType||''); const b64=String(payload.data||'');
    if(!name||!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(type)||!/^data:[^;]+;base64,/.test(b64))return json(res,400,{message:'Choose a PNG, JPEG, WebP or SVG image.'});
    const raw=Buffer.from(b64.split(',')[1]||'','base64'); if(!raw.length||raw.length>4*1024*1024)return json(res,400,{message:'Images must be smaller than 4 MB.'});
    const c=config(); const objectPath=`${Date.now()}-${name}`;
    const upload=await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(c.bucket)}/${encodeURIComponent(objectPath)}`,{method:'POST',headers:{apikey:c.service,Authorization:`Bearer ${c.service}`,'Content-Type':type,'x-upsert':'false'},body:raw});
    if(!upload.ok)return json(res,502,{message:'Image upload failed. Check the configured storage bucket.'});
    return json(res,201,{path:objectPath,url:`${c.url}/storage/v1/object/public/${encodeURIComponent(c.bucket)}/${encodeURIComponent(objectPath)}`});
  }
  if(url.pathname==='/api/admin/logout'&&req.method==='POST'){
    const c=config();
    const signedOut=await fetch(`${c.url}/auth/v1/logout`,{method:'POST',headers:{apikey:c.anon,Authorization:`Bearer ${token}`}});
    if(!signedOut.ok)return json(res,502,{message:'The Supabase session could not be revoked. Clear this browser session and retry.'});
    return json(res,200,{message:'Session revoked.'});
  }
  return json(res,404,{message:'Not found.'});
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try {
    if(url.pathname==='/api/enquiries'&&req.method==='POST') {
      if(!takeRate(req,res,6,10*60*1000))return;
      const d=await body(req); const error=validateEnquiry(d); if(error)return json(res,400,{message:error});
      if(!configured())return json(res,503,{message:'Enquiries are temporarily unavailable because secure submission is not configured. Please try again later.'});
      const id=String(d.requestId);
      if(duplicateCache.has(id))return json(res,200,{ok:true,notification:duplicateCache.get(id).notification});
      const enquiry={request_id:id,name:String(d.name).trim(),email:String(d.email).trim(),check_type:String(d.checkType),message:String(d.message).trim(),consent:true,email_status:'pending'};
      const saved=await supabase('/rest/v1/enquiries',{method:'POST',body:JSON.stringify(enquiry)});
      if(!saved.ok) {
        if(saved.status===409){const prior=await supabase(`/rest/v1/enquiries?request_id=eq.${encodeURIComponent(id)}&select=email_status&limit=1`);if(prior.ok&&prior.data?.length){const notification=prior.data[0].email_status;duplicateCache.set(id,{notification,at:Date.now()});return json(res,200,{ok:true,notification});}}
        console.error('Enquiry persistence error:',saved.status, saved.data);
        return json(res,502,{message:'We could not safely save your enquiry. Please try again later.'});
      }
      let notification='sent';
      try { await sendMail(enquiry); } catch(err) { notification='failed'; console.error('Enquiry email failure:',err.message); }
      const emailStatus=await supabase(`/rest/v1/enquiries?request_id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({email_status:notification})});
      if(!emailStatus.ok){console.error('Could not update enquiry notification status:',emailStatus.status);notification='pending';}
      duplicateCache.set(id,{notification,at:Date.now()});
      setTimeout(()=>duplicateCache.delete(id),24*60*60*1000).unref?.();
      return json(res,201,{ok:true,notification});
    }
    if(url.pathname==='/api/content'&&req.method==='GET') {
      if(!configured()) return json(res,200,{pages:[],faqs:[]});
      const [pages,faqs]=await Promise.all([supabase('/rest/v1/site_content?select=slug,title,body,updated_at'),supabase('/rest/v1/faqs?select=id,question,answer,sort_order&active=eq.true&order=sort_order.asc')]);
      if(!pages.ok||!faqs.ok)return json(res,502,{message:'Published content is temporarily unavailable.'});
      return json(res,200,{pages:pages.data,faqs:faqs.data});
    }
    if(url.pathname.startsWith('/api/admin/')) return await adminRoute(req,res,url);
    if(url.pathname.startsWith('/api/'))return json(res,404,{message:'Not found.'});
    let pathname=decodeURIComponent(url.pathname); if(pathname==='/')pathname='/index.html'; if(pathname==='/admin'||pathname==='/admin/')pathname='/admin.html';
    const target=path.resolve(root,`.${pathname}`); if(!target.startsWith(root+path.sep))return json(res,404,{message:'Not found.'});
    const fileStat=await stat(target); if(!fileStat.isFile())return json(res,404,{message:'Not found.'});
    const data=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Cache-Control':pathname.endsWith('.html')?'no-cache':'public, max-age=3600'});res.end(data);
  } catch(err) { console.error(err); json(res,err instanceof SyntaxError?400:500,{message:err instanceof SyntaxError?'Invalid request data.':'An unexpected server error occurred.'}); }
});
server.listen(port,'0.0.0.0',()=>console.log(`DBS Express scaffold listening on ${port}`));
