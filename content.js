// Content script: extrae las preguntas de la página del intento, las manda a
// background.js, rellena las respuestas y avanza de página.

(() => {
  const isAttempt = /\/mod\/quiz\/attempt\.php/.test(location.pathname);
  const isSummary = /\/mod\/quiz\/summary\.php/.test(location.pathname);
  if (!isAttempt && !isSummary) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (n) =>
    (n?.innerText ?? n?.textContent ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const getSettings = () =>
    chrome.storage.local.get({ running: false, delayMs: 1500, autoSubmit: false, retries: 0 });

  // ---------- Disfraz (modo discreto) ----------
  // Los controles reales son iconos que ya existen en el pie de EducaMadrid:
  //   #emENS      (certificado de conformidad)  -> Resolver
  //   #buzonPRCD  (plan contra las drogas)      -> Parar
  // Con trigger="drogas" solo se usa el icono de las drogas: 1.er clic = Resolver, 2.º = Parar.
  // Mientras haya un error guardado se ocultan los controles de ayuda; al desaparecer, vuelven.
  const SEL_ENS = "#emENS";
  const SEL_DRUGS = "#buzonPRCD";
  const HELP_SELECTORS = ['button[data-action="footer-popover"]', "#emCommonFooterHelpLnk"];

  const styleEl = document.createElement("style");
  (document.head || document.documentElement).appendChild(styleEl);
  let state = { running: false, error: "", trigger: "ens", showPanel: false };

  function paint() {
    let css = "";
    if (state.error) css += `${HELP_SELECTORS.join(",")}{display:none!important}`;
    if (state.running) {
      const sel = state.trigger === "drogas" ? SEL_DRUGS : `${SEL_ENS},${SEL_DRUGS}`;
      css += `${sel}{opacity:.72!important;transition:opacity .3s}`;
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  async function refreshState() {
    const s = await chrome.storage.local.get({ running: false, error: "", trigger: "ens", showPanel: false });
    state = s;
    host.style.display = s.showPanel ? "" : "none";
    paint();
  }
  chrome.storage.onChanged.addListener((_c, area) => { if (area === "local") refreshState(); });

  // Error persistente (sobrevive a la navegación y se sincroniza entre pestañas).
  const setError = (msg) => chrome.storage.local.set({ running: false, error: String(msg || "error") });
  const clearError = () => chrome.storage.local.set({ error: "" });

  // ---------- Panel flotante (opcional: Ajustes > «Mostrar panel») ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box{font:13px system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:10px;padding:10px 12px;width:240px;box-shadow:0 4px 16px #0006}
      .row{display:flex;gap:6px;margin-top:8px}
      button{flex:1;border:0;border-radius:6px;padding:6px 8px;font:inherit;cursor:pointer;color:#fff}
      #go{background:#16a34a} #stop{background:#dc2626} #cfg{background:#374151;flex:0 0 auto}
      #log{margin-top:6px;max-height:110px;overflow:auto;color:#d1d5db;white-space:pre-wrap}
    </style>
    <div class="box"><strong>Quiz Solver</strong>
      <div class="row"><button id="go">Resolver</button><button id="stop">Parar</button><button id="cfg">⚙</button></div>
      <div id="log">Listo.</div>
    </div>`;
  document.body.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const log = (m) => { $("log").textContent = m; console.debug("[QuizSolver]", m); };

  async function start() {
    state = { ...state, running: true, error: "" }; paint();
    await chrome.storage.local.set({ running: true, retries: 0, error: "" });
    run();
  }
  async function stop() {
    state = { ...state, running: false, error: "" }; paint();
    await chrome.storage.local.set({ running: false, error: "" });
    log("Detenido.");
  }

  $("go").onclick = start;
  $("stop").onclick = stop;
  $("cfg").onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });

  // Clics en los iconos del pie. Fase de captura y síncrono: la página no los ve
  // y el enlace no se abre.
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const hit = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    return { ens: !!t?.closest(SEL_ENS), drugs: !!t?.closest(SEL_DRUGS) };
  };
  document.addEventListener("click", (e) => {
    const { ens, drugs } = hit(e);
    if (!ens && !drugs) return;
    if (state.trigger === "drogas") {
      if (!drugs) return;                          // el certificado conserva su función normal
      swallow(e);
      state.running ? stop() : start();
    } else {
      swallow(e);
      ens ? start() : stop();
    }
  }, true);
  // clic central / menú contextual: que tampoco abra pestañas
  document.addEventListener("auxclick", (e) => {
    const { ens, drugs } = hit(e);
    if (drugs || (ens && state.trigger !== "drogas")) swallow(e);
  }, true);

  refreshState();

  // ---------- Extracción ----------
  function optionLabel(input) {
    const lab = (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.closest("label");
    if (!lab) return "";
    const c = lab.cloneNode(true);
    c.querySelectorAll(".answernumber").forEach((n) => n.remove());
    return txt(c);
  }

  function extract(que) {
    const type = [...que.classList].find((c) => c !== "que");
    const qno = que.querySelector(".qno")?.textContent.trim();
    const qtextEl = que.querySelector(".qtext");
    const base = { qno, type, text: txt(qtextEl), _el: que };

    if (type === "truefalse" || type === "multichoice") {
      const inputs = [...que.querySelectorAll('.answer input[type="radio"], .answer input[type="checkbox"]')]
        .filter((i) => i.value !== "-1");
      if (!inputs.length) return null;
      return {
        ...base,
        multiple: inputs[0].type === "checkbox",
        options: inputs.map((el, i) => ({ i, text: optionLabel(el) })),
        _inputs: inputs,
      };
    }

    if (["shortanswer", "numerical", "calculated", "calculatedsimple"].includes(type)) {
      const input = que.querySelector('.answer input[type="text"], .answer input:not([type])');
      return input ? { ...base, _input: input } : null;
    }

    if (type === "match") {
      const rows = [...que.querySelectorAll("table.answer tr")].filter((r) => r.querySelector("select"));
      if (!rows.length) return null;
      const items = rows.map((r, n) => {
        const sel = r.querySelector("select");
        const opts = [...sel.options].filter((o) => o.value !== "0" && o.value !== "");
        return { n, text: txt(r.querySelector("td.text") || r.cells[0]), options: opts.map((o, i) => ({ i, text: txt(o) })), _sel: sel, _opts: opts };
      });
      return { ...base, items, _items: items };
    }

    if (type === "multianswer" || type === "gapselect") {
      // Sustituye cada control por un marcador [[n]] en una copia del enunciado.
      const clone = qtextEl.cloneNode(true);
      const live = [...qtextEl.querySelectorAll('input:not([type="hidden"]), select')];
      const dead = [...clone.querySelectorAll('input:not([type="hidden"]), select')];
      const fields = [];
      const seenRadios = new Set();
      live.forEach((el, k) => {
        if (el.type === "radio") {
          if (seenRadios.has(el.name)) { dead[k].remove(); return; }
          seenRadios.add(el.name);
          const group = live.filter((x) => x.type === "radio" && x.name === el.name);
          fields.push({ kind: "radio", el: group, options: group.map((g, i) => ({ i, text: optionLabel(g) })) });
        } else if (el.tagName === "SELECT") {
          const opts = [...el.options].filter((o) => o.value !== "" && o.value !== "0");
          fields.push({ kind: "select", el, opts, options: opts.map((o, i) => ({ i, text: txt(o) })) });
        } else {
          fields.push({ kind: "text", el });
        }
        dead[k].replaceWith(document.createTextNode(`[[${fields.length}]]`));
      });
      if (!fields.length) return null;
      return {
        ...base,
        text: txt(clone),
        fields: fields.map((f, n) => ({ n: n + 1, kind: f.kind, options: f.options })),
        _fields: fields,
      };
    }

    return null; // tipo no soportado (essay, drag&drop…)
  }

  const publicQ = ({ _el, _inputs, _input, _items, _fields, items, ...rest }) => ({
    ...rest,
    ...(items ? { items: items.map(({ n, text, options }) => ({ n, text, options })) } : {}),
  });

  // ---------- Aplicar respuestas ----------
  function setValue(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }
  function setSelect(sel, opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function apply(q, a) {
    if (q._inputs) {
      const want = new Set((a.choice || []).map(Number));
      q._inputs.forEach((el, i) => {
        if (q.multiple) { if (el.checked !== want.has(i)) el.click(); }
        else if (want.has(i) && !el.checked) el.click();
      });
      return want.size > 0;
    }
    if (q._input) {
      if (a.text == null) return false;
      setValue(q._input, String(a.text));
      return true;
    }
    if (q._items) {
      const m = a.matches || [];
      q._items.forEach((it, n) => { const opt = it._opts[Number(m[n])]; if (opt) setSelect(it._sel, opt); });
      return m.length > 0;
    }
    if (q._fields) {
      const f = a.fields || [];
      q._fields.forEach((fld, n) => {
        const v = f[n];
        if (v == null) return;
        if (fld.kind === "text") setValue(fld.el, String(v));
        else if (fld.kind === "select") { const o = fld.opts[Number(v)]; if (o) setSelect(fld.el, o); }
        else if (fld.kind === "radio") fld.el[Number(v)]?.click();
      });
      return f.length > 0;
    }
    return false;
  }

  // ---------- Flujo ----------
  async function run() {
    const s = await getSettings();
    if (!s.running) return;

    if (isSummary) return handleSummary(s);

    const ques = [...document.querySelectorAll("form#responseform div.que")];
    const extracted = ques.map(extract);
    const solvable = extracted.filter(Boolean);
    const skipped = extracted.length - solvable.length;

    if (!solvable.length) {
      log("Ninguna pregunta soportada en esta página.");
    } else {
      log(`Consultando a la IA (${solvable.length} pregunta/s)…`);
      const title = document.querySelector("h1")?.textContent.trim() || document.title;
      const res = await chrome.runtime
        .sendMessage({ type: "solve", payload: { title, questions: solvable.map(publicQ) } })
        .catch((e) => ({ ok: false, error: String(e?.message || e) }));
      if (!res?.ok) {
        const msg = res?.error || "sin respuesta";
        await setError(msg);
        return log("Error: " + msg);
      }
      await clearError();
      let done = 0;
      for (const q of solvable) {
        const a = res.answers.find((x) => String(x.qno) === String(q.qno));
        if (a && apply(q, a)) done++;
      }
      log(`Respondidas ${done}/${solvable.length}` + (skipped ? ` · ${skipped} no soportada/s` : ""));
    }

    await sleep(s.delayMs);
    const next = document.querySelector('input[name="next"], button[name="next"]');
    if (next) next.click();
    else {
      await chrome.storage.local.set({ running: false });
      log("No hay botón de siguiente. Parado.");
    }
  }

  async function handleSummary(s) {
    // ¿Quedan preguntas sin responder?
    const rows = [...document.querySelectorAll(".quizsummaryofattempt tbody tr")];
    const pending = rows.filter((r) => /sin responder|not yet answered/i.test(r.textContent));
    if (pending.length && s.retries < 1) {
      await chrome.storage.local.set({ retries: s.retries + 1 });
      log(`Hay ${pending.length} sin responder. Reintentando…`);
      await sleep(s.delayMs);
      (pending[0].querySelector("a") || {}).click?.();
      return;
    }
    if (pending.length) {
      await chrome.storage.local.set({ running: false });
      return log(`Quedan ${pending.length} sin responder. Revísalas tú.`);
    }
    if (!s.autoSubmit) {
      await chrome.storage.local.set({ running: false });
      return log("Todo respondido. Revisa y pulsa «Enviar todo y terminar».");
    }
    log("Enviando intento…");
    await sleep(s.delayMs);
    const btn = document.querySelector('form[action*="processattempt"] button[type="submit"], form[action*="processattempt"] input[type="submit"]');
    if (!btn) { await setError("No encuentro el botón de enviar."); return log("No encuentro el botón de enviar."); }
    btn.click();
    for (let i = 0; i < 20; i++) {          // confirmación modal de Moodle
      await sleep(300);
      const ok = document.querySelector('.modal.show [data-action="save"], .modal.show .btn-primary');
      if (ok) { await chrome.storage.local.set({ running: false }); ok.click(); return; }
    }
    await setError("No apareció la confirmación.");
    log("No apareció la confirmación. Hazlo a mano.");
  }

  run();
})();
