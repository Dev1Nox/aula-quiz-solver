// Service worker: hace las llamadas a la API de Groq (compatible con OpenAI).

const DEFAULTS = {
  apiKey: "",
  model: "openai/gpt-oss-120b",
  context: "",
  delayMs: 1500,
  autoSubmit: false,
};

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "solve") {
    solve(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // respuesta asíncrona
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});

const SYSTEM = `Eres un experto resolviendo cuestionarios de Moodle con la máxima precisión. Tu objetivo es acertar todas las preguntas.

Reglas:
- Si hay MATERIAL DE APOYO, úsalo como fuente prioritaria y fiable.
- En verdadero/falso fíjate en detalles sutiles (nombres, orden de los hechos, cantidades, quién hace qué). Una sola parte incorrecta hace la afirmación falsa.
- Si no estás seguro, elige la opción más probable según el material, el contexto y tu conocimiento. Nunca dejes una pregunta sin responder.
- Responde SOLO con un objeto JSON válido, sin texto adicional ni bloques de código.

Formato de respuesta:
{"answers":[ ... ]} con un elemento por pregunta, en el mismo orden:
- type "truefalse" o "multichoice": {"qno":"1","choice":[índices de las opciones correctas]}  (una sola si "multiple" es false)
- type "shortanswer", "numerical" o "calculated": {"qno":"1","text":"respuesta breve y exacta"}
- type "match": {"qno":"1","matches":[índice de opción elegido para cada elemento, en orden]}
- type "multianswer" o "gapselect": {"qno":"1","fields":[valor para cada hueco [[n]], en orden; texto si es "text", índice de opción si es "select" o "radio"]}`;

async function solve({ title, questions }) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.apiKey) return { ok: false, error: "Falta la API key de Groq. Ponla en los ajustes de la extensión." };

  const user =
    `CUESTIONARIO: ${title || "(sin título)"}\n\n` +
    (s.context.trim() ? `MATERIAL DE APOYO:\n${s.context.trim()}\n\n` : "") +
    `PREGUNTAS (JSON):\n${JSON.stringify(questions, null, 1)}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${s.apiKey}`,
    },
    body: JSON.stringify({
      model: s.model,
      temperature: 0,
      max_completion_tokens: 6000, // los modelos de razonamiento gastan tokens pensando
      response_format: { type: "json_object" },
      ...(/gpt-oss/.test(s.model) ? { reasoning_effort: "medium" } : {}),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    const hint = res.status === 429 ? " (límite de Groq alcanzado; espera un momento o sube la pausa entre páginas)" : res.status === 404 ? " (modelo no disponible: elige otro en los ajustes con «Ver modelos disponibles»)" : "";
    return { ok: false, error: `Groq ${res.status}${hint}: ${t.slice(0, 300)}` };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: "La respuesta no contenía JSON." };
  try {
    const parsed = JSON.parse(m[0]);
    return { ok: true, answers: parsed.answers || [] };
  } catch (e) {
    return { ok: false, error: "JSON inválido en la respuesta del modelo." };
  }
}
