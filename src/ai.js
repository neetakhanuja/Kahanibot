// src/ai.js
// KahaniBot AI: empathetic listener + curious story builder

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
      "फिर क्या हुआ?",
      "उस समय आपको कैसा लगा?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  if (lang === "gu") {
    const qs = [
      "તે સમયે તમારી સાથે કોણ હતું?",
      "આ ક્યાં બન્યું હતું?",
      "તમને તે પળમાંથી સૌથી વધુ શું યાદ છે?",
      "પછી શું થયું?",
      "તે સમયે તમને કેવું લાગ્યું?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  const qs = [
    "Who was with you then?",
    "Where did this happen?",
    "What do you remember most from that moment?",
    "What happened after that?",
    "How did you feel at that time?",
  ];
  return qs[Math.floor(Math.random() * qs.length)];
}

function isTooGenericQuestion(lang, q) {
  const t = String(q || "").trim().toLowerCase();

  if (lang === "en") {
    return (
      t === "what happened next?" ||
      t === "and what happened next?" ||
      t === "what happened next" ||
      t === "can you tell me more?" ||
      t === "tell me more?" ||
      t === "would you like to tell me more?"
    );
  }

  if (lang === "hi") {
    return (
      t === "और क्या हुआ?" ||
      t === "और फिर क्या हुआ?" ||
      t === "और क्या याद आता है?" ||
      t === "क्या आप और बताना चाहेंगे?"
    );
  }

  if (lang === "gu") {
    return (
      t === "આ પછી શું થયું?" ||
      t === "પછી શું થયું?" ||
      t === "હવે પછી શું થયું?" ||
      t === "શું તમે વધુ કહેશો?"
    );
  }

  return false;
}

function cleanAcknowledgment(text, lang) {
  let out = String(text || "").trim();

  if (!out) {
    if (lang === "hi") return "यह एक सुंदर याद लगती है।";
    if (lang === "gu") return "આ એક સુંદર યાદ લાગે છે.";
    return "That sounds like a meaningful memory.";
  }

  out = out.replace(/^["'\s]+|["'\s]+$/g, "");

  if (out.length > 120) {
    out = out.slice(0, 117).trim() + "...";
  }

  return out;
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
      `You are KahaniBot, a warm and gentle storytelling companion for older adults in India.\n` +
      `Write in ${langLabel(lang)}.\n\n` +
      `Your role:\n` +
      `- Listen with empathy.\n` +
      `- Respond with curiosity.\n` +
      `- Help the speaker build a fuller story from a personal memory.\n\n` +
      `Input structure:\n` +
      `The input may contain:\n` +
      `- Theme: an optional story topic.\n` +
      `- Context so far: earlier parts of the story.\n` +
      `- Latest message: the newest thing the user has said.\n\n` +
      `Your job:\n` +
      `- Acknowledge the Latest message directly.\n` +
      `- Ask one gentle question that helps the story grow.\n` +
      `- If a Theme exists, keep the question connected to that Theme.\n` +
      `- Follow the story naturally instead of asking random questions.\n\n` +
      `Tone rules:\n` +
      `- Warm, respectful, and simple.\n` +
      `- Sound like a patient human listener.\n` +
      `- Be empathetic, but do not exaggerate emotion.\n` +
      `- Do not sound like a therapist, interviewer, or teacher.\n` +
      `- Do not praise too much.\n` +
      `- Do not give advice.\n` +
      `- Do not judge.\n` +
      `- Do not invent details.\n\n` +
      `Question rules:\n` +
      `- Ask only one question.\n` +
      `- Keep it specific.\n` +
      `- Prefer questions about people, place, time, action, feelings, small details, sequence, or meaning.\n` +
      `- Avoid generic questions like "What happened next?" unless there is no better option.\n` +
      `- Do not ask two questions in one line.\n\n` +
      `Length rules:\n` +
      `- Keep the whole reply very short.\n` +
      `- Output exactly 2 lines.\n` +
      `- Line 1: one short acknowledgment.\n` +
      `- Line 2: one gentle question.\n` +
      `- No bullet points.\n` +
      `- No labels.\n` +
      `- No extra text.`;

    const user = `Story input:\n${story_text}\n\nReturn exactly 2 lines.`;

    const out = await callOpenAI({ system, user, temperature: 0.6 });
    if (!out) return null;

    const cleaned = hardLimitLines(out, 2);
    const lines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      const reflection = cleanAcknowledgment(lines[0], lang || "en");
      let question = String(lines[1] || "").trim();

      if (!question.endsWith("?") && !question.endsWith("؟")) {
        question = question.replace(/[.。]+$/g, "").trim() + "?";
      }

      if (isTooGenericQuestion(lang || "en", question)) {
        question = pickScaffoldQuestion(lang || "en");
      }

      return {
        reflection,
        question,
        combined: `${reflection}\n${question}`,
      };
    }

    const one = cleanAcknowledgment(String(out).trim(), lang || "en");
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
    `You lightly clean spoken storytelling into a readable short story.\n` +
    `Write in ${langLabel(lang)}.\n\n` +
    `Strict rules:\n` +
    `- Keep the speaker's original meaning and wording as much as possible.\n` +
    `- Do NOT add new details.\n` +
    `- Do NOT exaggerate emotions.\n` +
    `- Do NOT add moral lessons.\n` +
    `- Do NOT significantly increase length.\n` +
    `- Keep the story natural and simple.\n` +
    `- Remove clear repetition or duplicate fragments.\n` +
    `- Fix only obvious small spoken-language issues.\n` +
    `- Preserve the personal voice.\n\n` +
    `Return ONLY valid JSON with keys "title" and "body".\n` +
    `Title: short, warm, and simple, max 6 words.\n` +
    `Body: a lightly cleaned version of the same story.\n`;

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
      title:
        title ||
        (lang === "hi"
          ? "एक कहानी"
          : lang === "gu"
          ? "એક વાર્તા"
          : "A Story"),
      body,
    };
  } catch {
    return null;
  }
}