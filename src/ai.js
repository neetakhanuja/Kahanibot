// src/ai.js
// KahaniBot AI: focused story companion for older adults

const AI_ENABLED = String(process.env.AI_ENABLED || "").toLowerCase() === "true";
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

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

function defaultQuestionForType(lang, questionType = "detail") {
  if (lang === "hi") {
    const map = {
      person: "उस समय आपके साथ कौन था?",
      place: "उस जगह के बारे में आपको क्या याद है?",
      action: "उस समय ठीक-ठीक क्या हुआ था?",
      feeling: "उस पल आपको कैसा लगा था?",
      sensory: "वहाँ का कोई दृश्य, आवाज़, या खुशबू आपको याद है?",
      meaning: "उस बात में आपके लिए क्या खास था?",
      detail: "उस पल की कौन-सी बात आपको सबसे साफ़ याद है?",
    };
    return map[questionType] || map.detail;
  }

  if (lang === "gu") {
    const map = {
      person: "તે સમયે તમારી સાથે કોણ હતું?",
      place: "એ જગ્યાની તમને શું યાદ છે?",
      action: "તે વખતે ચોક્કસ શું બન્યું હતું?",
      feeling: "તે પળે તમને કેવું લાગ્યું હતું?",
      sensory: "ત્યાંનો કોઈ અવાજ, દૃશ્ય, કે સુગંધ તમને યાદ છે?",
      meaning: "તે વાતમાં તમારા માટે શું ખાસ હતું?",
      detail: "તે પળની કઈ વાત તમને સૌથી વધુ સ્પષ્ટ યાદ છે?",
    };
    return map[questionType] || map.detail;
  }

  const map = {
    person: "Who was with you then?",
    place: "What do you remember about that place?",
    action: "What exactly happened in that moment?",
    feeling: "How did you feel then?",
    sensory: "Do you remember any sound, sight, or smell from there?",
    meaning: "What made that moment special for you?",
    detail: "What part of that moment do you remember most clearly?",
  };

  return map[questionType] || map.detail;
}

function genericReflectionFallback(lang, story_text = "") {
  const s = String(story_text || "").toLowerCase();

  if (lang === "hi") {
    if (s.includes("mother") || s.includes("father") || s.includes("brother") || s.includes("sister")) {
      return "यह किसी अपने के साथ जुड़ी हुई याद लगती है।";
    }
    if (s.includes("school") || s.includes("village") || s.includes("home")) {
      return "इसमें उस समय और जगह की एक साफ़ झलक आती है।";
    }
    return "मैं आपकी बात ध्यान से सुन रहा/रही हूँ।";
  }

  if (lang === "gu") {
    if (s.includes("mother") || s.includes("father") || s.includes("brother") || s.includes("sister")) {
      return "આ કોઈ નજીકના વ્યક્તિ સાથે જોડાયેલી યાદ લાગે છે.";
    }
    if (s.includes("school") || s.includes("village") || s.includes("home")) {
      return "આમાં તે સમય અને જગ્યાની સ્પષ્ટ ઝાંખી મળે છે.";
    }
    return "હું તમારી વાત ધ્યાનથી સાંભળું છું.";
  }

  if (s.includes("mother") || s.includes("father") || s.includes("brother") || s.includes("sister")) {
    return "That sounds like a memory closely tied to someone important.";
  }
  if (s.includes("school") || s.includes("village") || s.includes("home")) {
    return "That gives a clear sense of that time and place.";
  }
  return "I’m listening carefully to your story.";
}

