// src/conversation.js

import fs from "fs";
import path from "path";

import { getSheetsClient, readRange } from "./sheets.js";
import { saveStory } from "./storyStore.js";
import { generateStoryTurn, polishStory } from "./ai.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SESSIONS_TAB = "sessions";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "https://kahanibot-l0l7.onrender.com";

console.log("[BOOT] conversation.js loaded");

// --------------------
// Helpers
// --------------------
function isoNow() {
  return new Date().toISOString();
}

function headerIndex(headers, name) {
  return (headers || []).findIndex(
    (h) => String(h || "").trim().toLowerCase() === String(name || "").trim().toLowerCase()
  );
}

function normalizeText(s) {
  return String(s || "").trim();
}

function storyPageUrl(user_id) {
  return `${PUBLIC_BASE_URL}/u/${encodeURIComponent(String(user_id || ""))}`;
}

function detectLangFromText(text, fallback = "en") {
  const t = String(text || "").trim();

  if (!t) return fallback;

  if (/[\u0A80-\u0AFF]/.test(t)) return "gu";
  if (/[\u0900-\u097F]/.test(t)) return "hi";

  const lower = t.toLowerCase();

  if (
    lower.includes("in hindi") ||
    lower.includes("speak hindi") ||
    lower === "hindi" ||
    lower === "hi"
  ) {
    return "hi";
  }

  if (
    lower.includes("in gujarati") ||
    lower.includes("speak gujarati") ||
    lower === "gujarati" ||
    lower === "gu"
  ) {
    return "gu";
  }

  if (lower.includes("in english") || lower === "english" || lower === "en") {
    return "en";
  }

  return fallback;
}

function isGreetingOnly(text) {
  const t = String(text || "").trim().toLowerCase();
  return [
    "hi",
    "hello",
    "hey",
    "namaste",
    "good morning",
    "good afternoon",
    "good evening",
    "hii",
    "helo",
  ].includes(t);
}

function isTopicRequest(text) {
  const t = String(text || "").trim().toLowerCase();

  const phrases = [
    "give me a topic",
    "suggest a topic",
    "suggest something",
    "you suggest",
    "give me something",
    "topic",
    "prompt",
    "suggest",
    "give topic",
    "give me a prompt",
    "mujhe topic do",
    "koi topic do",
    "topic do",
    "koi vishay do",
    "મને વિષય આપો",
    "કોઈ વિષય આપો",
    "વિષય આપો",
    "મને ટોપિક આપો",
  ];

  return phrases.some((p) => t.includes(p));
}

function parsePrivacyChoice(text) {
  const t = String(text || "").trim().toLowerCase();

  const privateWords = [
    "private",
    "keep private",
    "privately",
    "just for me",
    "only me",
    "personal",
    "not public",
    "do not share",
    "don't share",
    "मत शेयर करो",
    "प्राइवेट",
    "निजी",
    "private rakho",
    "શેર ન કરશો",
    "પ્રાઇવેટ",
    "ખાનગી",
    "માત્ર મારી માટે",
  ];

  const shareWords = [
    "share",
    "shared",
    "public",
    "make public",
    "story page",
    "put it on my story page",
    "yes share",
    "post it",
    "publish",
    "share it",
    "शेयर",
    "पब्लिक",
    "share karo",
    "share kar do",
    "શેર",
    "પબ્લિક",
    "મારા સ્ટોરી પેજ પર મૂકો",
  ];

  if (privateWords.some((p) => t.includes(p))) return "private";
  if (shareWords.some((p) => t.includes(p))) return "share";

  return null;
}

function isManualFinish(text) {
  const t = String(text || "").trim().toLowerCase();

  const phrases = [
    "done",
    "finish",
    "finished",
    "end",
    "end story",
    "end of story",
    "story end",
    "story ends",
    "story finished",
    "story done",
    "the end",
    "thats all",
    "that's all",
    "that is all",
    "that was all",
    "that was it",
    "thats it",
    "that's it",
    "that is it",
    "that is the story",
    "that's the story",
    "story khatam",
    "khatam ho gai",
    "khatam ho gayi",
    "ha story khatam ho gai",
    "ha story khatam ho gayi",
    "मेरी कहानी खत्म",
    "कहानी खत्म",
    "खत्म",
    "વાર્તા ખતમ",
    "ખતમ",
    "બસ એટલું જ",
    "આટલું જ",
    "बस इतना ही",
  ];

  return phrases.some((p) => t.includes(p));
}

