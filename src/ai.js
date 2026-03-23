// src/ai.js
// KahaniBot AI: conversational storytelling listener

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

  const modeMatch = text.match(/MODE:\s*(REFLECT|ASK|CLOSE)/i);
  const line1Match = text.match(/LINE1:\s*([\s\S]*?)(?:\nQUESTION:|\n$)/i);
  const questionMatch = text.match(/QUESTION:\s*([\s\S]*?)$/i);

  return {
    mode: modeMatch ? modeMatch[1].toUpperCase() : "",
    line1: line1Match ? line1Match[1].trim() : "",
    question: questionMatch ? questionMatch[1].trim() : "",
  };
}

function genericReflectionFallback(lang) {
  if (lang === "hi") return "मैं आपकी बात ध्यान से सुन रहा/रही हूँ.";
  if (lang === "gu") return "હું તમારી વાત ધ્યાનથી સાંભળું છું.";
  return "I'm listening.";
}

function defaultQuestion(lang) {
  if (lang === "hi") return "उस समय आपको सबसे ज़्यादा क्या याद आता है?";
  if (lang === "gu") return "તે સમયે તમને સૌથી વધુ શું યાદ આવે છે?";
  return "What do you remember most clearly from that moment?";
}

async function callOpenAI({ system, user, temperature = 0.4 }) {
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

export async function analyzeStoryProgress({
  lang,
  story_text,
  msg_count = 0,
}) {
  try {

    const system = `
You are KahaniBot.

You are a warm storytelling listener for older adults sharing personal memories.

Write in ${langLabel(lang)}.

Your job is to listen carefully and gently encourage the storyteller.

Conversation principles:

The user should speak more than you.
Your messages should be short.

Do not dominate the conversation.

Acknowledge the story before asking anything.

Refer to specific details from the story when possible.

Avoid generic phrases like:
"That is a meaningful story"
"That is beautiful"

Instead mention something concrete.

Example:
"The river sounds like a peaceful place."

Ask only ONE gentle follow-up question if the story is still developing.

Good questions explore:
people
places
small actions
feelings
sensory memories

Avoid interrogation.

Avoid asking multiple questions.

Avoid repeating the same phrase again and again.

Occasionally you may use a small emoji such as:
🙂
🙏
😊

Use them sparingly.

If the story feels complete, do not ask another question.

Output format exactly:

MODE: ASK or REFLECT or CLOSE
LINE1: one short response
QUESTION: one gentle question only if MODE is ASK
`;

    const user = `
Message count: ${msg_count}

Story so far:
${story_text}
`;

    const out = await callOpenAI({ system, user, temperature: 0.45 });
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

export async function generateStoryTurn({
  lang,
  story_text,
  msg_count = 0,
}) {

  const analysis = await analyzeStoryProgress({
    lang,
    story_text,
    msg_count,
  });

  if (!analysis) {

    const line1 = genericReflectionFallback(lang);
    const question = defaultQuestion(lang);

    return {
      mode: "ASK",
      text: `${line1}\n${question}`,
      question_type: "detail",
    };
  }

  if (analysis.mode === "CLOSE") {
    return {
      mode: "CLOSE",
      text: analysis.line1,
      question_type: "none",
    };
  }

  if (analysis.mode === "REFLECT") {
    return {
      mode: "REFLECT",
      text: analysis.line1,
      question_type: "none",
    };
  }

  const question = ensureQuestion(
    analysis.question,
    defaultQuestion(lang)
  );

  return {
    mode: "ASK",
    text: [analysis.line1, question].filter(Boolean).join("\n"),
    question_type: "detail",
  };
}

export async function polishStory({ lang, story_text }) {

  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system = `
You lightly clean spoken storytelling into a readable short story.

Write in ${langLabel(lang)}.

Rules:

Keep the speaker's original meaning.
Do not add new details.
Do not exaggerate emotions.
Do not add moral lessons.

Remove obvious repetition.
Keep the language simple.

Return ONLY JSON:

{
"title": "...",
"body": "..."
}
`;

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
        obj.title ||
        (lang === "hi"
          ? "एक कहानी"
          : lang === "gu"
          ? "એક વાર્તા"
          : "A Story"),
      body: String(obj.body || raw).trim(),
    };

  } catch {
    return null;
  }
}