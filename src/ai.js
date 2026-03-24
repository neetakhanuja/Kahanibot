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

function previousUserMessage(conversationText) {
  const lines = String(conversationText || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.startsWith("User:"))
    .map((x) => x.replace(/^User:\s*/, "").trim());

  if (lines.length < 2) return "";
  return lines[lines.length - 2];
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
    "yes it did",
    "i agree",
    "haha",
    "lol",
    "बस",
    "हाँ",
    "हां",
    "कुछ नहीं",
    "હા",
    "હું",
    "કંઈ નહીં",
  ].includes(t);
}

function hasSubstantialNewDetail(latestUser, previousUser = "") {
  const latest = String(latestUser || "").trim().toLowerCase();
  const prev = String(previousUser || "").trim().toLowerCase();

  if (!latest) return false;
  if (isShortReply(latest)) return false;
  if (latest.length >= 45) return true;
  if (latest.includes(",") || latest.includes(" and ") || latest.includes(" but ")) return true;
  if (
    /(because|when|while|still|even now|smell|sound|felt|saw|remember|cousin|family|friend|tree|mango|courtyard|grandmother|mother|father|village|school|road|field|sun|afternoon)/i.test(
      latest
    )
  ) {
    return true;
  }

  const latestNorm = normalizeForCompare(latest);
  const prevNorm = normalizeForCompare(prev);

  if (latestNorm && prevNorm && latestNorm !== prevNorm && latestNorm.length > prevNorm.length + 10) {
    return true;
  }

  return false;
}

function stripEmojiFromQuestion(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+\?/g, "?")
    .trim();
}

function stripAllQuestionSentences(text) {
  const parts = String(text || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((line) => !/[?؟]$/.test(line));

  return parts.join("\n").trim();
}

function keepAtMostOneQuestion(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  let found = false;
  const kept = [];

  for (const line of lines) {
    const isQuestion = /[?؟]$/.test(line);
    if (isQuestion) {
      if (!found) {
        kept.push(stripEmojiFromQuestion(line));
        found = true;
      }
    } else {
      kept.push(line);
    }
  }

  return kept.join("\n").trim();
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
    if (t.includes("friend") || t.includes("cousin")) return "इसमें साथ का एहसास बहुत साफ़ आता है।";
    return "यह याद काफ़ी सजीव लग रही है।";
  }

  if (lang === "gu") {
    if (t.includes("mango") || t.includes("tree")) return "આ બાળપણની ખૂબ જીવંત યાદ લાગે છે.";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "આ કોઈ નજીકના વ્યક્તિ સાથે જોડાયેલી યાદ લાગે છે.";
    if (t.includes("courtyard") || t.includes("afternoon")) return "આ દૃશ્ય ખૂબ સ્પષ્ટ લાગે છે.";
    if (t.includes("friend") || t.includes("cousin")) return "આમાં સાથેપણાની લાગણી સ્પષ્ટ આવે છે.";
    return "આ યાદ ખૂબ જીવંત લાગે છે.";
  }

  if (t.includes("mango") || t.includes("tree")) return "That sounds like such a vivid childhood memory.";
  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "That sounds like a memory closely tied to someone important.";
  if (t.includes("courtyard") || t.includes("afternoon")) return "That scene feels very clear.";
  if (t.includes("friend") || t.includes("cousin") || t.includes("family")) return "It sounds like other people were very much part of that moment too.";
  return "That sounds like a vivid memory.";
}

function groundedFallbackQuestion(lang, latestUser = "") {
  const t = latestUser.toLowerCase();

  if (lang === "hi") {
    if (t.includes("mango") || t.includes("tree")) return "पेड़ पर ऊपर पहुँचकर आपको कैसा लगता था?";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "वे वहाँ बैठकर आम तौर पर क्या करती थीं?";
    if (t.includes("courtyard")) return "उस आँगन की आपको सबसे ज़्यादा क्या याद है?";
    if (t.includes("friend") || t.includes("cousin")) return "क्या आप सब वहाँ बैठकर बातें भी करते थे?";
    return "उस बात में आपको सबसे ज़्यादा क्या याद है?";
  }

  if (lang === "gu") {
    if (t.includes("mango") || t.includes("tree")) return "ઝાડની ટોચ સુધી પહોંચીને તમને કેવું લાગતું હતું?";
    if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "તેઓ ત્યાં બેઠા બેઠા સામાન્ય રીતે શું કરતા હતા?";
    if (t.includes("courtyard")) return "એ આંગણાની તમને સૌથી વધુ શું યાદ છે?";
    if (t.includes("friend") || t.includes("cousin")) return "તમે બધાં ત્યાં બેઠા બેઠા વાતો પણ કરતા હતા?";
    return "તે વાતમાં તમને સૌથી વધુ શું યાદ છે?";
  }

  if (t.includes("mango") || t.includes("tree")) return "What did it feel like being up there among the branches?";
  if (t.includes("grandmother") || t.includes("mother") || t.includes("father")) return "What did she usually do while sitting there?";
  if (t.includes("courtyard")) return "What do you remember most about that courtyard?";
  if (t.includes("friend") || t.includes("cousin")) return "Did you all talk much while you were there?";
  return "What do you remember most about that?";
}

