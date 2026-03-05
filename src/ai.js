// src/ai.js
// Minimal OpenAI wrapper for Kahanibot (reflection + question) + light story polish.

const AI_ENABLED = String(process.env.AI_ENABLED || "").toLowerCase() === "true";
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Startup logs
console.log("[AI] AI_ENABLED:", AI_ENABLED);
console.log("[AI] AI_MODEL:", AI_MODEL);
console.log("[AI] OPENAI_API_KEY loaded:", OPENAI_API_KEY ? "yes" : "no");
console.log("[AI] Node version:", process.version);
console.log("[AI] typeof fetch:", typeof fetch);

function langLabel(lang) {
  if (lang === "hi") return "Hindi";
  if (lang === "gu") return "Gujarati";
  return "English";
}

function hardLimitLines(text, maxLines) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}

function pickScaffoldQuestion(lang) {
  if (lang === "hi") {
    const qs = [
      "उस समय आपके साथ कौन था?",
      "यह कहाँ हुआ था?",
      "उस पल आपको सबसे ज़्यादा क्या याद है?",
      "फिर आपने क्या किया?",
      "अंत में क्या हुआ?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  if (lang === "gu") {
    const qs = [
      "તે વખતે તમારી સાથે કોણ હતું?",
      "આ ક્યા બન્યું હતું?",
      "આ પળમાંથી તમને સૌથી વધુ શું યાદ છે?",
      "પછી તમે શું કર્યું?",
      "અંતમાં શું થયું?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  const qs = [
    "Who was with you then?",
    "Where did this happen?",
    "What do you remember most from that moment?",
    "What did you do next?",
    "How did it end?",
  ];
  return qs[Math.floor(Math.random() * qs.length)];
}

function isTooGenericQuestion(lang, q) {
  const t = String(q || "").trim().toLowerCase();

  // English
  if (lang === "en") {
    if (t === "what happened next?" || t === "and what happened next?") return true;
    if (t === "what happened next") return true;
    return false;
  }

  // Hindi
  if (lang === "hi") {
    if (t === "और क्या हुआ?" || t === "और फिर क्या हुआ?" || t === "और क्या याद आता है?") return true;
    return false;
  }

  // Gujarati
  if (lang === "gu") {
    if (t === "આ પછી શું થયું?" || t === "પછી શું થયું?" || t === "હવે પછી શું થયું?") return true;
    return false;
  }

  // default
  return t === "what happened next?" || t === "what happened next";
}

async function callOpenAI({ system, user, temperature = 0.5 }) {
  if (!AI_ENABLED) return null;
  if (!OPENAI_API_KEY) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;

    return String(text).trim();
  } catch {
    return null;
  }
}

export async function generateReflectionAndQuestion({ lang, story_text }) {
  try {
    const system =
      `You are a warm and simple storytelling companion for older adults.\n` +
      `Write in ${langLabel(lang)}.\n\n` +
      `Input structure:\n` +
      `The input may contain these sections:\n` +
      `Theme: a story topic or prompt.\n` +
      `Context so far: earlier parts of the story.\n` +
      `Latest message: the newest part of the story from the user.\n\n` +
      `Your task:\n` +
      `- Your acknowledgment MUST respond to the Latest message.\n` +
      `- If a Theme exists, your question MUST connect to the Theme.\n` +
      `- Ask one simple open question that moves the story forward.\n\n` +
      `Tone rules:\n` +
      `- Warm but simple.\n` +
      `- Do not exaggerate emotions.\n` +
      `- Do not interpret feelings beyond what is said.\n` +
      `- Use clear plain language.\n\n` +
      `Conversation rules:\n` +
      `- No advice.\n` +
      `- No moral lessons.\n` +
      `- No assumptions.\n` +
      `- Ask only one open question.\n` +
      `- Avoid generic questions like "What happened next?" unless truly needed.\n` +
      `- Keep responses short.\n\n` +
      `Output EXACTLY 2 lines:\n` +
      `Line 1: one short acknowledgment.\n` +
      `Line 2: one gentle question that connects to the story and the Theme.\n` +
      `No extra text.`;

    const user = `Story:\n${story_text}\n\nReturn exactly 2 lines.`;

    const out = await callOpenAI({ system, user, temperature: 0.5 });
    if (!out) return null;

    const cleaned = hardLimitLines(out, 2);
    const lines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // If we got 2 lines, enforce anti-generic question fallback
    if (lines.length >= 2) {
      let reflection = lines[0];
      let question = lines[1];

      if (isTooGenericQuestion(lang || "en", question)) {
        question = pickScaffoldQuestion(lang || "en");
      }

      return {
        reflection,
        question,
        combined: `${reflection}\n${question}`,
      };
    }

    // If we got only one line, add a scaffold question
    const one = String(out).trim();
    const q = pickScaffoldQuestion(lang || "en");
    return {
      reflection: one,
      question: q,
      combined: `${one}\n${q}`,
    };
  } catch {
    return null;
  }
}

/*
  Conservative story polish.
  Very light cleaning. No expansion. No interpretation.
*/
export async function polishStory({ lang, story_text }) {
  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system =
    `You lightly clean spoken transcripts into a readable short story.\n` +
    `Write in ${langLabel(lang)}.\n\n` +
    `Strict rules:\n` +
    `- Keep original wording as much as possible.\n` +
    `- Do NOT add new details.\n` +
    `- Do NOT exaggerate emotions.\n` +
    `- Do NOT add moral lessons.\n` +
    `- Do NOT significantly increase length.\n` +
    `- Keep sentence structure close to original.\n` +
    `- Remove clear duplicate lines or repeated fragments.\n` +
    `- Fix small speech errors only if obvious.\n\n` +
    `Return ONLY valid JSON with keys "title" and "body".\n` +
    `Title: short (max 6 words).\n` +
    `Body: similar length to transcript.\n`;

  const user = `Transcript:\n${raw}\n\nReturn JSON only.`;

  const out = await callOpenAI({ system, user, temperature: 0.2 });
  if (!out) return null;

  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    const jsonStr = start >= 0 && end >= 0 ? out.slice(start, end + 1) : out;
    const obj = JSON.parse(jsonStr);

    const title = String(obj.title || "").trim();
    const body = String(obj.body || "").trim();
    if (!body) return null;

    return {
      title: title || (lang === "hi" ? "एक कहानी" : lang === "gu" ? "એક વાર્તા" : "A Story"),
      body,
    };
  } catch {
    return null;
  }
}