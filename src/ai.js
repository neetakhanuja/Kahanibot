// src/ai.js
// KahaniBot AI: reminiscence listener for WhatsApp

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
    q = q.replace(/[.!]+$/g, "").trim() + "?";
  }

  return q;
}

function stripQuestionFromLine(text) {
  let line = String(text || "").trim();
  if (!line) return "";

  if (/[?؟]$/.test(line)) {
    line = line.replace(/[?؟]+$/g, "").trim();
  }

  return line;
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
  if (lang === "hi") return "मैं आपकी बात ध्यान से सुन रहा हूँ।";
  if (lang === "gu") return "હું તમારી વાત ધ્યાનથી સાંભળું છું.";
  return "I'm listening.";
}

function fallbackQuestion(lang) {
  if (lang === "hi") return "उस समय आपको सबसे ज़्यादा क्या याद है?";
  if (lang === "gu") return "તે સમયે તમને સૌથી વધુ શું યાદ છે?";
  return "What do you remember most about that moment?";
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

export async function analyzeListenerTurn({
  lang,
  conversation_text,
  msg_count = 0,
  last_bot_mode = "none",
}) {
  try {
    const system = `
You are KahaniBot.

You are a warm WhatsApp listener for older adults sharing memories.

Write in ${langLabel(lang)}.

Design principles:

The user should speak more than the bot.

Responses should be short.

Avoid dominating the conversation.

Listener behavior:

Acknowledge concrete details from the memory.

Example:
"Shelling peas in the afternoon sun sounds like one of those quiet everyday moments."

Avoid generic responses like:
"I'm listening."
"That sounds nice."

Ask questions only occasionally.

Important rule:
If the previous bot message asked a question,
do NOT ask another question.

Instead give a warm acknowledgment.

If you ask a question:
- ask only ONE question
- keep it gentle
- ask about a person, place, or feeling

Emoji rule:
Occasionally you may use 🙂 or 🙏
but use them rarely.

Response format:

MODE: ACK or ASK
LINE1: short acknowledgment
QUESTION: only if MODE is ASK

Previous bot mode: ${last_bot_mode}
`;

    const user = `
Conversation so far:

${conversation_text}

Message count: ${msg_count}
`;

    const out = await callOpenAI({
      system,
      user,
      temperature: 0.45,
    });

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
    return {
      mode: "ACK",
      text: fallbackAck(lang),
    };
  }

  const line1 = stripQuestionFromLine(
    analysis.line1 || fallbackAck(lang)
  );

  // Prevent two questions in a row
  if (last_bot_mode === "ASK") {
    return {
      mode: "ACK",
      text: line1,
    };
  }

  if (analysis.mode === "ACK") {
    return {
      mode: "ACK",
      text: line1,
    };
  }

  const question = ensureQuestion(
    analysis.question,
    fallbackQuestion(lang)
  );

  return {
    mode: "ASK",
    text: [line1, question].join("\n"),
  };
}

/*
Optional story polishing
*/
export async function polishStory({ lang, story_text }) {
  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system = `
Clean spoken reminiscence text.

Write in ${langLabel(lang)}.

Keep the meaning the same.

Remove repetition.

Return JSON with title and body.
`;

  const user = `Transcript:\n${raw}`;

  const out = await callOpenAI({
    system,
    user,
    temperature: 0.2,
  });

  if (!out) return null;

  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");

    const jsonStr =
      start >= 0 && end >= 0
        ? out.slice(start, end + 1)
        : out;

    const obj = JSON.parse(jsonStr);

    return {
      title: obj.title || "A Memory",
      body: obj.body || raw,
    };
  } catch {
    return null;
  }
}