async function callOpenAI({ system, user, temperature = 0.6 }) {
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
  const prevUser = previousUserMessage(conversation_text);
  const substantialNewDetail = hasSubstantialNewDetail(latestUser, prevUser);

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
- do not detect story endings
- do not organize narratives
- treat every memory fragment as meaningful
- occasionally use a small listening signal like "Accha…", "Haan…", "I see", or "Hmm…"
- occasionally use a small emoji like 🙂 🙏 😊, but rarely
- never put an emoji inside a question
- vary phrasing and avoid repetition
- the user should always speak more than you

Available behavior modes:
- ACKNOWLEDGMENT
- GENTLE_CONTINUATION
- CONTEXT_PROMPT
- RELATIONAL_PROMPT
- REFLECTIVE_APPRECIATION
- GENTLE_CLOSURE
- LOW_PRESSURE_ENCOURAGEMENT

Use them naturally. Do not mention the mode name.

Important rhythm rules:
- If the previous bot message asked a question, strongly prefer a non-question mode now.
- Only ask again if the latest user message adds substantial new detail and a question would genuinely deepen the memory.
- For very short replies like "yes", "no", "hmm", "haha", or "i agree", prefer LOW_PRESSURE_ENCOURAGEMENT, ACKNOWLEDGMENT, or GENTLE_CLOSURE.
- Do not ask just to keep the conversation going.
- Ask only if there is something genuinely worth asking.

Grounding rule:
- Base your response mainly on the latest user message, while staying aware of the recent conversation.
- Do not bring in unrelated old details.

Return ONLY JSON with:
{
  "mode": "...",
  "reply": "...",
  "should_ask": true or false
}`;

  const user = `Recent conversation:
${conversation_text}

Latest user message:
${latestUser}

Previous user message:
${prevUser || "(none)"}

Previous bot reply:
${last_bot_reply || "(none)"}

Previous bot mode:
${last_bot_mode || "none"}

Latest user adds substantial new detail:
${substantialNewDetail ? "yes" : "no"}

Message count:
${Number(msg_count || 0)}

Write one natural WhatsApp reply.`;

  let parsed = null;
  const raw = await callOpenAI({
    system,
    user,
    temperature: 0.6,
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
  let shouldAsk = Boolean(parsed.should_ask);

  if (!reply) {
    reply = groundedFallbackAck(lang, latestUser);
    mode = "ACKNOWLEDGMENT";
    shouldAsk = false;
  }

  // repetition guard
  if (
    normalizeForCompare(reply) &&
    normalizeForCompare(reply) === normalizeForCompare(last_bot_reply)
  ) {
    reply = groundedFallbackAck(lang, latestUser);
    mode = "ACKNOWLEDGMENT";
    shouldAsk = false;
  }

  // soft guard: no question after question unless strong new detail
  const userAskedQuestion = /[?؟]$/.test(String(latestUser || "").trim());
  if (last_bot_mode === "ASK" && !userAskedQuestion && !substantialNewDetail) {
    shouldAsk = false;
  }

  // short replies should not trigger a question
  if (isShortReply(latestUser)) {
    shouldAsk = false;
  }

  if (!shouldAsk) {
    reply = stripAllQuestionSentences(reply);
    if (!reply) {
      if (lang === "hi" && isShortReply(latestUser)) {
        reply = "कोई बात नहीं। कभी-कभी यादें धीरे-धीरे आती हैं।";
        mode = "LOW_PRESSURE_ENCOURAGEMENT";
      } else if (lang === "gu" && isShortReply(latestUser)) {
        reply = "કોઈ વાત નથી. ક્યારેક યાદો ધીમે ધીમે આવે છે.";
        mode = "LOW_PRESSURE_ENCOURAGEMENT";
      } else if (lang === "en" && isShortReply(latestUser)) {
        reply = "That's alright. Sometimes memories come slowly.";
        mode = "LOW_PRESSURE_ENCOURAGEMENT";
      } else {
        reply = groundedFallbackAck(lang, latestUser);
        mode = "ACKNOWLEDGMENT";
      }
    }
  }

  // if question allowed, keep only one question
  if (shouldAsk) {
    if (!/[?؟]/.test(reply)) {
      reply = `${reply}\n${groundedFallbackQuestion(lang, latestUser)}`.trim();
    }
    reply = keepAtMostOneQuestion(reply);
  }

  // remove emoji from question lines
  if (/[?؟]/.test(reply)) {
    const lines = reply.split("\n").map((x) => x.trim()).filter(Boolean);
    reply = lines
      .map((line) => (/[\?؟]$/.test(line) ? stripEmojiFromQuestion(line) : line))
      .join("\n");
  }

  if (!reply) {
    reply = groundedFallbackAck(lang, latestUser);
    mode = "ACKNOWLEDGMENT";
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