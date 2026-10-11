const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
try { require('dotenv').config(); } catch {}
// Fallback .env reader so the shop can still start if dependencies are not installed yet.
try { const envFile=fs.readFileSync(path.join(__dirname,'.env'),'utf8'); for(const line of envFile.split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');} } catch {}
let nodemailer = null; try { nodemailer = require('nodemailer'); } catch {}
const mailLimits = new Map();
function mailReady(){ return !!(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM); }
function mailer(){ if(!mailReady()) throw new Error('E-mails non configurés : complète SMTP_HOST, SMTP_USER, SMTP_PASS et MAIL_FROM dans le fichier .env.'); return nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}); }
async function sendMail(to, subject, html, textBody=''){ const t=mailer(); return t.sendMail({from:process.env.MAIL_FROM,to,subject,html,text:textBody||html.replace(/<[^>]*>/g,' ')}); }
const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||''));
const CATEGORIES = ['Sneakers','Chaussures','Vestes','Doudounes','Ensembles','Sweats','T-shirts','Pantalons'];

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'shop.json');
const PORT = Number(process.env.PORT || 8080);
const googleStates = new Map();
// Mode sans mot de passe demandé : l'administration n'est pas protégée.

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ products: [], orders: [], promoCodes: [{code:'BIENVENUE10',type:'percent',value:10},{code:'LIVRAISON',type:'ship',value:0}], settings: { paymentMode: 'stripe', freeShippingAlways: false } }, null, 2));

