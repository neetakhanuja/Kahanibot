// src/ai.js
// KahaniBot AI: conversational storytelling listener for WhatsApp

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

function cleanText(text, fallback = "") {
  let out = String(text || "").trim();
  if (!out) return fallback;
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 320) out = out.slice(0, 317).trim() + "...";
  return out;
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latestUserMessage(conversationText) {
  const lines = String(conversationText || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("User:")) {
      return lines[i].replace(/^User:\s*/, "").trim();
    }
  }

  return "";
}

function groundedFallbackAck(lang, latestUser = "") {
  const t = latestUser.toLowerCase();

  if (lang === "hi") {
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
      return "यह किसी अपने से जुड़ी हुई याद लगती है।";
    }
    if (t.includes("tree") || t.includes("mango")) {
      return "यह बचपन की बहुत जीवंत याद लगती है।";
    }
    if (t.includes("courtyard") || t.includes("afternoon") || t.includes("sun")) {
      return "यह दृश्य बहुत शांत और साफ़-सा उभरता है।";
    }
    return "यह याद काफ़ी सजीव लग रही है।";
  }

  if (lang === "gu") {
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
      return "આ કોઈ નજીકના વ્યક્તિ સાથે જોડાયેલી યાદ લાગે છે.";
    }
    if (t.includes("tree") || t.includes("mango")) {
      return "આ બાળપણની ખૂબ જીવંત યાદ લાગે છે.";
    }
    if (t.includes("courtyard") || t.includes("afternoon") || t.includes("sun")) {
      return "આ દૃશ્ય ખૂબ શાંત અને સ્પષ્ટ લાગે છે.";
    }
    return "આ યાદ ખૂબ જીવંત લાગે છે.";
  }

  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
    return "That sounds like a memory closely tied to someone important.";
  }
  if (t.includes("tree") || t.includes("mango")) {
    return "That sounds like such a vivid childhood memory.";
  }
  if (t.includes("courtyard") || t.includes("afternoon") || t.includes("sun")) {
    return "That scene feels very quiet and clear.";
  }
  if (t.includes("cousin") || t.includes("family")) {
    return "It sounds like other people were very much part of that moment too.";
  }

  return "That sounds like a vivid memory.";
}

function groundedFallbackQuestion(lang, latestUser = "") {
  const t = latestUser.toLowerCase();

  if (lang === "hi") {
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
      return "वे वहाँ बैठकर आम तौर पर क्या करती थीं?";
    }
    if (t.includes("tree") || t.includes("mango")) {
      return "पेड़ पर ऊपर पहुँचकर आपको कैसा लगता था?";
    }
    if (t.includes("courtyard")) {
      return "उस आँगन की आपको सबसे ज़्यादा क्या याद है?";
    }
    return "उस बात में आपको सबसे ज़्यादा क्या याद है?";
  }

  if (lang === "gu") {
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
      return "તેઓ ત્યાં બેઠા બેઠા સામાન્ય રીતે શું કરતા હતા?";
    }
    if (t.includes("tree") || t.includes("mango")) {
      return "ઝાડની ટોચ સુધી પહોંચીને તમને કેવું લાગતું હતું?";
    }
    if (t.includes("courtyard")) {
      return "એ આંગણાની તમને સૌથી વધુ શું યાદ છે?";
    }
    return "તે વાતમાં તમને સૌથી વધુ શું યાદ છે?";
  }

  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) {
    return "What did she usually do while sitting there?";
  }
  if (t.includes("tree") || t.includes("mango")) {
    return "What did it feel like being up there among the branches?";
  }
  if (t.includes("courtyard")) {
    return "What do you remember most about that courtyard?";
  }

  return "What do you remember most about that?";
}

function stripEmojiFromQuestion(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+\?/g, "?")
    .trim();
}

function keepAtMostOneQuestion(reply) {
  const text = String(reply || "").trim();
  if (!text) return "";

  const qIndex = text.indexOf("?");
  if (qIndex === -1) {
    return text;
  }

  const before = text.slice(0, qIndex + 1);
  const after = text.slice(qIndex + 1);

  const extraQ = after.indexOf("?");
  if (extraQ === -1) {
    return text;
  }

  return before.trim();
}

