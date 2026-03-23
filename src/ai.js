// src/ai.js
// KahaniBot AI: WhatsApp listener for reminiscence conversations

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
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 220) out = out.slice(0, 217).trim() + "...";
  return out;
}

function ensureQuestion(text, fallback) {
  let q = String(text || "").trim();
  if (!q) return fallback;
  q = q.replace(/\s+/g, " ").trim();
  if (!/[?؟]$/.test(q)) {
    q = q.replace(/[.!।]+$/g, "").trim() + "?";
  }
  return q;
}

function stripQuestionFromLine(text) {
  let line = String(text || "").trim();
  if (!line) return "";
  line = line.replace(/[?؟]+$/g, "").trim();
  return line;
}

function stripEmoji(text) {
  try {
    return String(text || "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
  } catch {
    return String(text || "").trim();
  }
}

function parseTaggedBlock(raw) {
  const text = String(raw || "").trim();

  const modeMatch = text.match(/MODE:\s*(ACK|ASK|ENCOURAGE|CLOSE)/i);
  const line1Match = text.match(/LINE1:\s*([\s\S]*?)(?:\nQUESTION:|\n$)/i);
  const questionMatch = text.match(/QUESTION:\s*([\s\S]*?)$/i);

  return {
    mode: modeMatch ? modeMatch[1].toUpperCase() : "",
    line1: line1Match ? line1Match[1].trim() : "",
    question: questionMatch ? questionMatch[1].trim() : "",
  };
}

function fallbackAck(lang) {
  if (lang === "hi") return "यह याद बहुत सजीव लग रही है।";
  if (lang === "gu") return "આ યાદ ખૂબ જીવંત લાગે છે.";
  return "That sounds like a vivid memory.";
}

function fallbackEncourage(lang) {
  if (lang === "hi") return "अगर मन हो, थोड़ा और बताइए।";
  if (lang === "gu") return "જો મન હોય, થોડું વધુ કહો.";
  return "If you feel like it, you can say a little more.";
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
`You are KahaniBot.

You are a warm WhatsApp listener for older adults sharing memories.

Write in ${langLabel(lang)}.

Your role is to create the feeling of being heard.
You are not an interviewer, therapist, facilitator, teacher, or poet.

Core behavior:
- The user should always speak more than you.
- Keep responses short.
- Do not dominate the conversation.
- Treat fragments, passing memories, and small details as valid.
- Do not try to turn everything into a finished story.
- Do not talk about saving, publishing, ending, blogs, or links.

Response style:
- Acknowledge concrete details from what the user said.
- Avoid generic lines like "I'm listening", "That is meaningful", or "That is beautiful".
- Sound natural in WhatsApp.
- Occasionally use one small emoji like 🙂 or 🙏 or 😊, but rarely.
- Never put an emoji inside a question.

Question behavior:
- Ask a question only sometimes.
- Do not ask on every turn.
- If the previous bot mode was ASK, strongly prefer ACK, ENCOURAGE, or CLOSE on this turn.
- Only ask again if a question is truly needed.
- If you ask, ask only ONE gentle question.
- Good questions explore a person, place, small action, feeling, or sensory detail.
- Avoid interrogation.

Mode definitions:
ACK = one short acknowledgment only
ASK = one short acknowledgment plus one gentle question
ENCOURAGE = one short low-pressure invitation to continue, no question
CLOSE = one short resting response, no question

Hard output rules:
- LINE1 must never be a question.
- Only QUESTION may contain a question.
- If MODE is not ASK, QUESTION must be blank.

Output exactly:

MODE: ACK or ASK or ENCOURAGE or CLOSE
LINE1: one short response line
QUESTION: one gentle question only if MODE is ASK`;

    const user =
`Conversation so far:

${conversation_text}

Message count: ${Number(msg_count || 0)}
Previous bot mode: ${last_bot_mode || "none"}`;

    const out = await callOpenAI({
      system,
      user,
      temperature: 0.5,
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

  // Safe fallback if AI is unavailable
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

  const line1 = stripQuestionFromLine(
    analysis.line1 || fallbackAck(lang)
  );

  // Hard guard: never allow two ASK turns in a row
  if (last_bot_mode === "ASK") {
    if (analysis.mode === "ASK") {
      return {
        mode: "ACK",
        text: line1 || fallbackAck(lang),
      };
    }

    if (analysis.mode === "ENCOURAGE") {
      return {
        mode: "ENCOURAGE",
        text: line1 || fallbackEncourage(lang),
      };
    }

    if (analysis.mode === "CLOSE") {
      return {
        mode: "CLOSE",
        text: line1 || fallbackAck(lang),
      };
    }

    return {
      mode: "ACK",
      text: line1 || fallbackAck(lang),
    };
  }

  if (analysis.mode === "ACK") {
    return {
      mode: "ACK",
      text: line1 || fallbackAck(lang),
    };
  }

  if (analysis.mode === "ENCOURAGE") {
    return {
      mode: "ENCOURAGE",
      text: line1 || fallbackEncourage(lang),
    };
  }

  if (analysis.mode === "CLOSE") {
    return {
      mode: "CLOSE",
      text: line1 || fallbackAck(lang),
    };
  }

  let question = ensureQuestion(
    stripEmoji(analysis.question),
    fallbackQuestion(lang)
  );

  if (isGenericQuestion(question)) {
    question = fallbackQuestion(lang);
  }

  return {
    mode: "ASK",
    text: [line1 || fallbackAck(lang), question].filter(Boolean).join("\n"),
  };
}

/*
  Kept for compatibility if you later want background cleaning/logging.
*/
export async function polishStory({ lang, story_text }) {
  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system =
`You lightly clean spoken reminiscence text.

Write in ${langLabel(lang)}.

Rules:
- Keep the original meaning.
- Do not add new details.
- Remove obvious repetition only.
- Keep language simple.

Return JSON with keys "title" and "body".`;

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
      start >= 0 && end >= 0 ? out.slice(start, end + 1) : out;

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