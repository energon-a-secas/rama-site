/**
 * NeoKeys — the H chrome toggle.
 *
 * Hides the header bar and the footer, handing the page back the vertical
 * space they occupy. Measured on sortie-site: 56px of header plus 48.6px of
 * footer, 104.6px total, 13% of an 800px viewport.
 */

const COOKIE = 'neo_chrome';

/* The hiding itself lives in keys.css, keyed on html[data-chrome="off"].
   Earlier versions set inline display because the kit's .header-hidden class
   belongs to the app-mode scroll handler, which puts the bar back on the
   next scroll up. A kit-owned attribute that handler never touches has the
   same immunity without the inline style, and it lets a pre-paint guard in
   <head> apply the stored state before the bar ever flashes:

     <script>try{if(/(?:^|;\s*)neo_chrome=off/.test(document.cookie))
       document.documentElement.dataset.chrome='off'}catch(e){}</script>

   Docked-rail sites key their companion rules off the same attribute. */

let toastEl = null;

function readCookie() {
  const m = document.cookie.match(/(?:^|;\s*)neo_chrome=(on|off)/);
  return m ? m[1] : null;
}

function writeCookie(value) {
  /* Domain-scoped like neo_theme, so a visitor who wants a clean canvas gets
     it on every Neorgon tab rather than the one they set it in. On localhost
     the domain attribute is omitted — a Domain= that does not match the host
     makes the browser drop the cookie silently, which is a confusing way to
     find out your preference never saved. */
  const onNeorgon = location.hostname.endsWith('neorgon.com');
  const domain = onNeorgon ? '; domain=.neorgon.com' : '';
  document.cookie = `${COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${domain}`;
}

export function isHidden() {
  return document.documentElement.dataset.chrome === 'off';
}

/* Header-only by default: on a content site the footer carries the licence
   and source links, which must survive the toggle (#41). Canvas sites that
   want the full 105px opt into scope "full", which also hides the footer.
   Site config, not a preference, so it is set every load and never stored. */
export function setScope(full) {
  if (full) document.documentElement.dataset.chromeScope = 'full';
  else delete document.documentElement.dataset.chromeScope;
}

export function isFull() {
  return document.documentElement.dataset.chromeScope === 'full';
}

function paint(on) {
  document.documentElement.dataset.chrome = on ? 'on' : 'off';
  /* Canvas and panel sites re-measure on this rather than polling: the bar
     appearing or leaving changes the stage height. */
  document.dispatchEvent(new CustomEvent('neo-chrome', { detail: { hidden: !on } }));
}

function toast(message) {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'nk-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.textContent = message;
  document.body.appendChild(toastEl);
  requestAnimationFrame(() => toastEl.classList.add('is-in'));
  setTimeout(() => {
    toastEl?.classList.remove('is-in');
    setTimeout(() => toastEl?.remove(), 300);
  }, 3200);
}

export function show() {
  paint(true);
  writeCookie('on');
}

export function hide() {
  /* A dropdown or auth panel open inside the bar would vanish with it and
     come back later in a stale half-open state; close anything expanded
     first, through its own toggle so listeners stay consistent. */
  document.querySelectorAll('.header-bar [aria-expanded="true"]').forEach((b) => b.click());
  paint(false);
  writeCookie('off');
  /* Hiding the bar removes the only visible control that brings it back, so
     the key is the sole remaining path and the toast is the only thing that
     names it. It has to appear at the moment it becomes the only path. */
  toast('Chrome hidden. Press H to bring it back.');
}

export function toggle() {
  isHidden() ? show() : hide();
}

/**
 * Apply the stored preference on load.
 *
 * The original proposal fired its toast only on toggle, which leaves the
 * restored case with no discovery path at all: a returning visitor lands on a
 * chrome-less page, nothing was toggled, so nothing tells them why or how to
 * undo it. That is precisely the failure the toast exists to prevent, so a
 * cookie-restored hide announces itself too.
 */
export function restore() {
  if (readCookie() !== 'off') {
    paint(true);
    return;
  }
  paint(false);
  toast('Chrome is hidden from a previous visit. Press H to bring it back.');
}
