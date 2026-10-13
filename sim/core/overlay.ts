/**
 * Injected into every simulator browser page (context.addInitScript) before the app's own scripts. Draws what a
 * viewer needs to follow the run: a cursor that glides to each target, a ripple on every click, a caption with
 * the current case and step, a role badge, and the case cards between cases. Nothing here touches the app.
 *
 * The function body runs in the browser, so it must stay self-contained (no imports, no outer variables).
 */
function overlayMain() {
  type CardOpts = { title: string; badge?: string; tone?: string; lines?: string[]; foot?: string; button?: string; waitMs?: number };
  const w = window as unknown as { __sim?: unknown };
  if (w.__sim) return;

  const state = {
    x: Number(sessionStorage.getItem('sim.x') ?? 160),
    y: Number(sessionStorage.getItem('sim.y') ?? 160),
    moveMs: 380,
    caption: null as null | { head: string; text: string; who: string },
    role: null as null | { label: string; color: string },
  };

  const css = `
    #sim-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
      transition:transform var(--sim-move,380ms) cubic-bezier(.22,.8,.25,1);will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .sim-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;z-index:2147483646;pointer-events:none;
      border:3px solid #f97316;animation:sim-ripple .55s ease-out forwards}
    @keyframes sim-ripple{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
    .sim-focus{outline:3px solid rgba(249,115,22,.85)!important;outline-offset:2px!important;transition:outline-color .3s}
    #sim-caption{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;
      max-width:min(860px,calc(100vw - 48px));background:rgba(15,23,42,.93);color:#fff;border-radius:14px;padding:10px 18px 12px;
      font:500 15px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .2s}
    #sim-caption .h{font:600 12px/1.2 system-ui,Segoe UI,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#fdba74;margin-bottom:3px}
    #sim-caption .who{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:#334155;color:#e2e8f0;text-transform:none;letter-spacing:0}
    #sim-role{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483645;pointer-events:none;color:#fff;
      font:600 13px/1 system-ui,Segoe UI,sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2)}
    #sim-card-wrap{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;
      animation:sim-fade .2s ease-out}
    @keyframes sim-fade{from{opacity:0}to{opacity:1}}
    #sim-card{background:#fff;border-radius:18px;padding:26px 30px;width:min(640px,calc(100vw - 48px));box-shadow:0 30px 80px rgba(0,0,0,.35);
      font:15px/1.5 system-ui,Segoe UI,sans-serif;color:#0f172a}
    #sim-card .badge{display:inline-block;font:700 12px/1 system-ui;letter-spacing:.05em;padding:6px 10px;border-radius:999px;margin-bottom:10px}
    #sim-card h1{font:700 22px/1.25 system-ui,Segoe UI,sans-serif;margin:0 0 10px}
    #sim-card ul{margin:8px 0 0;padding-left:20px}#sim-card li{margin:3px 0}
    #sim-card .foot{margin-top:14px;color:#64748b;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    #sim-card button{font:600 14px system-ui;background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:9px 16px;cursor:pointer}
    #sim-card .bar{height:4px;background:#e2e8f0;border-radius:4px;margin-top:14px;overflow:hidden}
    #sim-card .bar i{display:block;height:100%;background:#f97316;width:0}
  `;

  const cursorSvg =
    '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15.1 L18.6 15.1 Z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  function el(id: string, tag = 'div') {
    let e = document.getElementById(id);
    if (!e) {
      e = document.createElement(tag);
      e.id = id;
      document.documentElement.appendChild(e);
    }
    return e;
  }
  function esc(s: string) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  }
  function placeCursor() {
    const c = document.getElementById('sim-cursor');
    if (c) c.style.transform = `translate(${state.x - 3}px, ${state.y - 2}px)`;
  }
  function renderCaption() {
    const cap = el('sim-caption');
    if (!state.caption) {
      cap.style.opacity = '0';
      return;
    }
    cap.style.opacity = '1';
    cap.innerHTML = `<div class="h">${esc(state.caption.head)}${state.caption.who ? `<span class="who">${esc(state.caption.who)}</span>` : ''}</div>${esc(state.caption.text)}`;
  }
  function renderRole() {
    const r = el('sim-role');
    if (!state.role) {
      r.style.display = 'none';
      return;
    }
    r.style.display = 'block';
    r.style.background = state.role.color;
    r.textContent = state.role.label;
  }
  function mount() {
    if (!document.getElementById('sim-style')) {
      const s = document.createElement('style');
      s.id = 'sim-style';
      s.textContent = css;
      document.documentElement.appendChild(s);
    }
    const c = el('sim-cursor');
    if (!c.innerHTML) c.innerHTML = cursorSvg;
    document.documentElement.style.setProperty('--sim-move', `${state.moveMs}ms`);
    placeCursor();
    renderCaption();
    renderRole();
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      state.x = e.clientX;
      state.y = e.clientY;
      sessionStorage.setItem('sim.x', String(state.x));
      sessionStorage.setItem('sim.y', String(state.y));
      placeCursor();
    },
    true,
  );
  window.addEventListener('mousedown', (e) => ripple(e.clientX, e.clientY), true);
  function ripple(x: number, y: number) {
    const r = document.createElement('div');
    r.className = 'sim-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }

  const api = {
    setSpeed(moveMs: number) {
      state.moveMs = moveMs;
      document.documentElement.style.setProperty('--sim-move', `${moveMs}ms`);
    },
    caption(head: string, text: string, who = '') {
      state.caption = { head, text, who };
      renderCaption();
    },
    clearCaption() {
      state.caption = null;
      renderCaption();
    },
    role(label: string, color: string) {
      state.role = { label, color };
      renderRole();
    },
    ripple,
    focus(sel: Element | null, ms = 900) {
      if (!sel) return;
      sel.classList.add('sim-focus');
      setTimeout(() => sel.classList.remove('sim-focus'), ms);
    },
    /** Shows a card; resolves when its button is clicked, or after waitMs when waitMs > 0. */
    card(o: CardOpts): Promise<void> {
      return new Promise((resolve) => {
        const wrap = el('sim-card-wrap');
        const tone = o.tone ?? '#1d4ed8';
        wrap.innerHTML = `<div id="sim-card">${o.badge ? `<span class="badge" style="background:${tone}1a;color:${tone}">${esc(o.badge)}</span>` : ''}
          <h1>${esc(o.title)}</h1>${(o.lines ?? []).length ? `<ul>${(o.lines ?? []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          <div class="foot"><span>${esc(o.foot ?? '')}</span>${o.button ? `<button id="sim-card-go">${esc(o.button)}</button>` : ''}</div>
          ${o.waitMs && o.waitMs > 0 ? '<div class="bar"><i></i></div>' : ''}</div>`;
        wrap.style.display = 'flex';
        const done = () => {
          wrap.style.display = 'none';
          wrap.innerHTML = '';
          resolve();
        };
        document.getElementById('sim-card-go')?.addEventListener('click', done);
        if (o.waitMs && o.waitMs > 0) {
          const bar = wrap.querySelector('.bar i') as HTMLElement;
          bar.animate([{ width: '0%' }, { width: '100%' }], { duration: o.waitMs, fill: 'forwards' });
          setTimeout(done, o.waitMs);
        }
      });
    },
  };
  w.__sim = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // The app re-renders <body>; our nodes hang off <html>, but re-mount defensively after route changes.
  setInterval(() => {
    if (!document.getElementById('sim-cursor')) mount();
  }, 1000);
}

// tsx (esbuild) may wrap named functions in a `__name(fn, "name")` helper; give the page a no-op one.
export const OVERLAY_SCRIPT = `var __name = window.__name || ((t) => t); (${overlayMain.toString()})();`;