function hasReflectiveEnding(text) {
  const t = String(text || "").trim().toLowerCase();

  const phrases = [
    "stayed with me",
    "stay with me",
    "has stayed with me",
    "that stayed with me",
    "those days stayed with me",
    "that memory stayed with me",
    "for the rest of my life",
    "all my life",
    "my whole life",
    "to this day",
    "till today",
    "even today",
    "even now i remember",
    "i still remember",
    "i still remember those days",
    "i still think about it",
    "i never forgot",
    "i have never forgotten",
    "i miss those days",
    "i miss that time",
    "i still miss her",
    "i still miss him",
    "that is the memory i carry with me",
    "this is the memory i carry with me",
    "those moments were very special",
    "those moments were special",
    "that was very special to me",
    "that memory remains with me",
    "it remains with me",
    "it stayed with me",
    "aaj bhi yaad hai",
    "आज भी याद है",
    "आज भी याद आता है",
    "आज तक याद है",
    "अब भी याद है",
    "હજુ પણ યાદ છે",
    "આજેય યાદ છે",
    "આજ સુધી યાદ છે",
  ];

  return phrases.some((p) => t.includes(p));
}

function seemsLikeNaturalEnding(text) {
  const t = String(text || "").trim().toLowerCase();

  const endings = [
    "that's all",
    "that is all",
    "that was it",
    "that was all",
    "that is the story",
    "that's the story",
    "that is my story",
    "that's what i remember",
    "that is what i remember",
    "nothing more",
    "no more",
    "bas itna hi",
    "बस इतना ही",
    "बस यही",
    "यही याद है",
    "यही कहानी है",
    "इतना ही",
    "આટલું જ",
    "બસ એટલું જ",
    "આ જ વાર્તા છે",
  ];

  if (endings.some((p) => t.includes(p))) return true;
  if (hasReflectiveEnding(t)) return true;

  return false;
}

function parseEndConfirmation(text) {
  const t = String(text || "").trim().toLowerCase();

  const continueWords = [
    "more",
    "add more",
    "i want to add more",
    "let me add more",
    "continue",
    "i want to continue",
    "not yet",
    "wait",
    "i want to say more",
    "i have more to say",
    "more to add",
    "और",
    "और बताना है",
    "अभी और",
    "હજુ",
    "હજુ થોડું",
    "વધારે",
    "હજુ કહેવું છે",
  ];

  const saveWords = [
    "save",
    "save it",
    "you can save it",
    "save now",
    "done",
    "finished",
    "that's all",
    "that is all",
    "nothing more",
    "no more",
    "yes save",
    "okay save",
    "ok save",
    "बस",
    "सेव",
    "सेव कर दो",
    "सेव करो",
    "બસ",
    "સેવ",
    "સેવ કરો",
  ];

  if (continueWords.some((p) => t.includes(p))) return "MORE";
  if (saveWords.some((p) => t.includes(p))) return "SAVE";

  return null;
}

function shouldTreatAsStory(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isGreetingOnly(t)) return false;
  if (isTopicRequest(t)) return false;
  if (parsePrivacyChoice(t)) return false;
  return true;
}

