// "Send us a message" (Learn & help → Contact us). The form is public; the
// inbox under it is Owner-only (data-owner-only hides it, and the server
// checks the Owner session on every inbox call). See lib/contact-messages.mjs.
import { LIMITS } from '../../lib/contact-messages.mjs';

export function contactSection() {
  return `<section class="card contact-box" id="contact-section">
    <h2>Your message</h2>
    <p class="hint">Questions, ideas, bug reports or anything else. Only the site owners can read what you send. Add an email or a social link if you would like a reply.</p>
    <form id="contact-form" class="contact-form" novalidate>
      <label class="contact-field"><span>Title</span>
        <input type="text" name="title" id="contact-title" maxlength="${LIMITS.TITLE_MAX}" required autocomplete="off" placeholder="What is it about?" /></label>
      <label class="contact-field"><span>Message</span>
        <textarea name="message" id="contact-message" rows="7" maxlength="${LIMITS.MESSAGE_MAX}" required placeholder="Write your message"></textarea>
        <small class="contact-count" id="contact-count" aria-live="polite">0 / ${LIMITS.MESSAGE_MAX}</small></label>
      <label class="contact-field"><span>Your name <em>(optional)</em></span>
        <input type="text" name="name" id="contact-name" maxlength="${LIMITS.NAME_MAX}" autocomplete="name" /></label>
      <label class="contact-field"><span>Email or social links <em>(optional, one per line, up to ${LIMITS.CONTACTS_MAX})</em></span>
        <textarea name="contacts" id="contact-contacts" rows="3" maxlength="${LIMITS.CONTACTS_MAX * (LIMITS.CONTACT_MAX + 1)}" placeholder="you@example.com&#10;https://x.com/yourname&#10;@yourhandle" autocomplete="off"></textarea></label>
      <div class="contact-hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
      <div class="contact-actions">
        <button type="submit" class="contact-send" id="contact-send">Send message</button>
        <p class="contact-status" id="contact-status" role="status" aria-live="polite"></p>
      </div>
      <p class="contact-note">Please do not send passwords, account numbers or other private details.</p>
    </form>
  </section>
  <section class="card contact-inbox" id="contact-inbox" data-owner-only hidden>
    <div class="contact-inbox-head"><h2>Messages <span class="contact-unread" id="contact-unread"></span></h2>
      <div class="contact-inbox-tools"><button type="button" class="book-more" data-ci-refresh>Refresh</button><button type="button" class="book-more" data-ci-readall>Mark all read</button></div></div>
    <p class="hint">Owner only. Messages people sent with the box above, newest first.</p>
    <div id="contact-inbox-list" aria-live="polite"></div>
  </section>`;
}

export const contactCss = `
.contact-box { max-width: 760px; }
.contact-form { display: grid; gap: 16px; margin-top: 18px; }
.contact-field { display: grid; gap: 6px; font: 600 13px/1.4 var(--font-sans); color: var(--text); position: relative; }
.contact-field em { font-style: normal; font-weight: 400; color: var(--muted); }
.contact-field input, .contact-field textarea { width: 100%; box-sizing: border-box; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font: 400 14px/1.5 var(--font-sans); resize: vertical; }
.contact-field input:focus-visible, .contact-field textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.contact-field [aria-invalid="true"] { border-color: var(--neg); }
.contact-count { justify-self: end; font: 400 12px/1 var(--font-sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.contact-hp { position: absolute !important; left: -10000px !important; width: 1px; height: 1px; overflow: hidden; }
.contact-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.contact-send { background: var(--accent); color: #1a1408; border: 0; border-radius: 8px; padding: 10px 18px; font: 700 14px/1 var(--font-sans); cursor: pointer; min-height: 40px; }
.contact-send:hover, .contact-send:focus-visible { background: var(--accent-strong); }
.contact-send[disabled] { opacity: .6; cursor: progress; }
.contact-status { margin: 0; font-size: 13px; color: var(--muted-strong); }
.contact-status[data-tone="ok"] { color: var(--pos); }
.contact-status[data-tone="bad"] { color: var(--neg); }
.contact-note { margin: 0; font-size: 12px; color: var(--muted); }
.contact-inbox { max-width: 760px; }
.contact-inbox[hidden] { display: none; }
.contact-inbox-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.contact-inbox-head h2 { margin: 0; }
.contact-inbox-tools { display: flex; gap: 8px; }
.contact-inbox-tools .book-more { margin: 0; }
.contact-unread { font: 600 12px/1 var(--font-sans); color: var(--accent); margin-left: 6px; vertical-align: middle; }
.ci-msg { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-top: 12px; min-width: 0; overflow-wrap: anywhere; }
.ci-msg[data-read="0"] { border-left: 3px solid var(--accent); }
.ci-msg h3 { margin: 0; font-size: 15px; }
.ci-meta { margin: 4px 0 10px; font-size: 12px; color: var(--muted); }
.ci-body { white-space: pre-wrap; font-size: 14px; line-height: 1.6; margin: 0; }
.ci-contacts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 13px; }
.ci-actions { display: flex; gap: 8px; margin-top: 12px; }
.ci-actions .book-more { margin: 0; }
.ci-empty { color: var(--muted); font-size: 13px; }
@media (max-width: 640px) { .contact-send { width: 100%; } .contact-inbox-head { align-items: flex-start; } }
`;