function isTooGenericQuestion(q = "") {
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
  last_question_type = "none",
  msg_count = 0,
}) {
  try {
    const system =
      `You are KahaniBot, a warm storytelling companion for older adults in India.\n` +
      `Write in ${langLabel(lang)}.\n\n` +
      `You are helping someone tell one personal story.\n` +
      `You are not an interviewer, therapist, teacher, or poet.\n\n` +
      `Your only job is to choose ONE next move:\n` +
      `ASK = ask one concrete question that helps build the scene or meaning.\n` +
      `REFLECT = one brief grounded acknowledgment tied to a specific detail already mentioned.\n` +
      `CLOSE = the story feels complete enough; do not ask a question.\n\n` +
      `Very important rules:\n` +
      `- Read the whole story so far.\n` +
      `- Avoid generic praise or vague reflection.\n` +
      `- Never say things like "this is a meaningful story", "childhood memories are special", or similar filler.\n` +
      `- If you reflect, mention a specific detail already present in the story.\n` +
      `- If the story is still developing, prefer ASK over repeated reflection.\n` +
      `- Ask about only one missing thing.\n` +
      `- Good question targets are: person, place, action, feeling, sensory detail, meaning.\n` +
      `- Never repeat the same question type as the previous turn.\n` +
      `- Previous question type was: ${last_question_type || "none"}.\n` +
      `- Never ask generic questions like "What happened next?" or "Tell me more?"\n` +
      `- After about 2 to 4 meaningful turns, if the story already has a person or relationship, an event or routine, and emotional meaning, prefer CLOSE.\n` +
      `- If the latest line sounds settled, reflective, or complete, strongly prefer CLOSE.\n` +
      `- Keep the response short.\n\n` +
      `Output exactly in this format:\n` +
      `MODE: ASK or REFLECT or CLOSE\n` +
      `LINE1: one short line\n` +
      `QUESTION: one question only if MODE is ASK, otherwise leave blank\n`;

    const user =
      `Message count: ${Number(msg_count || 0)}\n\n` +
      `Story so far:\n${story_text}`;

    const out = await callOpenAI({ system, user, temperature: 0.35 });
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
  last_question_type = "none",
  msg_count = 0,
}) {
  const analysis = await analyzeStoryProgress({
    lang,
    story_text,
    last_question_type,
    msg_count,
  });

  if (!analysis) {
    const line1 = genericReflectionFallback(lang, story_text);
    const question = defaultQuestionForType(lang, "detail");

    return {
      mode: "ASK",
      text: `${line1}\n${question}`,
      question_type: "detail",
      analysis: {
        mode: "ASK",
        line1,
        question,
      },
    };
  }

  const mode = analysis.mode;
  const line1 = analysis.line1 || genericReflectionFallback(lang, story_text);

  if (mode === "CLOSE") {
    return {
      mode: "CLOSE",
      text: line1,
      question_type: "none",
      analysis,
    };
  }

  if (mode === "REFLECT") {
    return {
      mode: "REFLECT",
      text: line1,
      question_type: "none",
      analysis,
    };
  }

  const storyLower = String(story_text || "").toLowerCase();
  const used = String(last_question_type || "none").toLowerCase();

  let questionType = "detail";

  if (
    !used.includes("person") &&
    /(mother|father|brother|sister|friend|teacher|grandmother|grandfather|uncle|aunt|husband|wife|son|daughter|maa|papa|bhai|behen|dadi|nani)/i.test(storyLower) === false
  ) {
    questionType = "person";
  } else if (!used.includes("place") && !/(school|home|village|town|market|river|temple|shop|stall|house)/i.test(storyLower)) {
    questionType = "place";
  } else if (!used.includes("feeling") && !/(felt|happy|sad|afraid|excited|worried|remember|miss|love|loved)/i.test(storyLower)) {
    questionType = "feeling";
  } else if (!used.includes("sensory")) {
    questionType = "sensory";
  } else if (!used.includes("meaning")) {
    questionType = "meaning";
  } else {
    questionType = "detail";
  }

  let question = ensureQuestion(
    analysis.question,
    defaultQuestionForType(lang, questionType)
  );

  if (isTooGenericQuestion(question)) {
    question = defaultQuestionForType(lang, questionType);
  }

  return {
    mode: "ASK",
    text: [line1, question].filter(Boolean).join("\n"),
    question_type: questionType,
    analysis: {
      mode: "ASK",
      line1,
      question,
    },
  };
}

/*
  Conservative story polish.
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