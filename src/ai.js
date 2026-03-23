// src/ai.js
// KahaniBot AI: WhatsApp listener for reminiscence sharing

const AI_ENABLED = String(process.env.AI_ENABLED || "").toLowerCase() === "true";
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

console.log("[AI] AI_ENABLED:", AI_ENABLED);
console.log("[AI] AI_MODEL:", AI_MODEL);
console.log("[AI] Node version:", process.version);
console.log("[AI] typeof fetch:", typeof fetch);

function langLabel(lang) {
  if (lang === "hi") return "Hindi";
  if (lang === "gu") return "Gujarati";
  return "English";
}

function cleanLine(text, fallback = "") {
  let out = String(text || "").trim();
  if (!out) return fallback;
  out = out.replace(/^["'\s]+|["'\s]+$/g, "");
  if (out.length > 220) out = out.slice(0, 217).trim() + "...";
  return out;
}

function ensureQuestion(text, fallback) {
  let q = String(text || "").trim();
  if (!q) return fallback;
  if (!/[?؟]$/.test(q)) {
    q = q.replace(/[.。!！]+$/g, "").trim() + "?";
  }
  return q;
}

function parseTaggedBlock(raw) {
  const text = String(raw || "").trim();

  const modeMatch = text.match(/MODE:\s*(ACK|ASK|CLOSE)/i);
  const line1Match = text.match(/LINE1:\s*([\s\S]*?)(?:\nQUESTION:|\n$)/i);
  const questionMatch = text.match(/QUESTION:\s*([\s\S]*?)$/i);

  return {
    mode: modeMatch ? modeMatch[1].toUpperCase() : "",
    line1: line1Match ? line1Match[1].trim() : "",
    question: questionMatch ? questionMatch[1].trim() : "",
  };
}

function fallbackAck(lang) {
  if (lang === "hi") return "मैं आपकी बात सुन रहा/रही हूँ।";
  if (lang === "gu") return "હું તમારી વાત સાંભળું છું.";
  return "I'm listening.";
}

function fallbackQuestion(lang) {
  if (lang === "hi") return "उस बात में आपको सबसे ज़्यादा क्या याद है?";
  if (lang === "gu") return "તે વાતમાં તમને સૌથી વધુ શું યાદ છે?";
  return "What do you remember most about that?";
}

function isGenericQuestion(q = "") {
  const t = String(q || "").trim().toLowerCase();
  return [
    "what happened next?",
    "and what happened next?",
    "tell me more?",
    "can you tell me more?",
    "would you like to tell me more?",
    "what do you remember?",
    "can you say more?",
    "और क्या हुआ?",
    "और फिर क्या हुआ?",
    "क्या आप और बताना चाहेंगे?",
    "પછી શું થયું?",
    "શું તમે વધુ કહેશો?",
  ].includes(t);
}

async function callOpenAI({ system, user, temperature = 0.45 }) {
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

export async function analyzeListenerTurn({
  lang,
  conversation_text,
  msg_count = 0,
  last_bot_mode = "none",
}) {
  try {
    const system =
      `You are KahaniBot, a warm WhatsApp listener for older adults sharing memories.\n` +
      `Write in ${langLabel(lang)}.\n\n` +
      `Your role is not to collect a finished story.\n` +
      `Your role is to create a feeling of being heard.\n\n` +
      `Behavior rules:\n` +
      `- The user should always speak more than you.\n` +
      `- Keep your response short.\n` +
      `- Do not dominate the conversation.\n` +
      `- Do not sound like an interviewer, therapist, teacher, moderator, or poet.\n` +
      `- Do not summarize the whole story.\n` +
      `- Do not talk about saving, finishing, publishing, or links.\n` +
      `- Treat fragments, partial memories, and small details as valid.\n` +
      `- Acknowledge specific details when possible.\n` +
      `- Avoid generic praise like "That is beautiful" or "That is meaningful".\n` +
      `- Avoid repetition in wording and question style.\n` +
      `- Ask a question only sometimes, not every turn.\n` +
      `- If you ask, ask only one gentle follow-up.\n` +
      `- Good follow-ups explore a person, place, small action, feeling, or sensory detail.\n` +
      `- If the user already shared enough for this turn, you may simply acknowledge and stop.\n` +
      `- Occasionally you may use one small emoji such as 🙂 or 🙏 or 😊.\n` +
      `- Never place an emoji inside a question or right before a question mark.\n` +
      `- If the previous bot mode was ASK, prefer ACK or CLOSE unless a question is truly needed.\n` +
      `- Previous bot mode was: ${last_bot_mode || "none"}.\n\n` +
      `Choose exactly one mode:\n` +
      `ACK = brief acknowledgment only\n` +
      `ASK = brief acknowledgment plus one gentle follow-up question\n` +
      `CLOSE = gentle resting response with no question\n\n` +
      `Output exactly in this format:\n` +
      `MODE: ACK or ASK or CLOSE\n` +
      `LINE1: one short response line\n` +
      `QUESTION: one gentle question only if MODE is ASK, otherwise leave blank\n`;

    const user =
      `Message count in this conversation: ${Number(msg_count || 0)}\n\n` +
      `Conversation so far:\n${conversation_text}`;

    const out = await callOpenAI({ system, user, temperature: 0.5 });
    if (!out) return null;

    const parsed = parseTaggedBlock(out);
    if (!parsed.mode) return null;

    return {
      mode: parsed.mode,
      line1: cleanLine(parsed.line1),
      question: cleanLine(parsed.question),
    };
  } catch {
    return null;
  }
}

export async function generateListenerTurn({
  lang,
  conversation_text,
  msg_count = 0,
  last_bot_mode = "none",
}) {
  const analysis = await analyzeListenerTurn({
    lang,
    conversation_text,
    msg_count,
    last_bot_mode,
  });

  if (!analysis) {
    if (last_bot_mode === "ASK") {
      return {
        mode: "ACK",
        text: fallbackAck(lang),
      };
    }

    return {
      mode: "ASK",
      text: `${fallbackAck(lang)}\n${fallbackQuestion(lang)}`,
    };
  }

  const line1 = analysis.line1 || fallbackAck(lang);

  if (analysis.mode === "CLOSE") {
    return {
      mode: "CLOSE",
      text: line1,
    };
  }

  if (analysis.mode === "ACK") {
    return {
      mode: "ACK",
      text: line1,
    };
  }

  let question = ensureQuestion(
    analysis.question,
    fallbackQuestion(lang)
  );

  if (isGenericQuestion(question)) {
    question = fallbackQuestion(lang);
  }

  return {
    mode: "ASK",
    text: [line1, question].filter(Boolean).join("\n"),
  };
}

/*
  Keep this for optional background cleaning/logging if needed later.
  It is no longer central to the live study behavior.
*/
export async function polishStory({ lang, story_text }) {
  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system =
    `You lightly clean spoken reminiscence text into readable prose.\n` +
    `Write in ${langLabel(lang)}.\n\n` +
    `Rules:\n` +
    `- Keep the speaker's meaning.\n` +
    `- Do not add new details.\n` +
    `- Do not exaggerate emotions.\n` +
    `- Remove obvious repetition only.\n` +
    `- Keep the language simple.\n\n` +
    `Return ONLY valid JSON with keys "title" and "body".\n`;

  const user = `Transcript:\n${raw}`;

  const out = await callOpenAI({ system, user, temperature: 0.2 });
  if (!out) return null;

  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    const jsonStr = start >= 0 && end >= 0 ? out.slice(start, end + 1) : out;
    const obj = JSON.parse(jsonStr);

    return {
      title:
        String(obj.title || "").trim() ||
        (lang === "hi"
          ? "एक स्मृति"
          : lang === "gu"
          ? "એક યાદ"
          : "A Memory"),
      body: String(obj.body || raw).trim(),
    };
  } catch {
    return null;
  }
}