function readDB() {
  try { const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); db.products = db.products || []; db.orders = db.orders || []; db.audit = db.audit || []; db.customers = db.customers || []; db.orders.forEach(o=>{o.statusHistory=o.statusHistory||[{status:o.status||'inconnue',at:o.date||new Date().toISOString()}]}); db.promoCodes = db.promoCodes || [{code:'BIENVENUE10',type:'percent',value:10,active:true},{code:'LIVRAISON',type:'ship',value:0,active:true}]; db.settings = db.settings || {paymentMode:'stripe',freeShippingAlways:false}; db.settings.paymentMode = 'stripe'; delete db.settings.beneficiary; delete db.settings.iban; delete db.settings.bic; for (const p of db.products) if (p.stock === undefined) p.stock = 1; return db; }
  catch { return { products: [], orders: [], promoCodes: [{code:'BIENVENUE10',type:'percent',value:10,active:true},{code:'LIVRAISON',type:'ship',value:0,active:true}], settings: { paymentMode: 'stripe', freeShippingAlways: false } }; }
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function audit(db, action, entity, before, after) { db.audit=db.audit||[]; db.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Admin',action,entity,before:before?JSON.parse(JSON.stringify(before)):null,after:after?JSON.parse(JSON.stringify(after)):null}); db.audit=db.audit.slice(0,1000); }
function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 20 * 1024 * 1024) { reject(new Error('Fichier trop volumineux (maximum 20 Mo).')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON invalide.')); } });
    req.on('error', reject);
  });
}
function publicProduct(p) {
  const { id, title, brand, size, price, category, condition, color, status, description, photo, photos, createdAt, stock, authenticity } = p;
  return { id, title, brand, size, price, category, condition, color, status, description, photo: photo || (photos||[])[0] || '', photos: Array.isArray(photos) && photos.length ? photos : (photo ? [photo] : []), createdAt, stock: Math.max(0, Number(stock ?? 1)), authenticity: authenticity || 'À vérifier' };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && pathname === '/auth/google') {
      if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return send(res,503,{error:'Connexion Google non configurée. Ajoute GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env.'});
      const state=crypto.randomBytes(24).toString('hex');googleStates.set(state,Date.now());
      const redirectUri=(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,'')+'/auth/google/callback';
      const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,prompt:'select_account'});
      res.writeHead(302,{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+q.toString(),'Cache-Control':'no-store'});return res.end();
    }
    if (req.method === 'GET' && pathname === '/auth/google/callback') {
      const state=url.searchParams.get('state'),code=url.searchParams.get('code');
      if(!state||!googleStates.has(state)||Date.now()-googleStates.get(state)>10*60*1000||!code)return send(res,400,'Connexion Google invalide ou expirée. Recommence.','text/plain; charset=utf-8');googleStates.delete(state);
      const redirectUri=(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,'')+'/auth/google/callback';
      const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri,grant_type:'authorization_code'})});
      if(!tokenRes.ok)return send(res,502,'Impossible de valider la connexion Google.','text/plain; charset=utf-8');const token=await tokenRes.json();
      const userRes=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});if(!userRes.ok)return send(res,502,'Impossible de récupérer le profil Google.','text/plain; charset=utf-8');const u=await userRes.json();
      if(!u.email||!u.email_verified)return send(res,400,'Google doit confirmer ton adresse e-mail.','text/plain; charset=utf-8');
      const payload={email:String(u.email).toLowerCase(),first:String(u.given_name||u.name||'').slice(0,80),last:String(u.family_name||'').slice(0,80),googleId:String(u.sub||''),picture:String(u.picture||'')};
      const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Connexion NORD 51</title><body><p>Connexion Google réussie. Redirection…</p><script>const u=${JSON.stringify(payload)};const users=JSON.parse(localStorage.getItem('users')||'{}');const old=users[u.email]||{};users[u.email]={...old,first:old.first||u.first,last:old.last||u.last,googleId:u.googleId,googlePicture:u.picture,addresses:old.addresses||[],created:old.created||new Date().toISOString()};localStorage.setItem('users',JSON.stringify(users));localStorage.setItem('session',JSON.stringify(u.email));location.replace('/#/compte');</script></body></html>`;
      return send(res,200,html,'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      const db = readDB(); const settings = db.settings || { paymentMode: 'stripe', freeShippingAlways: false };
      const promos = (db.promoCodes || []).filter(c => c.active !== false).map(c => [String(c.code).toUpperCase(), {type:c.type, value:Number(c.value)||0}]);
      return send(res, 200, { shopName: 'NORD 51', categories: CATEGORIES, freeShippingAlways: !!settings.freeShippingAlways, emailConfigured: mailReady(), stripeConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.APP_URL), promoCodes: Object.fromEntries(promos), payment: { mode: 'stripe' } });
    }
    if (req.method === 'GET' && pathname === '/api/products') {
      const db = readDB();
      return send(res, 200, db.products.filter(p => p.status === 'available' && Number(p.stock ?? 1) > 0).map(publicProduct));
    }
    if (req.method === 'POST' && pathname === '/api/newsletter') {
      const b=await readBody(req), email=String(b.email||'').trim().toLowerCase();
      if(!emailValid(email)) return send(res,400,{error:'Adresse e-mail invalide.'});
      if(b.consent!==true) return send(res,400,{error:'Le consentement aux e-mails est obligatoire.'});
      const db=readDB(); db.subscribers=db.subscribers||[];
      if(!db.subscribers.some(x=>x.email===email)) db.subscribers.push({email,consent:true,subscribedAt:new Date().toISOString()});
      writeDB(db); return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && pathname === '/api/newsletter/unsubscribe') {
      const email=String(url.searchParams.get('email')||'').trim().toLowerCase(), db=readDB();
      db.subscribers=(db.subscribers||[]).filter(x=>x.email!==email); writeDB(db);
      return send(res,200,'<html lang="fr"><meta charset="utf-8"><title>NORD 51</title><p>Tu es désinscrit(e) des e-mails promotionnels NORD 51.</p></html>','text/html; charset=utf-8');
    }
    if (req.method === 'POST' && pathname === '/api/account/login-notice') {
      const b=await readBody(req), email=String(b.email||'').trim().toLowerCase();
      if(!emailValid(email)) return send(res,400,{error:'Adresse e-mail invalide.'});
      const ip=String(req.socket.remoteAddress||'unknown'), ipKey='ip:'+ip, ipLast=mailLimits.get(ipKey)||0;
      if(Date.now()-ipLast<60*1000)return send(res,429,{error:'Patiente une minute avant de demander un nouvel e-mail.'});
      mailLimits.set(ipKey,Date.now());
      const key='login:'+email, now=Date.now(), last=mailLimits.get(key)||0;
      if(now-last<15*60*1000) return send(res,429,{error:'E-mail de connexion déjà envoyé récemment.'});
      mailLimits.set(key,now);
      if(!mailReady()) return send(res,503,{error:'Connexion effectuée, mais les e-mails ne sont pas configurés dans le fichier .env.'});
      const promoDb=readDB(); const marketingOptIn=(promoDb.subscribers||[]).some(x=>x.email===email&&x.consent===true); promoDb.promoCodes=promoDb.promoCodes||[]; let coupon=promoDb.promoCodes.find(c=>String(c.code).toUpperCase()==='BIENVENUE10'); if(!coupon){coupon={code:'BIENVENUE10',type:'percent',value:10,active:true};promoDb.promoCodes.push(coupon);writeDB(promoDb)} else if(coupon.active===false){coupon.active=true;coupon.type='percent';coupon.value=10;writeDB(promoDb)}
      try { await sendMail(email,'Connexion à ton compte NORD 51',`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h1>NORD 51</h1><p>Une connexion à ton compte NORD 51 vient d’être effectuée le ${new Date().toLocaleString('fr-FR')}.</p><p>Si c’était toi, tu peux ignorer ce message. Si ce n’était pas toi, change ton mot de passe.</p>${marketingOptIn ? `<hr><h2>Un cadeau pour toi : -10 %</h2><p>Utilise le code <b>${coupon.code}</b> lors de ta prochaine commande, sous réserve des conditions de la boutique.</p>` : ''}<p>Si tu n’es pas à l’origine de cette connexion, contacte le support de la boutique.</p></div>`); return send(res,200,{ok:true}); }
      catch(e){return send(res,502,{error:'Impossible d’envoyer l’e-mail : vérifie la configuration SMTP.'});}
    }
    if (req.method === 'POST' && pathname === '/api/orders') return send(res, 410, { error: 'Les commandes doivent être payées via Stripe Checkout.' });
    if (req.method === 'POST' && pathname === '/api/stripe/checkout') {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.APP_URL) return send(res, 503, {error:'Paiement Stripe non configuré. Configure STRIPE_SECRET_KEY et APP_URL dans les variables du serveur.'});
      const b = await readBody(req); const db = readDB();
      if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email)) || !b.acceptTerms || !b.shippingAddress || !Array.isArray(b.items) || !b.items.length) return send(res,400,{error:'Informations de commande incomplètes.'});
      const items=[];
      for (const line of b.items) { const p=db.products.find(x=>String(x.id)===String(line.pid)&&x.status==='available'); const qty=Math.max(1,Math.min(20,Math.floor(Number(line.qty)||1))); if(!p) return send(res,400,{error:'Un article n’est plus disponible.'}); if(Number(p.stock??1)<qty) return send(res,400,{error:`Stock insuffisant pour ${p.title}. Reste : ${Math.max(0,Number(p.stock??1))}.`}); items.push({id:p.id,title:p.title,brand:p.brand||'',size:String(line.size||p.size||'Unique'),color:String(line.color||p.color||''),qty,price:Number(p.price)}); }
      const sub=Math.round(items.reduce((a,i)=>a+i.price*i.qty,0)*100)/100, promo=String(b.promo||'').trim().toUpperCase(), pc=(db.promoCodes||[]).find(c=>String(c.code).toUpperCase()===promo&&c.active!==false); if(promo&&!pc)return send(res,400,{error:'Code promo invalide.'});
      const discount=pc&&pc.type==='percent'?Math.round(sub*Math.min(100,Math.max(0,Number(pc.value)||0)))/100:0, after=Math.max(0,sub-discount), delivery=String(b.delivery||(String(b.carrierId||'').toLowerCase().includes('mondial')?'Point relais':'Livraison à domicile')), shipCost=(db.settings?.freeShippingAlways)||after>=99||(pc&&pc.type==='ship')?0:(delivery.toLowerCase().includes('relais')?3.9:4.9), total=Math.round((after+shipCost)*100)/100;
      const ship=b.shippingAddress, ref='CMD-'+new Date().getFullYear()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(), order={id:crypto.randomUUID(),ref,date:new Date().toISOString(),email:String(b.email).slice(0,200),name:String(ship.name||''),productTitle:items.map(i=>`${i.qty}× ${i.title}`).join(', '),items,totals:{sub,discount,after,ship:shipCost,total,code:pc?promo:''},price:total,delivery,relay:b.relay||null,ship:{first:String(ship.first||''),last:String(ship.last||''),name:String(ship.name||''),line1:String(ship.line1||''),line2:String(ship.line2||''),zip:String(ship.postcode||ship.zip||''),city:String(ship.city||''),country:String(ship.country||'France'),phone:String(ship.phone||'')},billingAddress:b.billingAddress||null,paymentMethod:'Carte bancaire (Stripe)',status:'paiement en cours',stripeSessionId:null,stockReserved:true};
      // Reserve stock before redirecting to prevent overselling.
      for(const i of items){const p=db.products.find(x=>String(x.id)===String(i.id));p.stock=Math.max(0,Number(p.stock??1)-i.qty);} db.orders=db.orders||[];db.orders.unshift(order);writeDB(db);
      const params=new URLSearchParams();params.set('mode','payment');params.set('customer_email',order.email);params.set('success_url',process.env.APP_URL.replace(/\/$/,'')+'/#/confirmation/'+ref);params.set('cancel_url',process.env.APP_URL.replace(/\/$/,'')+'/#/panier?payment=cancelled');params.set('metadata[orderId]',order.id);params.set('payment_intent_data[metadata][orderId]',order.id);
      params.set('line_items[0][quantity]','1');params.set('line_items[0][price_data][currency]','eur');params.set('line_items[0][price_data][unit_amount]',String(Math.round(total*100)));params.set('line_items[0][price_data][product_data][name]','Commande NORD 51 — '+items.map(i=>`${i.qty}× ${i.title}`).join(', '));
      try { const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:params}); const d=await r.json(); if(!r.ok||!d.url)throw new Error(d.error?.message||'Stripe ne peut pas créer la session de paiement.'); order.stripeSessionId=d.id;writeDB(db);return send(res,200,{url:d.url,order}); }
      catch(e){ for(const i of items){const p=db.products.find(x=>String(x.id)===String(i.id));if(p)p.stock=Number(p.stock||0)+i.qty;} db.orders=db.orders.filter(o=>o.id!==order.id);writeDB(db);return send(res,502,{error:e.message||'Erreur Stripe.'}); }
    }
    if (req.method === 'POST' && pathname === '/api/stripe/webhook') {
      if(!process.env.STRIPE_WEBHOOK_SECRET)return send(res,503,{error:'Webhook Stripe non configuré.'});
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);const sig=req.headers['stripe-signature']||'';const parts=Object.fromEntries(sig.split(',').map(x=>x.split('=')));const ts=parts.t;const expected=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');const v1=sig.split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));if(!ts||Math.abs(Date.now()/1000-Number(ts))>300||!v1.some(x=>x.length===expected.length&&crypto.timingSafeEqual(Buffer.from(x),Buffer.from(expected))) )return send(res,400,{error:'Signature Stripe invalide.'});
      const event=JSON.parse(raw.toString('utf8'));const db=readDB();const obj=event.data?.object;let order=(db.orders||[]).find(o=>o.id===(obj?.metadata?.orderId));
      if(order&&event.type==='checkout.session.completed'&&obj.payment_status==='paid'){order.status='payée';order.statusHistory=order.statusHistory||[];order.statusHistory.push({status:'payée',from:'paiement en cours',at:new Date().toISOString()});order.paidAt=new Date().toISOString();order.stockReserved=false;writeDB(db);if(mailReady()){sendMail(order.email,'Paiement confirmé — NORD 51 '+order.ref,`<h1>NORD 51</h1><p>Ton paiement de ${Number(order.price).toFixed(2)} € pour la commande ${order.ref} est confirmé.</p><p>Merci pour ta commande !</p>`).catch(()=>{});if(process.env.ADMIN_NOTIFY_EMAIL)sendMail(process.env.ADMIN_NOTIFY_EMAIL,'Paiement reçu — '+order.ref,`<p>Paiement confirmé pour ${order.email}, ${Number(order.price).toFixed(2)} €.</p>`).catch(()=>{});}}
      if(order&&event.type==='checkout.session.expired'&&order.status==='paiement en cours'&&order.stockReserved){for(const i of order.items||[]){const p=db.products.find(x=>String(x.id)===String(i.id));if(p)p.stock=Number(p.stock||0)+Number(i.qty||0)}order.status='paiement expiré';order.statusHistory=order.statusHistory||[];order.statusHistory.push({status:'paiement expiré',from:'paiement en cours',at:new Date().toISOString()});order.stockReserved=false;writeDB(db)}
      return send(res,200,{received:true});
    }
    if (pathname.startsWith('/api/admin/')) {
      const db = readDB();
      if (req.method === 'GET' && pathname === '/api/admin/products')
        return send(res, 200, db.products);
      if (req.method === 'POST' && pathname === '/api/admin/products') {
        const b = await readBody(req);
        if (!b.title || !Number.isFinite(Number(b.price))) return send(res, 400, { error: 'Titre et prix obligatoires.' });
        const item = { ...b, photos: Array.isArray(b.photos) && b.photos.length ? b.photos.slice(0,6) : (b.photo ? [b.photo] : []), photo: b.photo || (Array.isArray(b.photos)&&b.photos[0]) || '', id: crypto.randomUUID(), price: Number(b.price), stock: Math.max(0, Math.floor(Number(b.stock ?? 1))), status: b.status || 'available', createdAt: new Date().toISOString() };
        db.products.unshift(item); audit(db,'Création article',item.title,null,item); writeDB(db); return send(res, 201, item);
      }
      const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if (productMatch) {
        const i = db.products.findIndex(p => String(p.id) === productMatch[1]);
        if (req.method === 'PUT') {
          const b = await readBody(req);
          if (i < 0) return send(res, 404, { error: 'Article introuvable.' });
          const before=JSON.parse(JSON.stringify(db.products[i])); db.products[i] = { ...db.products[i], ...b, id: db.products[i].id };
          if (Array.isArray(b.photos)) { db.products[i].photos = b.photos.slice(0,6); db.products[i].photo = db.products[i].photos[0] || ''; } else if (b.photo) { db.products[i].photo = b.photo; if (!db.products[i].photos?.length) db.products[i].photos = [b.photo]; }
          if (b.price !== undefined) db.products[i].price = Number(b.price); if (b.costPrice !== undefined) db.products[i].costPrice = Math.max(0,Number(b.costPrice)||0);
          if (b.stock !== undefined) db.products[i].stock = Math.max(0, Math.floor(Number(b.stock)||0));
          audit(db,'Modification article',db.products[i].title,before,db.products[i]); writeDB(db); return send(res, 200, db.products[i]);
        }
        if (req.method === 'DELETE') {
          if (i < 0) return send(res, 404, { error: 'Article introuvable.' });
          const removed=db.products[i]; db.products.splice(i, 1); audit(db,'Suppression article',removed.title,removed,null); writeDB(db); return send(res, 200, { ok: true });
        }
      }
      if (req.method === 'GET' && pathname === '/api/admin/config') return send(res, 200, { paymentMode: 'stripe', freeShippingAlways: !!db.settings?.freeShippingAlways, stripeConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.APP_URL), emailConfigured: mailReady(), subscriberCount: (db.subscribers||[]).length, promoCodes: db.promoCodes || [] });
      if (req.method === 'POST' && pathname === '/api/admin/config') {
        const b = await readBody(req);
        db.settings = { ...(db.settings||{}), paymentMode: 'stripe', freeShippingAlways: b.freeShippingAlways === true };
        writeDB(db); return send(res, 200, db.settings);
      }
      if (req.method === 'GET' && pathname === '/api/admin/promos') return send(res, 200, db.promoCodes || []);
      if (req.method === 'POST' && pathname === '/api/admin/promos') {
        const b = await readBody(req); const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
        const type = ['percent','ship'].includes(b.type) ? b.type : 'percent'; const value = type === 'percent' ? Math.min(100, Math.max(1, Number(b.value)||1)) : 0;
        if (!code) return send(res, 400, {error:'Saisis un code promo.'});
        db.promoCodes = db.promoCodes || []; const old = db.promoCodes.findIndex(c => String(c.code).toUpperCase() === code);
        const promo = {code,type,value,active:b.active !== false}; if (old >= 0) db.promoCodes[old] = promo; else db.promoCodes.push(promo); writeDB(db); return send(res, 200, promo);
      }
      const promoMatch = pathname.match(/^\/api\/admin\/promos\/([^/]+)$/);
      if (req.method === 'DELETE' && promoMatch) { db.promoCodes = (db.promoCodes||[]).filter(c => String(c.code).toUpperCase() !== promoMatch[1].toUpperCase()); writeDB(db); return send(res,200,{ok:true}); }
      if (req.method === 'GET' && pathname === '/api/admin/marketing') return send(res,200,{emailConfigured:mailReady(),subscribers:(db.subscribers||[]).map(x=>({email:x.email,subscribedAt:x.subscribedAt})),subscriberCount:(db.subscribers||[]).length});
      if (req.method === 'POST' && pathname === '/api/admin/marketing/send') {
        const b=await readBody(req), subject=String(b.subject||'').trim().slice(0,140), message=String(b.message||'').trim().slice(0,6000);
        if(!subject||!message)return send(res,400,{error:'Ajoute un objet et un message.'});
        if(!mailReady())return send(res,503,{error:'Configure SMTP dans le fichier .env avant d’envoyer des e-mails.'});
        const list=(db.subscribers||[]).filter(x=>x.consent===true&&emailValid(x.email)); let sent=0,failed=0;
        for(const sub of list){try{const safe=message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');const un= (process.env.APP_URL||'http://localhost:'+PORT)+'/api/newsletter/unsubscribe?email='+encodeURIComponent(sub.email);await sendMail(sub.email,subject,`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h1>NORD 51</h1><div>${safe}</div><hr><p style="font-size:12px;color:#777">Tu reçois cet e-mail car tu as accepté les offres NORD 51. <a href="${un}">Se désinscrire</a>.</p></div>`);sent++;}catch{failed++;}}
        return send(res,200,{sent,failed,total:list.length});
      }
      if (req.method === 'GET' && pathname === '/api/admin/analytics') return send(res,200,{products:db.products||[],orders:db.orders||[],audit:(db.audit||[]).slice(0,250)});
      if (req.method === 'GET' && pathname === '/api/admin/audit') return send(res,200,(db.audit||[]).slice(0,250));
      if (req.method === 'POST' && pathname === '/api/admin/audit/undo') {
        const b=await readBody(req), entry=(db.audit||[]).find(x=>x.id===b.id); if(!entry||!entry.before||!entry.entity)return send(res,400,{error:'Cette modification ne peut pas être annulée.'});
        const i=db.products.findIndex(p=>String(p.id)===String(entry.before.id)); if(i<0)return send(res,404,{error:'Article supprimé ou introuvable.'});
        const current=JSON.parse(JSON.stringify(db.products[i])); db.products[i]={...entry.before}; audit(db,'Annulation modification',entry.entity,current,db.products[i]); writeDB(db); return send(res,200,{ok:true});
      }
      if (req.method === 'GET' && pathname === '/api/admin/customers') {
        const map=new Map(); for(const o of (db.orders||[])){const email=String(o.email||'').toLowerCase();if(!email)continue;const c=map.get(email)||{email,name:o.name||[o.ship?.first,o.ship?.last].filter(Boolean).join(' '),orders:[],total:0,lastPurchase:null};c.orders.push(o);if(['payée','expédiée','livrée'].includes(o.status))c.total+=Number(o.totals?.total??o.price??0);if(!c.lastPurchase||new Date(o.date)>new Date(c.lastPurchase))c.lastPurchase=o.date;map.set(email,c)}return send(res,200,[...map.values()].map(c=>({...c,count:c.orders.length})).sort((a,b)=>new Date(b.lastPurchase||0)-new Date(a.lastPurchase||0)));
      }
      if (req.method === 'GET' && pathname === '/api/admin/orders') return send(res, 200, db.orders || []);
      const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/(paid|cancel|shipped|delivered)$/);
      if (req.method === 'POST' && orderMatch) {
        const order = (db.orders || []).find(o => String(o.id) === orderMatch[1]);
        if (!order) return send(res, 404, { error: 'Commande introuvable.' });
        const previousStatus=order.status; if(orderMatch[2] === 'cancel' && order.stockReserved){for(const i of order.items||[]){const p=db.products.find(x=>String(x.id)===String(i.id));if(p)p.stock=Number(p.stock||0)+Number(i.qty||0)}order.stockReserved=false;} order.status = ({paid:'payée',cancel:'annulée',shipped:'expédiée',delivered:'livrée'})[orderMatch[2]]; order.statusHistory=order.statusHistory||[]; order.statusHistory.push({status:order.status,from:previousStatus,at:new Date().toISOString()}); audit(db,'Statut commande',order.ref,{status:previousStatus},{status:order.status}); writeDB(db); return send(res, 200, order);
      }
      return send(res, 404, { error: 'Route API inconnue.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Méthode non autorisée.' });
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return send(res, 404, 'Fichier introuvable.', 'text/plain; charset=utf-8');
    const ext = path.extname(file).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message || 'Erreur serveur.' });
    else res.end();
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Boutique lancée : http://localhost:${PORT}`);
  console.log(`Administration : http://localhost:${PORT}/admin.html`);
  console.log('ATTENTION : administration sans mot de passe, à utiliser uniquement en local / réseau de confiance.');
});