function fallbackQuestion(lang) {
  if (lang === "hi") {
    const qs = [
      "उस समय आपके साथ कौन था?",
      "यह कहाँ हुआ था?",
      "उस पल आपको सबसे ज़्यादा क्या याद है?",
      "उस समय आपको कैसा लगा?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  if (lang === "gu") {
    const qs = [
      "તે સમયે તમારી સાથે કોણ હતું?",
      "આ ક્યાં બન્યું હતું?",
      "તમને તે પળમાંથી સૌથી વધુ શું યાદ છે?",
      "તે સમયે તમને કેવું લાગ્યું?",
    ];
    return qs[Math.floor(Math.random() * qs.length)];
  }

  const qs = [
    "Who was with you then?",
    "Where did this happen?",
    "What do you remember most from that moment?",
    "How did you feel at that time?",
  ];
  return qs[Math.floor(Math.random() * qs.length)];
}

function openingText(lang) {
  if (lang === "hi") {
    return (
      "नमस्ते.\n" +
      "मैं आपकी एक कहानी सुनना चाहूँगा/चाहूँगी.\n\n" +
      "अगर कोई कहानी आप साझा करना चाहें, तो मुझे बताइए.\n" +
      "और अगर आप चाहें, तो मैं आपको एक विषय सुझा सकता/सकती हूँ."
    );
  }

  if (lang === "gu") {
    return (
      "નમસ્તે.\n" +
      "હું તમારી એક વાર્તા સાંભળવા માંગુ છું.\n\n" +
      "જો કોઈ વાર્તા તમે શેર કરવા માંગતા હો, તો મને કહો.\n" +
      "અને જો તમે ઇચ્છો, તો હું તમને એક વિષય સૂચવી શકું."
    );
  }

  return (
    "Hello.\n" +
    "I would love to listen to one of your stories.\n\n" +
    "If there is a story you would like to share, please tell me about it.\n" +
    "And if you prefer, I can suggest a topic for you."
  );
}

function topicIntroText(lang, topic) {
  if (lang === "hi") {
    return `यह एक विषय है:\n${topic}\n\nजब मन हो, इस पर अपनी कहानी बताइए।`;
  }

  if (lang === "gu") {
    return `આ એક વિષય છે:\n${topic}\n\nજ્યારે મન થાય, તેના વિશે તમારી વાર્તા કહો.`;
  }

  return `Here is a topic:\n${topic}\n\nWhenever you are ready, tell me a story about it.`;
}

function askEndConfirmText(lang) {
  if (lang === "hi") {
    return (
      "धन्यवाद, आपने यह याद बहुत सुंदर तरीके से साझा की.\n\n" +
      "क्या आप इसमें कुछ और जोड़ना चाहेंगे, या हम इसे सेव कर दें?\n" +
      "Reply MORE or SAVE."
    );
  }

  if (lang === "gu") {
    return (
      "આ યાદ તમે ખૂબ સુંદર રીતે શેર કરી.\n\n" +
      "શું તમે તેમાં કંઈ વધુ ઉમેરવા માંગો છો, કે આપણે તેને સેવ કરી દઈએ?\n" +
      "Reply MORE or SAVE."
    );
  }

  return (
    "Thank you for sharing that memory.\n\n" +
    "Would you like to add anything else to this story, or shall we save it?\n" +
    "Reply MORE or SAVE."
  );
}

function endConfirmReminderText(lang) {
  if (lang === "hi") return "अगर आप कुछ और जोड़ना चाहें तो MORE लिखें, या सेव करने के लिए SAVE लिखें।";
  if (lang === "gu") return "જો તમે કંઈ વધુ ઉમેરવા માંગો છો તો MORE લખો, અથવા સેવ કરવા માટે SAVE લખો.";
  return "If you want to add something more, reply MORE. If you want to save it now, reply SAVE.";
}

function continueAfterEndCheckText(lang) {
  if (lang === "hi") return "ठीक है, मैं सुन रहा/रही हूँ। आप आगे बताइए।";
  if (lang === "gu") return "બરાબર, હું સાંભળું છું. તમે આગળ કહો.";
  return "Okay, I’m listening. Please go on.";
}

function askPrivacyText(lang) {
  if (lang === "hi") {
    return (
      "धन्यवाद, आपने यह कहानी मेरे साथ साझा की.\n\n" +
      "क्या आप इस कहानी को निजी रखना चाहेंगे, या इसे अपने story page पर दिखाना चाहेंगे?\n" +
      "Reply PRIVATE or SHARE."
    );
  }

  if (lang === "gu") {
    return (
      "આ વાર્તા મારી સાથે શેર કરવા બદલ આભાર.\n\n" +
      "શું તમે આ વાર્તાને ખાનગી રાખવા માંગો છો, કે તમારા story page પર બતાવવા માંગો છો?\n" +
      "Reply PRIVATE or SHARE."
    );
  }

  return (
    "Thank you for sharing that story with me.\n\n" +
    "Would you like to keep this story private, or would you like it to appear on your story page?\n" +
    "Reply PRIVATE or SHARE."
  );
}

function privacyReminderText(lang) {
  if (lang === "hi") return "कृपया PRIVATE या SHARE लिखें।";
  if (lang === "gu") return "કૃપા કરીને PRIVATE અથવા SHARE લખો.";
  return "Please reply PRIVATE or SHARE.";
}

function savedPrivateText(lang, user_id) {
  const url = storyPageUrl(user_id);

  if (lang === "hi") {
    return `आपकी कहानी निजी रूप से सेव हो गई है.\n${url}`;
  }

  if (lang === "gu") {
    return `તમારી વાર્તા ખાનગી રીતે સેવ થઈ ગઈ છે.\n${url}`;
  }

  return `Your story has been saved privately.\n${url}`;
}

function savedSharedText(lang, user_id) {
  const url = storyPageUrl(user_id);

  if (lang === "hi") {
    return `आपकी कहानी आपके story page पर जोड़ दी गई है.\nआप चाहें तो यह लिंक साझा कर सकते हैं:\n${url}`;
  }

  if (lang === "gu") {
    return `તમારી વાર્તા તમારા story page પર મૂકી દેવામાં આવી છે.\nઇચ્છો તો આ link શેર કરી શકો:\n${url}`;
  }

  return `Your story has been added to your story page.\nYou can share this link if you like:\n${url}`;
}

function stoppedText(lang) {
  if (lang === "hi") return "ठीक है. जब भी फिर से बात करनी हो, START लिखें।";
  if (lang === "gu") return "બરાબર. જ્યારે ફરી શરૂ કરવું હોય, START લખો.";
  return "Okay. Write START anytime if you would like to continue again.";
}

function topicFallback(lang) {
  if (lang === "hi") return "एक ऐसी कहानी जो आज भी आपके साथ है";
  if (lang === "gu") return "એવી એક વાર્તા જે આજે પણ તમારી સાથે છે";
  return "A story that has stayed with you";
}

function looksQuestionLike(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (/[?؟]$/.test(t)) return true;

  const starters = [
    "who ",
    "what ",
    "where ",
    "when ",
    "why ",
    "how ",
    "do you ",
    "did you ",
    "can you ",
    "would you ",
    "क्या ",
    "कौन ",
    "कहाँ ",
    "कैसा ",
    "कैसे ",
    "શું ",
    "કોણ ",
    "ક્યાં ",
    "કેવું ",
    "કેવી રીતે ",
  ];

  return starters.some((s) => t.startsWith(s));
}

// --------------------
// MANAN deck
// --------------------
let MANAN_CACHE = null;

function loadMananCards() {
  if (MANAN_CACHE) return MANAN_CACHE;

  try {
    const filePath = path.join(process.cwd(), "cards", "manan_cards.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw);

    MANAN_CACHE = (arr || [])
      .map((c) => (c && (c.en || c.hi || c.gu) ? c : null))
      .filter(Boolean);

    return MANAN_CACHE;
  } catch {
    MANAN_CACHE = [];
    return MANAN_CACHE;
  }
}

function randomTopic(lang = "en") {
  const cards = loadMananCards();
  if (!cards.length) return topicFallback(lang);

  const c = cards[Math.floor(Math.random() * cards.length)];
  return String(c?.[lang] || c?.en || c?.hi || c?.gu || topicFallback(lang)).trim();
}

// --------------------
// Sheets session store
// --------------------
async function loadSession(user_id) {
  const sheets = await getSheetsClient();
  const range = `${SESSIONS_TAB}!A:Z`;
  const rows = await readRange({ sheets, spreadsheetId: SHEET_ID, range });

  if (!rows?.length) return null;

  const headers = rows[0];
  const idxUser = headerIndex(headers, "user_id");
  if (idxUser === -1) return null;

  const idxState = headerIndex(headers, "state");
  const idxStory = headerIndex(headers, "story_text");
  const idxStoryId = headerIndex(headers, "story_id");
  const idxConsent = headerIndex(headers, "consent");
  const idxLang = headerIndex(headers, "lang");
  const idxMsgCount = headerIndex(headers, "msg_count");
  const idxSeed = headerIndex(headers, "seed_prompt");
  const idxLastPrompt = headerIndex(headers, "last_agent_prompt");

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (String(row[idxUser] || "") === String(user_id)) {
      return {
        headers,
        rowIndex: r + 1,
        user_id,
        state: row[idxState] || "READY",
        story_text: row[idxStory] || "",
        story_id: row[idxStoryId] || "",
        consent: String(row[idxConsent] || "").toLowerCase() === "true",
        lang: row[idxLang] || "en",
        msg_count: Number(row[idxMsgCount] || 0),
        seed_prompt: idxSeed === -1 ? "" : row[idxSeed] || "",
        last_agent_prompt: idxLastPrompt === -1 ? "" : row[idxLastPrompt] || "",
      };
    }
  }

  return null;
}

async function upsertSession(session) {
  const sheets = await getSheetsClient();
  const range = `${SESSIONS_TAB}!A:Z`;
  const rows = await readRange({ sheets, spreadsheetId: SHEET_ID, range });

  if (!rows?.length) throw new Error("sessions tab missing");

  const headers = rows[0];

  function col(name) {
    const i = headerIndex(headers, name);
    if (i === -1) throw new Error(`Missing column in sessions: ${name}`);
    return i;
  }

  const idxUser = col("user_id");
  const idxState = col("state");
  const idxStory = col("story_text");
  const idxStoryId = col("story_id");
  const idxConsent = col("consent");
  const idxLang = col("lang");
  const idxMsgCount = col("msg_count");

  const idxSeed = headerIndex(headers, "seed_prompt");
  const idxLastPrompt = headerIndex(headers, "last_agent_prompt");
  const idxUpdated = headerIndex(headers, "updated_at");
  const idxCreated = headerIndex(headers, "created_at");

  let foundRowIndex = -1;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (String(row[idxUser] || "") === String(session.user_id)) {
      foundRowIndex = r + 1;
      break;
    }
  }

  const isNew = foundRowIndex === -1;
  const targetRowIndex = isNew ? rows.length + 1 : foundRowIndex;
  const outRow = new Array(headers.length).fill("");

  outRow[idxUser] = session.user_id;
  outRow[idxState] = session.state || "READY";
  outRow[idxStory] = session.story_text || "";
  outRow[idxStoryId] = session.story_id || "";
  outRow[idxConsent] = String(session.consent !== false);
  outRow[idxLang] = session.lang || "en";
  outRow[idxMsgCount] = String(session.msg_count || 0);

  if (idxSeed !== -1) outRow[idxSeed] = session.seed_prompt || "";
  if (idxLastPrompt !== -1) outRow[idxLastPrompt] = session.last_agent_prompt || "";

  if (idxUpdated !== -1) outRow[idxUpdated] = isoNow();
  if (idxCreated !== -1 && isNew) outRow[idxCreated] = isoNow();

  const writeRange = `${SESSIONS_TAB}!A${targetRowIndex}:Z${targetRowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: writeRange,
    valueInputOption: "RAW",
    requestBody: { values: [outRow] },
  });
}

async function resetSession(user_id, lang = "en") {
  await upsertSession({
    user_id,
    state: "READY",
    story_text: "",
    story_id: "",
    consent: true,
    lang,
    msg_count: 0,
    seed_prompt: "",
    last_agent_prompt: "",
  });
}

function buildAiInput({ seed_prompt, fullStory }) {
  const themeBlock = seed_prompt ? `Theme: ${seed_prompt}` : "Theme:";
  const storyBlock = fullStory ? `Full story so far:\n${fullStory}` : "Full story so far:";

  return `${themeBlock}\n\n${storyBlock}`;
}

function adaptAiTurnToFlow({ aiTurn, lang, last_agent_prompt }) {
  if (!aiTurn) {
    return {
      mode: "ASK",
      text: fallbackQuestion(lang),
    };
  }

  const lastWasQuestion = looksQuestionLike(last_agent_prompt);
  const thisIsQuestionMode = aiTurn.mode === "ASK" || aiTurn.mode === "EVOKE";

  if (lastWasQuestion && thisIsQuestionMode) {
    const text =
      aiTurn.analysis?.line1 ||
      aiTurn.analysis?.line2 ||
      (lang === "hi"
        ? "मैं आपकी कहानी सुन रहा/रही हूँ।"
        : lang === "gu"
        ? "હું તમારી વાર્તા સાંભળી રહ્યો/રહી છું."
        : "I’m listening to your story.");

    return {
      mode: "REFLECT",
      text,
      analysis: {
        mode: "REFLECT",
        line1: text,
        line2: "",
        question: "",
      },
    };
  }

  return aiTurn;
}

async function buildStoryReply({
  lang,
  seed_prompt,
  fullStory,
  last_agent_prompt,
}) {
  const aiInput = buildAiInput({
    seed_prompt,
    fullStory,
  });

  const aiResult = await generateStoryTurn({
    lang,
    story_text: aiInput,
  });

  const adapted = adaptAiTurnToFlow({
    aiTurn: aiResult,
    lang,
    last_agent_prompt,
  });

  if (adapted) return adapted;

  return {
    mode: "ASK",
    text: fallbackQuestion(lang),
  };
}

function shouldSuggestEndCheck({ msg, story_text, msg_count }) {
  const latest = String(msg || "").trim();
  const cleanStory = String(story_text || "").trim();

  if (!cleanStory) return false;
  if (isManualFinish(latest)) return false;

  const wordCount = cleanStory.split(/\s+/).filter(Boolean).length;
  const longEnough =
    cleanStory.length >= 80 || Number(msg_count || 0) >= 2 || wordCount >= 18;

  if (!longEnough) return false;

  return seemsLikeNaturalEnding(latest);
}

async function finalizeStory({ user_id, lang, story_text, publish }) {
  const polished = await polishStory({
    lang,
    story_text,
  });

  const finalStoryText = polished?.body || String(story_text || "").trim();

  await saveStory({
    user_id,
    story_text: finalStoryText,
    publish,
    title: polished?.title || "",
    polished_story_text: finalStoryText,
    transcript_text: String(story_text || "").trim(),
  });

  await resetSession(user_id, lang);

  return publish ? savedSharedText(lang, user_id) : savedPrivateText(lang, user_id);
}

async function processTurn({ user_id, text, forcedLang }) {
  const msg = normalizeText(text);
  let session = await loadSession(user_id);

  if (!session) {
    session = {
      user_id,
      state: "READY",
      story_text: "",
      story_id: "",
      consent: true,
      lang: forcedLang || detectLangFromText(msg, "en"),
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: "",
    };

    await upsertSession(session);
  }

  let lang = forcedLang || session.lang || detectLangFromText(msg, "en");
  lang = detectLangFromText(msg, lang);

  const lower = msg.toLowerCase();

  if (lower === "stop") {
    await upsertSession({
      ...session,
      state: "STOPPED",
      lang,
      last_agent_prompt: stoppedText(lang),
    });
    return stoppedText(lang);
  }

  if (lower === "start") {
    await resetSession(user_id, lang);
    const open = openingText(lang);
    await upsertSession({
      user_id,
      state: "READY",
      story_text: "",
      story_id: "",
      consent: true,
      lang,
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: open,
    });
    return open;
  }

  if (lower === "reset") {
    await resetSession(user_id, lang);
    const open = openingText(lang);
    await upsertSession({
      user_id,
      state: "READY",
      story_text: "",
      story_id: "",
      consent: true,
      lang,
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: open,
    });
    return open;
  }

  if (session.state === "STOPPED") {
    return "";
  }

  if (session.state === "CONFIRM_END") {
    const privacyChoice = parsePrivacyChoice(msg);
    if (privacyChoice) {
      const savedReply = await finalizeStory({
        user_id,
        lang,
        story_text: session.story_text,
        publish: privacyChoice === "share",
      });
      return savedReply;
    }

    const endChoice = parseEndConfirmation(msg);

    if (endChoice === "SAVE" || isManualFinish(msg)) {
      const privacyMsg = askPrivacyText(lang);

      await upsertSession({
        ...session,
        state: "ASK_PRIVACY",
        lang,
        last_agent_prompt: privacyMsg,
      });

      return privacyMsg;
    }

    if (endChoice === "MORE") {
      const continueMsg = continueAfterEndCheckText(lang);

      await upsertSession({
        ...session,
        state: "COLLECTING",
        lang,
        last_agent_prompt: continueMsg,
      });

      return continueMsg;
    }

    if (shouldTreatAsStory(msg)) {
      const continuedStory = session.story_text ? `${session.story_text}\n${msg}` : msg;
      const continuedCount = Number(session.msg_count || 0) + 1;

      const aiTurn = await buildStoryReply({
        lang,
        seed_prompt: session.seed_prompt || "",
        fullStory: continuedStory,
        last_agent_prompt: session.last_agent_prompt || "",
      });

      if (aiTurn?.mode === "CLOSE") {
        const confirmMsg = askEndConfirmText(lang);

        await upsertSession({
          ...session,
          state: "CONFIRM_END",
          lang,
          story_text: continuedStory,
          msg_count: continuedCount,
          last_agent_prompt: confirmMsg,
        });

        return confirmMsg;
      }

      const replyText = aiTurn?.text || fallbackQuestion(lang);

      await upsertSession({
        ...session,
        state: "COLLECTING",
        lang,
        story_text: continuedStory,
        msg_count: continuedCount,
        last_agent_prompt: replyText,
      });

      return replyText;
    }

    const reminder = endConfirmReminderText(lang);
    await upsertSession({
      ...session,
      lang,
      last_agent_prompt: reminder,
    });
    return reminder;
  }

  if (session.state === "ASK_PRIVACY") {
    const choice = parsePrivacyChoice(msg);
    if (!choice) {
      const reminder = privacyReminderText(lang);
      await upsertSession({
        ...session,
        lang,
        last_agent_prompt: reminder,
      });
      return reminder;
    }

    const savedReply = await finalizeStory({
      user_id,
      lang,
      story_text: session.story_text,
      publish: choice === "share",
    });

    return savedReply;
  }

  if (!msg || isGreetingOnly(msg)) {
    const open = openingText(lang);
    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
    });
    return open;
  }

  if (!session.story_text && isTopicRequest(msg)) {
    const topic = randomTopic(lang);
    const reply = topicIntroText(lang, topic);

    await upsertSession({
      ...session,
      state: "COLLECTING",
      lang,
      seed_prompt: topic,
      last_agent_prompt: reply,
    });

    return reply;
  }

  if (!shouldTreatAsStory(msg) && !session.story_text) {
    const open = openingText(lang);
    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
    });
    return open;
  }

  const updatedStory = session.story_text ? `${session.story_text}\n${msg}` : msg;
  const updatedCount = Number(session.msg_count || 0) + 1;

  if (isManualFinish(msg) || lower === "save") {
    const privacyMsg = askPrivacyText(lang);
  
    await upsertSession({
      ...session,
      state: "ASK_PRIVACY",
      lang,
      story_text: session.story_text || "",
      msg_count: Number(session.msg_count || 0),
      last_agent_prompt: privacyMsg,
    });
  
    return privacyMsg;
  }

  if (
    shouldSuggestEndCheck({
      msg,
      story_text: updatedStory,
      msg_count: updatedCount,
    })
  ) {
    const confirmMsg = askEndConfirmText(lang);

    await upsertSession({
      ...session,
      state: "CONFIRM_END",
      lang,
      story_text: updatedStory,
      msg_count: updatedCount,
      last_agent_prompt: confirmMsg,
    });

    return confirmMsg;
  }

  const aiTurn = await buildStoryReply({
    lang,
    seed_prompt: session.seed_prompt || "",
    fullStory: updatedStory,
    last_agent_prompt: session.last_agent_prompt || "",
  });

  if (aiTurn?.mode === "CLOSE") {
    const confirmMsg = askEndConfirmText(lang);

    await upsertSession({
      ...session,
      state: "CONFIRM_END",
      lang,
      story_text: updatedStory,
      msg_count: updatedCount,
      last_agent_prompt: confirmMsg,
    });

    return confirmMsg;
  }

  const replyText = aiTurn?.text || fallbackQuestion(lang);

  await upsertSession({
    ...session,
    state: "COLLECTING",
    lang,
    story_text: updatedStory,
    msg_count: updatedCount,
    last_agent_prompt: replyText,
  });

  return replyText;
}

// --------------------
// WhatsApp flow
// --------------------
export async function handleMessage({ from, text }) {
  const user_id = String(from || "");
  return processTurn({
    user_id,
    text,
    forcedLang: null,
  });
}

// --------------------
// Local app / curl testing flow
// --------------------
export async function handleAppTurn({ user_id, text, lang }) {
  const reply = await processTurn({
    user_id: String(user_id || ""),
    text: String(text || ""),
    forcedLang: lang || null,
  });

  const session = await loadSession(String(user_id || ""));

  return {
    screen: "BUILD",
    story_so_far: session?.story_text || "",
    agent_prompt: reply,
    seed_prompt: session?.seed_prompt || "",
  };
}