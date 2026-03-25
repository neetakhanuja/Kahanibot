// src/conversation.js

import fs from "fs";
import path from "path";

import { getSheetsClient, readRange } from "./sheets.js";
import { generateListenerTurn } from "./ai.js";
import { saveStory } from "./storyStore.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SESSIONS_TAB = "sessions";
const STORY_BASE_URL =
  process.env.STORY_BASE_URL ||
  process.env.APP_BASE_URL ||
  "";

console.log("[BOOT] conversation.js loaded");

function isoNow() {
  return new Date().toISOString();
}

function headerIndex(headers, name) {
  return (headers || []).findIndex(
    (h) =>
      String(h || "").trim().toLowerCase() ===
      String(name || "").trim().toLowerCase()
  );
}

function normalizeText(s) {
  return String(s || "").trim();
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isEmojiOnly(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const stripped = t.replace(/[\p{Extended_Pictographic}\s]/gu, "");
  return stripped.length === 0;
}

function isClosureSignal(text) {
  const t = String(text || "").trim().toLowerCase();

  if (!t) return false;
  if (isEmojiOnly(t)) return true;

  const exact = [
    "ok",
    "okay",
    "haan",
    "ha",
    "hmm",
    "hm",
    "yes",
    "true",
    "right",
    "thanks",
    "thank you",
    "good",
    "nice",
    "done",
    "bas",
    "theek",
    "thik",
    "achha",
    "accha",
    "bye",
    "👍",
    "🙏",
    "🙂",
    "😊",
    "हाँ",
    "हां",
    "ठीक",
    "अच्छा",
    "धन्यवाद",
    "બરાબર",
    "સારું",
    "હા",
    "આભાર",
    "સાચી વાત",
    "સાચી વાત છે",
    "હા, સાચી વાત છે",
    "haha",
    "lol",
  ];

  if (exact.includes(t)) return true;
  if (wordCount(t) <= 2) return true;

  return false;
}

function isLikelyFullStory(text) {
  const t = String(text || "").trim();
  const wc = wordCount(t);

  if (!t) return false;
  if (wc >= 30) return true;
  if (wc >= 22 && /[,.!?।]/.test(t)) return true;
  if (
    wc >= 20 &&
    /\b(when|while|after|before|then|used to|remember|once|during|school|childhood|festival|grandmother|grandfather|mother|father)\b/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
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

function openingText(lang) {
  if (lang === "hi") {
    return (
      "नमस्ते.\n" +
      "मैं आपकी बात सुनने के लिए यहाँ हूँ.\n" +
      "अगर आज के कार्ड या किसी याद से कुछ मन में आया हो, तो आप मुझे बता सकते हैं."
    );
  }

  if (lang === "gu") {
    return (
      "નમસ્તે.\n" +
      "હું તમારી વાત સાંભળવા માટે અહીં છું.\n" +
      "જો આજના કાર્ડ અથવા કોઈ યાદથી કંઈ મનમાં આવ્યું હોય, તો તમે મને કહી શકો."
    );
  }

  return (
    "Hello.\n" +
    "I'm here to listen.\n" +
    "If today's card or a memory brought something to mind, you can tell me."
  );
}

function stoppedText(lang) {
  if (lang === "hi") return "ठीक है. जब भी फिर से बात करनी हो, START लिखें।";
  if (lang === "gu") return "બરાબર. જ્યારે ફરી વાત કરવી હોય, START લખો.";
  return "Okay. Write START anytime if you would like to continue.";
}

function gentleClosingText(lang) {
  if (lang === "hi") return "यह याद सुनकर अच्छा लगा।";
  if (lang === "gu") return "આ યાદ સાંભળીને સારું લાગ્યું.";
  return "It was lovely hearing this memory.";
}

function storyLinkIntroText(lang) {
  if (lang === "hi") return "यह आपकी कहानी का लिंक है:";
  if (lang === "gu") return "આ તમારી વાર્તાનો લિંક છે:";
  return "Here is your story link:";
}

function shouldTreatAsMemory(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isGreetingOnly(t)) return false;
  return true;
}

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
  if (!cards.length) {
    if (lang === "hi") return "आज कौन-सी याद मन में आई?";
    if (lang === "gu") return "આજે કઈ યાદ મનમાં આવી?";
    return "What memory came to mind today?";
  }

  const c = cards[Math.floor(Math.random() * cards.length)];
  return String(c?.[lang] || c?.en || c?.hi || c?.gu || "").trim();
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

function topicIntroText(lang, topic) {
  if (lang === "hi") return `आज के लिए एक छोटा-सा संकेत:\n${topic}`;
  if (lang === "gu") return `આજ માટે એક નાનો સંકેત:\n${topic}`;
  return `Here is a small prompt for today:\n${topic}`;
}

function appendTurn(history, speaker, text) {
  const clean = String(text || "").trim();
  if (!clean) return history || "";
  return history ? `${history}\n${speaker}: ${clean}` : `${speaker}: ${clean}`;
}

function lastTurns(history, maxLines = 10) {
  const lines = String(history || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return lines.slice(-maxLines).join("\n");
}

function normalizeMinimal(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUserOnlyStory(history) {
  const lines = String(history || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const filler = new Set([
    "હા",
    "હું",
    "બરાબર",
    "સારું",
    "સાચી વાત",
    "સાચી વાત છે",
    "ok",
    "okay",
    "yes",
    "hmm",
    "hm",
    "haha",
    "lol",
    "right",
    "true",
  ]);

  const seen = new Set();

  const userLines = lines
    .filter((line) => line.startsWith("User:"))
    .map((line) => line.replace(/^User:\s*/, "").trim())
    .filter((text) => {
      if (!text) return false;

      const normalized = normalizeMinimal(text);

      if (!normalized) return false;
      if (filler.has(normalized)) return false;
      if (normalized.length < 4) return false;
      if (seen.has(normalized)) return false;

      seen.add(normalized);
      return true;
    });

  return userLines.join("\n\n").trim();
}

function firstMeaningfulLine(storyText) {
  const parts = String(storyText || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  return parts[0] || "";
}

async function maybeSaveStoryAndBuildLink({ user_id, story_text }) {
  const cleanStory = String(story_text || "").trim();
  if (!cleanStory) return "";

  const title = firstMeaningfulLine(cleanStory).slice(0, 80);

  try {
    const saved = await saveStory({
      user_id,
      story_text: cleanStory,
      transcript_text: cleanStory,
      polished_story_text: cleanStory,
      publish: false,
      privacy: "private",
      title,
    });

    if (!saved?.id) return "";
    if (!STORY_BASE_URL) return "";

    return `${STORY_BASE_URL}/${saved.id}`;
  } catch (err) {
    console.error("[STORY SAVE ERROR]", err);
    return "";
  }
}

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
  const idxLastQType = headerIndex(headers, "last_question_type");
  const idxLastBotMode = headerIndex(headers, "last_bot_mode");
  const idxQuestionStreak = headerIndex(headers, "question_streak");
  const idxTurnsSinceQuestion = headerIndex(headers, "turns_since_question");
  const idxBotTurnsAfterStory = headerIndex(headers, "bot_turns_after_story");
  const idxStoryWindowOpen = headerIndex(headers, "story_window_open");

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
        last_question_type: idxLastQType === -1 ? "none" : row[idxLastQType] || "none",
        last_bot_mode: idxLastBotMode === -1 ? "none" : row[idxLastBotMode] || "none",
        question_streak: idxQuestionStreak === -1 ? 0 : Number(row[idxQuestionStreak] || 0),
        turns_since_question:
          idxTurnsSinceQuestion === -1 ? 99 : Number(row[idxTurnsSinceQuestion] || 99),
        bot_turns_after_story:
          idxBotTurnsAfterStory === -1 ? 0 : Number(row[idxBotTurnsAfterStory] || 0),
        story_window_open:
          idxStoryWindowOpen === -1
            ? false
            : String(row[idxStoryWindowOpen] || "").toLowerCase() === "true",
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
  const idxLastQType = headerIndex(headers, "last_question_type");
  const idxLastBotMode = headerIndex(headers, "last_bot_mode");
  const idxQuestionStreak = headerIndex(headers, "question_streak");
  const idxTurnsSinceQuestion = headerIndex(headers, "turns_since_question");
  const idxBotTurnsAfterStory = headerIndex(headers, "bot_turns_after_story");
  const idxStoryWindowOpen = headerIndex(headers, "story_window_open");
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
  if (idxLastQType !== -1) outRow[idxLastQType] = session.last_question_type || "none";
  if (idxLastBotMode !== -1) outRow[idxLastBotMode] = session.last_bot_mode || "none";
  if (idxQuestionStreak !== -1) outRow[idxQuestionStreak] = String(session.question_streak || 0);
  if (idxTurnsSinceQuestion !== -1)
    outRow[idxTurnsSinceQuestion] = String(session.turns_since_question ?? 99);
  if (idxBotTurnsAfterStory !== -1)
    outRow[idxBotTurnsAfterStory] = String(session.bot_turns_after_story || 0);
  if (idxStoryWindowOpen !== -1)
    outRow[idxStoryWindowOpen] = String(Boolean(session.story_window_open));

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
    last_question_type: "none",
    last_bot_mode: "none",
    question_streak: 0,
    turns_since_question: 99,
    bot_turns_after_story: 0,
    story_window_open: false,
  });
}

async function buildListenerReply({
  lang,
  seed_prompt,
  fullConversation,
  msg_count,
  last_bot_reply,
  last_bot_mode,
  question_streak,
  turns_since_question,
}) {
  const promptPrefix = seed_prompt ? `Today's prompt: ${seed_prompt}\n\n` : "";
  const recentConversation = lastTurns(fullConversation, 10);

  return generateListenerTurn({
    lang,
    conversation_text: `${promptPrefix}${recentConversation}`,
    msg_count: Number(msg_count || 0),
    last_bot_reply: last_bot_reply || "",
    last_bot_mode: last_bot_mode || "none",
    question_streak: Number(question_streak || 0),
    turns_since_question: Number(turns_since_question ?? 99),
  });
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
      last_question_type: "none",
      last_bot_mode: "none",
      question_streak: 0,
      turns_since_question: 99,
      bot_turns_after_story: 0,
      story_window_open: false,
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
      last_bot_mode: "GENTLE_CLOSURE",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });
    return { text: stoppedText(lang) };
  }

  if (lower === "start" || lower === "reset") {
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
      last_question_type: "none",
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: 99,
      bot_turns_after_story: 0,
      story_window_open: false,
    });

    return { text: open };
  }

  if (session.state === "STOPPED") {
    return { text: "" };
  }

  if (!msg || isGreetingOnly(msg)) {
    const open = openingText(lang);

    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });

    return { text: open };
  }

  if (isTopicRequest(msg)) {
    const topic = randomTopic(lang);
    const reply = topicIntroText(lang, topic);

    await upsertSession({
      ...session,
      state: "LISTENING",
      lang,
      seed_prompt: topic,
      last_agent_prompt: reply,
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });

    return { text: reply };
  }

  if (!shouldTreatAsMemory(msg)) {
    const open = openingText(lang);

    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });

    return { text: open };
  }

  let storyWindowOpen = Boolean(session.story_window_open);
  let botTurnsAfterStory = Number(session.bot_turns_after_story || 0);

  if (isLikelyFullStory(msg)) {
    storyWindowOpen = true;
    botTurnsAfterStory = 0;

    session = {
      ...session,
      story_text: "",
      msg_count: 0,
      question_streak: 0,
      turns_since_question: 99,
    };
  }

  const withUserTurn = appendTurn(session.story_text, "User", msg);
  const updatedCount = Number(session.msg_count || 0) + 1;

  // Close automatically after 3 bot prompts inside an active story window.
  // This no longer depends on the user sending a short "ok/ha/emoji" message.
  // Flow becomes:
  // user story -> bot 1 -> user -> bot 2 -> user -> bot 3 -> user -> closure + emoji + link
  if (
    storyWindowOpen &&
    (botTurnsAfterStory >= 3 || (isClosureSignal(msg) && botTurnsAfterStory >= 2))
  ) {
    const userOnlyStory = extractUserOnlyStory(withUserTurn);
    const storyUrl = await maybeSaveStoryAndBuildLink({
      user_id,
      story_text: userOnlyStory,
    });

    const closingLine = gentleClosingText(lang);
    const emoji = "🙂";
    const linkLine = storyUrl ? `${storyLinkIntroText(lang)}\n${storyUrl}` : "";

    const combinedForLog = [closingLine, emoji, linkLine].filter(Boolean).join("\n\n");
    const withBotTurn = appendTurn(withUserTurn, "Bot", combinedForLog);

    await upsertSession({
      ...session,
      state: "READY",
      lang,
      story_text: withBotTurn,
      msg_count: updatedCount,
      last_agent_prompt: combinedForLog,
      last_bot_mode: "GENTLE_CLOSURE",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });

    return {
      text: closingLine,
      extra_messages: [emoji, ...(linkLine ? [linkLine] : [])],
    };
  }

  const aiTurn = await buildListenerReply({
    lang,
    seed_prompt: session.seed_prompt || "",
    fullConversation: withUserTurn,
    msg_count: updatedCount,
    last_bot_reply: session.last_agent_prompt || "",
    last_bot_mode: session.last_bot_mode || "none",
    question_streak: Number(session.question_streak || 0),
    turns_since_question: Number(session.turns_since_question ?? 99),
  });

  let replyText = aiTurn?.text || "";
  let nextMode = aiTurn?.mode || "ACKNOWLEDGMENT";
  let withBotTurn = appendTurn(withUserTurn, "Bot", replyText);

  const nextQuestionStreak =
    nextMode === "ASK" ? Number(session.question_streak || 0) + 1 : 0;
  const nextTurnsSinceQuestion =
    nextMode === "ASK" ? 0 : Number(session.turns_since_question ?? 99) + 1;

  const nextBotTurnsAfterStory = storyWindowOpen ? botTurnsAfterStory + 1 : 0;

  await upsertSession({
    ...session,
    state: "LISTENING",
    lang,
    story_text: withBotTurn,
    msg_count: updatedCount,
    last_agent_prompt: replyText,
    last_bot_mode: nextMode,
    question_streak: nextQuestionStreak,
    turns_since_question: nextTurnsSinceQuestion,
    bot_turns_after_story: nextBotTurnsAfterStory,
    story_window_open: storyWindowOpen,
  });

  return { text: replyText };
}

export async function handleMessage({ from, text }) {
  const user_id = String(from || "");
  return processTurn({
    user_id,
    text,
    forcedLang: null,
  });
}

export async function handleAppTurn({ user_id, text, lang }) {
  const out = await processTurn({
    user_id: String(user_id || ""),
    text: String(text || ""),
    forcedLang: lang || null,
  });

  const session = await loadSession(String(user_id || ""));

  return {
    screen: "BUILD",
    story_so_far: session?.story_text || "",
    agent_prompt: out?.text || "",
    seed_prompt: session?.seed_prompt || "",
  };
}