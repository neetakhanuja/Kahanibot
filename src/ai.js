// src/ai.js
// KahaniBot AI: empathetic listener + reflective story builder

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

function pickScaffoldQuestion(lang, mode = "ASK") {
  if (lang === "hi") {
    const askQs = [
      "उस समय आपके साथ कौन था?",
      "यह कहाँ हुआ था?",
      "उस पल आपको सबसे ज़्यादा क्या याद है?",
      "उस समय आपको कैसा लगा?",
      "उस बात में आपके लिए क्या खास था?",
      "आपको उसकी कौन-सी बात सबसे ज़्यादा याद है?",
    ];

    const evokeQs = [
      "क्या आपको उस जगह की कोई खुशबू, आवाज़, या दृश्य याद है?",
      "उस पल की कौन-सी बात आज भी आपके मन में साफ़ है?",
      "उस समय आसपास क्या दिख रहा था या सुनाई दे रहा था?",
    ];

    const bank = mode === "EVOKE" ? evokeQs : askQs;
    return bank[Math.floor(Math.random() * bank.length)];
  }

  if (lang === "gu") {
    const askQs = [
      "તે સમયે તમારી સાથે કોણ હતું?",
      "આ ક્યાં બન્યું હતું?",
      "તમને તે પળમાંથી સૌથી વધુ શું યાદ છે?",
      "તે સમયે તમને કેવું લાગ્યું?",
      "તે વાતમાં તમારા માટે શું ખાસ હતું?",
      "તમને તેની કઈ વાત સૌથી વધુ યાદ છે?",
    ];

    const evokeQs = [
      "શું તમને ત્યાંની કોઈ સુગંધ, અવાજ, અથવા દૃશ્ય યાદ છે?",
      "તે પળની કઈ વાત આજે પણ તમને સ્પષ્ટ યાદ છે?",
      "તે સમયે આસપાસ શું દેખાતું કે સાંભળાતું હતું?",
    ];

    const bank = mode === "EVOKE" ? evokeQs : askQs;
    return bank[Math.floor(Math.random() * bank.length)];
  }

  const askQs = [
    "Who was with you then?",
    "Where did this happen?",
    "What do you remember most from that moment?",
    "How did you feel at that time?",
    "What made that moment special for you?",
    "What do you remember most about the way they did that?",
  ];

  const evokeQs = [
    "Do you remember any particular smell, sound, or sight from that moment?",
    "What detail from that moment still feels vivid to you?",
    "What do you remember seeing or hearing around you then?",
  ];

  const bank = mode === "EVOKE" ? evokeQs : askQs;
  return bank[Math.floor(Math.random() * bank.length)];
}