function removeQuestionSentence(reply) {
  const text = String(reply || "").trim();
  if (!text) return "";

  const parts = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((line) => !/[?؟]$/.test(line));

  return parts.join("\n").trim();
}

async function callOpenAI({ system, user, temperature = 0.55 }) {
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

export async function generateListenerTurn({
  lang,
  conversation_text,
  msg_count = 0,
  last_bot_reply = "",
  last_bot_mode = "none",
}) {
  const latestUser = latestUserMessage(conversation_text);

  const system =
`You are KahaniBot, a conversational storytelling listener designed to encourage older adults to share life memories inspired by reflection cards.

A moderator already sends the prompt card. You do not introduce prompts. You respond only to what the user shares.

Your behavior:
- be a patient, respectful younger listener
- keep replies short: usually 1–2 sentences
- acknowledge before asking
- ask only one question at a time
- ask only occasionally, not every turn
- if the previous bot message asked a question, prefer acknowledgment this turn
- avoid sounding like an interviewer, therapist, teacher, or authority figure
- do not summarize stories
- do not organize narratives
- do not talk about saving, endings, publishing, or links
- treat fragments and incomplete memories as meaningful
- occasionally use a small listening signal like "Haan…", "Accha…", "I see", or "Hmm…"
- occasionally use a small emoji like 🙂 or 🙏 or 😊, but rarely
- never put an emoji inside a question
- avoid repeating the same phrase used in the previous bot reply

Tone:
- calm
- curious
- non-judgmental
- patient
- conversational, not polished

Important:
- the user should always speak more than you
- avoid generic praise
- ground your response in concrete details from the latest user message
- a question is optional, not required`;

  const user =
`Recent conversation:
${conversation_text}

Latest user message:
${latestUser}

Previous bot reply:
${last_bot_reply || "(none)"}

Previous bot mode:
${last_bot_mode || "none"}

Message count:
${Number(msg_count || 0)}

Write one natural WhatsApp reply only.`;

  let reply = await callOpenAI({
    system,
    user,
    temperature: 0.55,
  });

  if (!reply) {
    if (last_bot_mode === "ASK") {
      return {
        mode: "ACK",
        text: groundedFallbackAck(lang, latestUser),
      };
    }

    return {
      mode: "ASK",
      text: `${groundedFallbackAck(lang, latestUser)}\n${groundedFallbackQuestion(lang, latestUser)}`,
    };
  }

  reply = cleanText(reply);

  // prevent exact repetition
  if (
    normalizeForCompare(reply) &&
    normalizeForCompare(reply) === normalizeForCompare(last_bot_reply)
  ) {
    reply = groundedFallbackAck(lang, latestUser);
  }

  // never allow two question turns in a row
  if (last_bot_mode === "ASK" && /[?؟]/.test(reply)) {
    const noQuestion = removeQuestionSentence(reply);
    reply = cleanText(noQuestion || groundedFallbackAck(lang, latestUser));
  }

  // keep at most one question
  reply = keepAtMostOneQuestion(reply);

  // no emoji inside question text
  if (/[?؟]/.test(reply)) {
    const lines = reply.split("\n").map((x) => x.trim()).filter(Boolean);
    const fixed = lines.map((line) => {
      if (/[?؟]$/.test(line)) {
        return stripEmojiFromQuestion(line);
      }
      return line;
    });
    reply = fixed.join("\n");
  }

  // if still empty after cleanup
  if (!reply) {
    reply = groundedFallbackAck(lang, latestUser);
  }

  const mode = /[?؟]/.test(reply) ? "ASK" : "ACK";

  return {
    mode,
    text: reply,
  };
}

// kept for compatibility
export async function polishStory({ lang, story_text }) {
  const raw = String(story_text || "").trim();
  if (!raw) return null;

  return {
    title:
      lang === "hi"
        ? "एक स्मृति"
        : lang === "gu"
        ? "એક યાદ"
        : "A Memory",
    body: raw,
  };
}