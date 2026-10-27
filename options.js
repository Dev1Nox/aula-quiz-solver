const DEFAULTS = {
  apiKey: "",
  model: "openai/gpt-oss-120b",
  context: "",
  delayMs: 1500,
  autoSubmit: false,
  trigger: "ens",
  showPanel: false,
};
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(DEFAULTS).then((s) => {
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("context").value = s.context;
  $("delayMs").value = s.delayMs;
  $("autoSubmit").checked = s.autoSubmit;
  $("trigger").value = s.trigger;
  $("showPanel").checked = s.showPanel;
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    context: $("context").value,
    delayMs: Math.max(300, Number($("delayMs").value) || DEFAULTS.delayMs),
    autoSubmit: $("autoSubmit").checked,
    trigger: $("trigger").value,
    showPanel: $("showPanel").checked,
  });
  $("ok").textContent = "Guardado ✓";
  setTimeout(() => ($("ok").textContent = ""), 2000);
});

$("listModels").addEventListener("click", async () => {
  const key = $("apiKey").value.trim();
  const out = $("models");
  if (!key) return (out.textContent = "Pon primero la API key.");
  out.textContent = "Consultando…";
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!r.ok) return (out.textContent = "Error: " + JSON.stringify(j));
    out.innerHTML = "";
    j.data
      .map((m) => m.id)
      .filter((id) => !/whisper|orpheus|guard|tts|embed/i.test(id))
      .sort()
      .forEach((id) => {
        const b = document.createElement("button");
        b.textContent = id;
        b.className = "chip";
        b.onclick = () => ($("model").value = id);
        out.appendChild(b);
      });
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});