function cleanLine(text, fallback = "") {
  let out = String(text || "").trim();
  if (!out) return fallback;
  out = out.replace(/^["'\s]+|["'\s]+$/g, "");
  if (out.length > 220) out = out.slice(0, 217).trim() + "...";
  return out;
}

function ensureQuestion(text, lang = "en", mode = "ASK") {
  let q = String(text || "").trim();

  if (!q) return pickScaffoldQuestion(lang, mode);

  if (!/[?؟]$/.test(q)) {
    q = q.replace(/[.。!！]+$/g, "").trim() + "?";
  }

  return q;
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
      t === "would you like to tell me more?" ||
      t === "how did that make you feel?" ||
      t === "what do you remember?" ||
      t === "can you say more?" ||
      t === "what else do you remember?" ||
      t === "would you like to say more?"
    );
  }

  if (lang === "hi") {
    return (
      t === "और क्या हुआ?" ||
      t === "और फिर क्या हुआ?" ||
      t === "और क्या याद आता है?" ||
      t === "क्या आप और बताना चाहेंगे?" ||
      t === "क्या हुआ था?"
    );
  }

  if (lang === "gu") {
    return (
      t === "આ પછી શું થયું?" ||
      t === "પછી શું થયું?" ||
      t === "હવે પછી શું થયું?" ||
      t === "શું તમે વધુ કહેશો?" ||
      t === "પછી શું બન્યું?"
    );
  }

  return false;
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

function parseTaggedBlock(raw) {
  const text = String(raw || "").trim();

  const modeMatch = text.match(
    /MODE:\s*(REFLECT|ASK|SUMMARIZE|ENCOURAGE|EVOKE|CLOSE)/i
  );
  const line1Match = text.match(/LINE1:\s*([\s\S]*?)(?:\nLINE2:|\nQUESTION:|\n$)/i);
  const line2Match = text.match(/LINE2:\s*([\s\S]*?)(?:\nQUESTION:|\n$)/i);
  const questionMatch = text.match(/QUESTION:\s*([\s\S]*?)$/i);

  return {
    mode: modeMatch ? modeMatch[1].toUpperCase() : "",
    line1: line1Match ? line1Match[1].trim() : "",
    line2: line2Match ? line2Match[1].trim() : "",
    question: questionMatch ? questionMatch[1].trim() : "",
  };
}

export async function analyzeStoryProgress({ lang, story_text }) {
  try {
    const system =
      `You are KahaniBot, a warm and thoughtful storytelling companion for older adults in India.\n` +
      `Write in ${langLabel(lang)}.\n\n` +
      `Your job is to act like a patient human listener, not an interviewer.\n` +
      `You must read the whole story so far, not only the latest line.\n\n` +
      `Choose exactly one mode:\n` +
      `REFLECT = acknowledge warmly without asking a question.\n` +
      `ASK = ask one grounded story-building question.\n` +
      `SUMMARIZE = briefly reflect back the story so far to show understanding.\n` +
      `ENCOURAGE = gently support the person to continue, without asking a question.\n` +
      `EVOKE = ask one sensory or vivid-detail question that helps the story come alive.\n` +
      `CLOSE = the story feels complete enough; do not ask a question.\n\n` +
      `Important decision rules:\n` +
      `- Use the whole story context.\n` +
      `- Do not ask a question in every turn.\n` +
      `- Ask only if there is one important missing piece that would naturally help the story.\n` +
      `- A story does NOT need every detail to feel complete.\n` +
      `- If the story already contains a person or relationship, an event or routine, one concrete detail, and emotional meaning, strongly prefer CLOSE.\n` +
      `- If the latest message sounds reflective, settled, emotionally complete, or like a lasting memory, strongly prefer CLOSE.\n` +
      `- If the user shares emotion, longing, affection, loss, or personal meaning, often prefer REFLECT over ASK.\n` +
      `- Use EVOKE only when a sensory or vivid detail would naturally deepen the story.\n` +
      `- Use SUMMARIZE only when enough material has been shared that a short restatement would feel natural.\n` +
      `- Use ENCOURAGE when the user seems tentative, short, or unsure, and a warm nudge is better than a question.\n` +
      `- If the story has a person and an event, but is still missing a vivid detail, a feeling, or what made the moment special, prefer ASK or EVOKE rather than repeated REFLECT.\n` +
      `- If the user has shared two meaningful story turns and the story is still not complete, it is often better to ask one useful question than to keep reflecting.\n` +
      `- A useful question often asks about one of these missing things: what the place felt like, how the person did something, what stood out most, or why the moment stayed with them.\n` +
      `- Never ask multiple questions.\n` +
      `- Never use generic questions like "What happened next?" or "Tell me more?".\n` +
      `- Never sound like a therapist, teacher, or interviewer.\n` +
      `- Never invent details.\n\n` +
      `Story elements you may consider:\n` +
      `people, place, time, action, feeling, sensory detail, meaning.\n` +
      `This is only a guide, not a checklist.\n\n` +
      `Tone rules:\n` +
      `- Warm, respectful, simple.\n` +
      `- Short lines.\n` +
      `- No advice.\n` +
      `- No judgment.\n` +
      `- No exaggerated praise.\n\n` +
      `Output format:\n` +
      `MODE: REFLECT or ASK or SUMMARIZE or ENCOURAGE or EVOKE or CLOSE\n` +
      `LINE1: first short response line\n` +
      `LINE2: second short response line if needed, otherwise leave blank\n` +
      `QUESTION: one gentle question only if MODE is ASK or EVOKE, otherwise leave blank\n` +
      `Return exactly these four tags and nothing else.`;

    const user = `Story so far:\n${story_text}`;

    const out = await callOpenAI({ system, user, temperature: 0.45 });
    if (!out) return null;

    const parsed = parseTaggedBlock(out);
    if (!parsed.mode) return null;

    let mode = parsed.mode;
    let line1 = cleanLine(parsed.line1);
    let line2 = cleanLine(parsed.line2);
    let question = cleanLine(parsed.question);

    if (mode === "ASK" || mode === "EVOKE") {
      question = ensureQuestion(question, lang || "en", mode);
      if (isTooGenericQuestion(lang || "en", question)) {
        question = pickScaffoldQuestion(lang || "en", mode);
      }
    }

    return {
      mode,
      line1,
      line2,
      question,
    };
  } catch {
    return null;
  }
}

export async function generateStoryTurn({ lang, story_text }) {
  const analysis = await analyzeStoryProgress({ lang, story_text });

  if (!analysis) {
    const line1 =
      lang === "hi"
        ? "यह एक अर्थपूर्ण कहानी लगती है।"
        : lang === "gu"
        ? "આ એક અર્થસભર વાર્તા લાગે છે."
        : "That sounds like a meaningful story.";

    const question = pickScaffoldQuestion(lang || "en", "ASK");

    return {
      mode: "ASK",
      text: `${line1}\n${question}`,
      analysis: {
        mode: "ASK",
        line1,
        line2: "",
        question,
      },
    };
  }

  const { mode, line1, line2, question } = analysis;

  if (mode === "CLOSE") {
    const closeLine1 =
      line1 ||
      (lang === "hi"
        ? "धन्यवाद, आपने यह कहानी मेरे साथ साझा की।"
        : lang === "gu"
        ? "આ વાર્તા મારી સાથે શેર કરવા બદલ આભાર."
        : "Thank you for sharing that story with me.");

    const closeLine2 = line2 || "";

    return {
      mode: "CLOSE",
      text: [closeLine1, closeLine2].filter(Boolean).join("\n"),
      analysis,
    };
  }

  if (mode === "REFLECT") {
    const reflectLine1 =
      line1 ||
      (lang === "hi"
        ? "यह कहानी बहुत अर्थपूर्ण लगती है।"
        : lang === "gu"
        ? "આ વાર્તા ખૂબ અર્થસભર લાગે છે."
        : "That sounds like a meaningful story.");

    return {
      mode: "REFLECT",
      text: [reflectLine1, line2].filter(Boolean).join("\n"),
      analysis,
    };
  }

  if (mode === "SUMMARIZE") {
    const summaryLine1 =
      line1 ||
      (lang === "hi"
        ? "मैं आपकी कहानी को इस तरह सुन रहा/रही हूँ।"
        : lang === "gu"
        ? "હું તમારી વાર્તાને આ રીતે સાંભળી રહ્યો/રહી છું."
        : "I’m hearing your story like this.");

    return {
      mode: "SUMMARIZE",
      text: [summaryLine1, line2].filter(Boolean).join("\n"),
      analysis,
    };
  }

  if (mode === "ENCOURAGE") {
    const encourageLine1 =
      line1 ||
      (lang === "hi"
        ? "यह एक सच्ची और कोमल कहानी लगती है।"
        : lang === "gu"
        ? "આ એક સચ્ચી અને નરમાઈભરી વાર્તા લાગે છે."
        : "This feels like a gentle and real story.");

    return {
      mode: "ENCOURAGE",
      text: [encourageLine1, line2].filter(Boolean).join("\n"),
      analysis,
    };
  }

  if (mode === "EVOKE") {
    const evokeLine1 =
      line1 ||
      (lang === "hi"
        ? "उस पल में कुछ बहुत जीवंत लगता है।"
        : lang === "gu"
        ? "તે પળમાં કંઈક ખૂબ જીવંત લાગે છે."
        : "There is something very vivid in that moment.");

    const evokeQuestion = question || pickScaffoldQuestion(lang || "en", "EVOKE");

    return {
      mode: "EVOKE",
      text: [evokeLine1, line2, evokeQuestion].filter(Boolean).join("\n"),
      analysis,
    };
  }

  const askLine1 =
    line1 ||
    (lang === "hi"
      ? "यह एक अर्थपूर्ण कहानी लगती है।"
      : lang === "gu"
      ? "આ એક અર્થસભર વાર્તા લાગે છે."
      : "That sounds like a meaningful story.");

  const askQuestion = question || pickScaffoldQuestion(lang || "en", "ASK");

  return {
    mode: "ASK",
    text: [askLine1, line2, askQuestion].filter(Boolean).join("\n"),
    analysis,
  };
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