// Serialized into the browser bundle.
export function contactClient(window, document, ctx) {
  var ticket = null, ticketAt = 0, sending = false, inbox = null, inboxBusy = false, bound = false;
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function status(text, tone){ var el=$('contact-status'); if(!el)return; el.textContent=text||''; if(tone)el.setAttribute('data-tone',tone); else el.removeAttribute('data-tone'); }
  async function getTicket(){
    try {
      var r = await window.fetch('/api/auth/contact',{credentials:'same-origin',cache:'no-store'});
      var v = await r.json().catch(function(){return {};});
      if(r.ok && v.ticket){ ticket=v.ticket; ticketAt=Date.now(); return true; }
      ticket=null; status(v.error||'The message box is not available right now.','bad'); return false;
    } catch(e){ ticket=null; status('The message box could not load. Check your connection and reload.','bad'); return false; }
  }
  function count(){ var t=$('contact-message'),c=$('contact-count'); if(t&&c)c.textContent=t.value.length+' / '+t.maxLength; }
  function mark(el,bad){ if(!el)return; if(bad)el.setAttribute('aria-invalid','true'); else el.removeAttribute('aria-invalid'); }
  async function submit(ev){
    ev.preventDefault();
    if(sending)return;
    var form=$('contact-form'), title=$('contact-title'), msg=$('contact-message');
    mark(title,!title.value.trim()); mark(msg,msg.value.trim().length<5);
    if(!title.value.trim()){ status('Add a title.','bad'); title.focus(); return; }
    if(msg.value.trim().length<5){ status('Write a message.','bad'); msg.focus(); return; }
    // A ticket older than five hours is close to expiring; fetch a fresh one.
    if(!ticket || Date.now()-ticketAt>5*3600*1000){ if(!(await getTicket()))return; await new Promise(function(res){ window.setTimeout(res, 3200); }); }
    var contacts=$('contact-contacts').value.split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
    var body={ ticket:ticket, title:title.value, message:msg.value, name:$('contact-name').value, contacts:contacts, website:form.elements.website.value };
    sending=true; var btn=$('contact-send'); btn.disabled=true; btn.textContent='Sending…'; status('');
    try {
      var r=await window.fetch('/api/auth/contact',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var v=await r.json().catch(function(){return {};});
      if(r.ok && v.ok){
        form.reset(); count(); ticket=null; status('Thanks, your message was sent.','ok'); getTicket();
        if(ctx.owner()) loadInbox();
      } else {
        if(v.reload){ ticket=null; getTicket(); }
        status(v.error||'Your message could not be sent. Try again.','bad');
      }
    } catch(e){ status('Your message could not be sent. Check your connection and try again.','bad'); }
    finally { sending=false; btn.disabled=false; btn.textContent='Send message'; }
  }
  function when(v){ var n=Date.parse(v); return isFinite(n)?new Date(n).toLocaleString():''; }
  function contactHtml(c){
    if(c.kind==='email') return '<a href="mailto:'+esc(c.value)+'">'+esc(c.value)+'</a>';
    if(c.kind==='link' && /^https?:\/\//i.test(c.value)) return '<a href="'+esc(c.value)+'" target="_blank" rel="noopener noreferrer nofollow ugc">'+esc(c.value)+'</a>';
    return '<span>'+esc(c.value)+'</span>';
  }
  function renderInbox(error){
    var list=$('contact-inbox-list'), unread=$('contact-unread'); if(!list)return;
    if(!ctx.owner()){ list.innerHTML=''; if(unread)unread.textContent=''; return; }
    if(error){ list.innerHTML='<p class="ci-empty">'+esc(error)+'</p>'; return; }
    if(!inbox){ list.innerHTML='<p class="ci-empty">Loading messages…</p>'; return; }
    if(unread) unread.textContent=inbox.unread?inbox.unread+' new':'';
    if(!inbox.messages.length){ list.innerHTML='<p class="ci-empty">No messages yet.</p>'; return; }
    list.innerHTML=inbox.messages.map(function(m){
      return '<article class="ci-msg" data-read="'+(m.read?'1':'0')+'" data-id="'+esc(m.id)+'"><h3>'+esc(m.title)+'</h3>'+
        '<p class="ci-meta">'+esc(when(m.at))+(m.name?' · from '+esc(m.name):'')+(m.read?'':' · new')+'</p>'+
        '<p class="ci-body">'+esc(m.body)+'</p>'+
        (m.contacts&&m.contacts.length?'<ul class="ci-contacts">'+m.contacts.map(function(c){return '<li>'+contactHtml(c)+'</li>';}).join('')+'</ul>':'')+
        '<div class="ci-actions"><button type="button" class="book-more" data-ci-op="'+(m.read?'unread':'read')+'">'+(m.read?'Mark unread':'Mark read')+'</button><button type="button" class="book-more" data-ci-op="delete">Delete</button></div></article>';
    }).join('');
  }
  async function inboxCall(method, body){
    var r=await window.fetch('/api/auth/contact-inbox',{method:method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    if(r.status===401||r.status===403){ inbox=null; ctx.revoke(); return null; }
    var v=await r.json().catch(function(){return null;});
    if(!r.ok||!v||!Array.isArray(v.messages)) throw new Error((v&&v.error)||'Messages are unavailable. Try again.');
    return v;
  }
  async function loadInbox(){
    if(!ctx.owner()||inboxBusy)return; inboxBusy=true;
    var box=$('contact-inbox'); if(box) box.hidden=false;
    renderInbox();
    try { var v=await inboxCall('GET'); if(v){ inbox=v; renderInbox(); } }
    catch(e){ renderInbox(e.message); }
    finally { inboxBusy=false; }
  }
  async function op(name,id){
    if(name==='delete' && !window.confirm('Delete this message? This cannot be undone.'))return;
    try { var v=await inboxCall('POST',id?{op:name,id:id}:{op:name}); if(v){ inbox=v; renderInbox(); } }
    catch(e){ renderInbox(e.message); }
  }
  function bind(){
    if(bound)return; var form=$('contact-form'); if(!form)return; bound=true;
    form.addEventListener('submit',submit);
    $('contact-message').addEventListener('input',function(){ count(); mark(this,false); });
    $('contact-title').addEventListener('input',function(){ mark(this,false); });
    var box=$('contact-inbox');
    if(box) box.addEventListener('click',function(ev){
      var t=ev.target.closest('button'); if(!t)return;
      if(t.hasAttribute('data-ci-refresh')) return loadInbox();
      if(t.hasAttribute('data-ci-readall')) return op('read-all');
      var name=t.getAttribute('data-ci-op'), art=t.closest('.ci-msg');
      if(name&&art) op(name,art.getAttribute('data-id'));
    });
  }
  function load(){
    bind(); count();
    if(!ticket || Date.now()-ticketAt>5*3600*1000) getTicket();
    if(ctx.owner()) loadInbox();
  }
  function reset(){ inbox=null; var box=$('contact-inbox'); if(box) box.hidden=true; renderInbox(); }
  // Sign-in can finish after the page opened; show the inbox then.
  document.addEventListener('stonks-owner-ready', function(){ var pane=$('page-pane-contact'); if(ctx.owner() && pane && !pane.hidden) loadInbox(); });
  return { load:load, reset:reset };
}
