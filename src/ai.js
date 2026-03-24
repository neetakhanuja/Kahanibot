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
  if (out.length > 280) out = out.slice(0, 277).trim() + "...";
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

function isShortReply(text) {
  const t = String(text || "").trim().toLowerCase();
  return [
    "yes",
    "yeah",
    "yup",
    "haan",
    "ha",
    "hmm",
    "hm",
    "nothing",
    "no",
    "okay",
    "ok",
    "just that",
    "बस",
    "हाँ",
    "हां",
    "कुछ नहीं",
    "હા",
    "હું",
    "કંઈ નહીં",
  ].includes(t);
}

function stripEmojiFromQuestion(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+\?/g, "?")
    .trim();
}

function parseJsonMaybe(raw) {
  try {
    const text = String(raw || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const jsonStr = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function groundedFallbackAck(lang, latestUser = "") {
  const t = latestUser.toLowerCase();

  if (lang === "hi") {
    if (t.includes("mango") || t.includes("tree")) return "यह बचपन की बहुत जीवंत याद लगती है।";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "यह किसी अपने से जुड़ी हुई याद लगती है।";
    if (t.includes("courtyard") || t.includes("afternoon")) return "यह दृश्य बहुत साफ़-सा उभरता है।";
    return "यह याद काफ़ी सजीव लग रही है।";
  }

  if (lang === "gu") {
    if (t.includes("mango") || t.includes("tree")) return "આ બાળપણની ખૂબ જીવંત યાદ લાગે છે.";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "આ કોઈ નજીકના વ્યક્તિ સાથે જોડાયેલી યાદ લાગે છે.";
    if (t.includes("courtyard") || t.includes("afternoon")) return "આ દૃશ્ય ખૂબ સ્પષ્ટ લાગે છે.";
    return "આ યાદ ખૂબ જીવંત લાગે છે.";
  }

  if (t.includes("mango") || t.includes("tree")) return "That sounds like such a vivid childhood memory.";
  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "That sounds like a memory closely tied to someone important.";
  if (t.includes("courtyard") || t.includes("afternoon")) return "That scene feels very clear.";
  if (t.includes("cousin") || t.includes("friend") || t.includes("family")) return "It sounds like other people were very much part of that moment too.";
  return "That sounds like a vivid memory.";
}

function groundedFallbackQuestion(lang, latestUser = "") {
  const t = latestUser.toLowerCase();

  if (lang === "hi") {
    if (t.includes("mango") || t.includes("tree")) return "पेड़ पर ऊपर पहुँचकर आपको कैसा लगता था?";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "वे वहाँ बैठकर आम तौर पर क्या करती थीं?";
    if (t.includes("courtyard")) return "उस आँगन की आपको सबसे ज़्यादा क्या याद है?";
    return "उस बात में आपको सबसे ज़्यादा क्या याद है?";
  }

  if (lang === "gu") {
    if (t.includes("mango") || t.includes("tree")) return "ઝાડની ટોચ સુધી પહોંચીને તમને કેવું લાગતું હતું?";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "તેઓ ત્યાં બેઠા બેઠા સામાન્ય રીતે શું કરતા હતા?";
    if (t.includes("courtyard")) return "એ આંગણાની તમને સૌથી વધુ શું યાદ છે?";
    return "તે વાતમાં તમને સૌથી વધુ શું યાદ છે?";
  }

  if (t.includes("mango") || t.includes("tree")) return "What did it feel like being up there among the branches?";
  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "What did she usually do while sitting there?";
  if (t.includes("courtyard")) return "What do you remember most about that courtyard?";
  return "What do you remember most about that?";
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
        response_format: { type: "json_object" },
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

  const system = `You are KahaniBot, a conversational storytelling listener designed to encourage older adults to share life memories inspired by reflection cards.

A moderator already sends the prompt card. You do not introduce prompts. You respond only to what the user shares.

Your role is to gently support storytelling through conversation. You should feel like a patient, respectful younger listener sitting beside the storyteller.

Primary design principles:
- respond briefly: usually 1-2 sentences, occasionally 3
- acknowledge before asking
- ask only one question at a time
- ask only occasionally, not every turn
- avoid multiple questions
- avoid sounding like an interviewer, therapist, teacher, or authority figure
- do not summarize stories
- do not publish stories
- do not detect endings
- do not organize narratives
- treat every memory fragment as meaningful
- occasionally use a small listening signal like "Accha…", "Haan…", "I see", or "Hmm…"
- occasionally use a small emoji like 🙂 🙏 😊, but rarely
- never place an emoji inside a question
- vary phrasing and avoid repetition
- the user should always speak more than you

Available behavior modes:
1. ACKNOWLEDGMENT
2. GENTLE_CONTINUATION
3. CONTEXT_PROMPT
4. RELATIONAL_PROMPT
5. REFLECTIVE_APPRECIATION
6. GENTLE_CLOSURE
7. LOW_PRESSURE_ENCOURAGEMENT

Use them naturally. Do not mention the mode name.

Important rhythm rule:
- If the previous bot message asked a question, strongly prefer a non-question mode now unless the user explicitly asks you something.
- For very short replies like "yes", "hmm", "nothing", prefer LOW_PRESSURE_ENCOURAGEMENT or GENTLE_CLOSURE.

Grounding rule:
- Base your response mainly on the latest user message, while staying aware of the recent conversation.
- Do not bring in unrelated old details.

Return ONLY JSON with:
{
  "mode": "...",
  "reply": "..."
}`;

  const user = `Recent conversation:
${conversation_text}

Latest user message:
${latestUser}

Previous bot reply:
${last_bot_reply || "(none)"}

Previous bot mode:
${last_bot_mode || "none"}

Message count:
${Number(msg_count || 0)}

Write one natural WhatsApp reply.`;

  let parsed = null;
  const raw = await callOpenAI({
    system,
    user,
    temperature: 0.55,
  });

  if (raw) {
    parsed = parseJsonMaybe(raw);
  }

  if (!parsed || !parsed.reply) {
    if (last_bot_mode === "ASK") {
      return {
        mode: "ACKNOWLEDGMENT",
        text: groundedFallbackAck(lang, latestUser),
      };
    }

    return {
      mode: "GENTLE_CONTINUATION",
      text: `${groundedFallbackAck(lang, latestUser)}\n${groundedFallbackQuestion(lang, latestUser)}`,
    };
  }

  let mode = cleanText(parsed.mode || "ACKNOWLEDGMENT");
  let reply = cleanText(parsed.reply || "");

  if (!reply) {
    reply = groundedFallbackAck(lang, latestUser);
    mode = "ACKNOWLEDGMENT";
  }

  // Exact repetition guard
  if (
    normalizeForCompare(reply) &&
    normalizeForCompare(reply) === normalizeForCompare(last_bot_reply)
  ) {
    reply = groundedFallbackAck(lang, latestUser);
    mode = "ACKNOWLEDGMENT";
  }

  // If previous bot turn asked a question, suppress question now unless user asked one
  const userAskedQuestion = /[?؟]$/.test(String(latestUser || "").trim());
  if (last_bot_mode === "ASK" && /[?؟]/.test(reply) && !userAskedQuestion) {
    reply = reply
      .split("\n")
      .filter((line) => !/[?؟]/.test(line))
      .join("\n")
      .trim();

    if (!reply) {
      reply = groundedFallbackAck(lang, latestUser);
    }
    mode = "ACKNOWLEDGMENT";
  }

  // Very short user replies should not trigger pressure
  if (isShortReply(latestUser) && /[?؟]/.test(reply)) {
    if (lang === "hi") {
      reply = "कोई बात नहीं। कभी-कभी यादें धीरे-धीरे आती हैं।";
    } else if (lang === "gu") {
      reply = "કોઈ વાત નથી. ક્યારેક યાદો ધીમે ધીમે આવે છે.";
    } else {
      reply = "That's alright. Sometimes memories come slowly.";
    }
    mode = "LOW_PRESSURE_ENCOURAGEMENT";
  }

  // Keep at most one question
  const qCount = (reply.match(/[?؟]/g) || []).length;
  if (qCount > 1) {
    const firstQ = reply.indexOf("?");
    if (firstQ !== -1) {
      reply = reply.slice(0, firstQ + 1).trim();
    }
  }

  // Remove emoji from question lines
  if (/[?؟]/.test(reply)) {
    const lines = reply.split("\n").map((x) => x.trim()).filter(Boolean);
    reply = lines
      .map((line) => {
        if (/[?؟]/.test(line)) {
          return stripEmojiFromQuestion(line);
        }
        return line;
      })
      .join("\n");
  }

  const finalMode = /[?؟]/.test(reply) ? "ASK" : mode || "ACKNOWLEDGMENT";

  return {
    mode: finalMode,
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