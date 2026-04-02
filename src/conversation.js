// src/conversation.js

import fs from "fs";
import path from "path";

import { getSheetsClient, readRange } from "./sheets.js";
import { generateListenerTurn } from "./ai.js";
import { saveStory } from "./storyStore.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SESSIONS_TAB = "sessions";

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

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function explicitLanguageChoice(text) {
  const t = String(text || "").trim().toLowerCase();

  if (
    t === "gujarati" ||
    t === "gu" ||
    t === "language: gujarati" ||
    t === "language gujarati" ||
    t.includes("speak gujarati") ||
    t.includes("in gujarati")
  ) {
    return "gu";
  }

  if (
    t === "hindi" ||
    t === "hi" ||
    t === "language: hindi" ||
    t === "language hindi" ||
    t.includes("speak hindi") ||
    t.includes("in hindi")
  ) {
    return "hi";
  }

  if (
    t === "english" ||
    t === "en" ||
    t === "language: english" ||
    t === "language english" ||
    t.includes("speak english") ||
    t.includes("in english")
  ) {
    return "en";
  }

  return null;
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
    "that's all",
    "that is all",
    "just that",
    "बस",
    "बस इतना ही",
    "यही याद है",
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
    "બસ",
    "બસ એટલું જ",
    "હવે એટલું જ",
    "story end",
    "the end",
  ];

  if (exact.includes(t)) return true;
  if (wordCount(t) <= 2) return true;

  const patterns = [
    /\bthat's all\b/i,
    /\bthat is all\b/i,
    /\bjust that\b/i,
    /\bबस इतना ही\b/i,
    /\bयही याद है\b/i,
    /\bબસ એટલું જ\b/i,
    /\bહવે એટલું જ\b/i,
    /\bstory end\b/i,
  ];

  return patterns.some((rx) => rx.test(t));
}

function isLinkRequest(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;

  const phrases = [
    "send link",
    "story link",
    "send the link",
    "share the link",
    "link please",
    "my story link",
    "link aapo",
    "link apo",
    "લિંક આપો",
    "લિંક મોકલો",
    "વાર્તાની લિંક",
    "कहानी का लिंक",
    "लिंक भेजो",
    "लिंक भेजिए",
  ];

  return phrases.some((p) => t.includes(p));
}

function isLikelyFullStory(text) {
  const t = String(text || "").trim();
  const wc = wordCount(t);

  if (!t) return false;
  if (wc >= 25) return true;
  if (wc >= 18 && /[,.!?।]/.test(t)) return true;
  if (
    wc >= 16 &&
    /\b(when|while|after|before|then|used to|remember|once|during|school|childhood|festival|grandmother|grandfather|mother|father)\b/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
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
      "अगर आप चाहें, तो अपनी कोई याद मुझसे साझा कर सकते हैं."
    );
  }

  if (lang === "gu") {
    return (
      "નમસ્તે.\n" +
      "હું તમારી વાત સાંભળવા માટે અહીં છું.\n" +
      "જો તમે ઇચ્છો, તો તમારી કોઈ યાદ મારી સાથે શેર કરી શકો."
    );
  }

  return (
    "Hello.\n" +
    "I'm here to listen.\n" +
    "If you would like, you can share a memory with me."
  );
}

function stoppedText(lang) {
  if (lang === "hi") return "ठीक है. जब भी फिर से बात करनी हो, START लिखें।";
  if (lang === "gu") return "બરાબર. જ્યારે ફરી વાત કરવી હોય, START લખો.";
  return "Okay. Write START anytime if you would like to continue.";
}

function finalClosingText(lang) {
  if (lang === "hi") return "अपनी कहानी साझा करने के लिए धन्यवाद।";
  if (lang === "gu") return "તમારી વાર્તા શેર કરવા બદલ આભાર.";
  return "Thank you for sharing your story.";
}

function linkMessageText(lang, url) {
  if (lang === "hi") return `आपकी कहानियाँ यहाँ हैं:\n${url}`;
  if (lang === "gu") return `તમારી વાર્તાઓ અહીં છે:\n${url}`;
  return `Your stories are here:\n${url}`;
}

function shouldTreatAsMemory(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isGreetingOnly(t)) return false;
  if (explicitLanguageChoice(t)) return false;
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

function isMeaningfulStoryLine(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isClosureSignal(t)) return false;
  if (isEmojiOnly(t)) return false;
  if (wordCount(t) <= 2) return false;
  return true;
}

function extractUserStoryFromTranscript(history) {
  const lines = String(history || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const userParts = [];
  const seenNormalized = new Set();

  for (const line of lines) {
    if (!line.startsWith("User:")) continue;

    const text = line.replace(/^User:\s*/, "").trim();
    if (!isMeaningfulStoryLine(text)) continue;

    const normalized = normalizeForCompare(text);
    if (!normalized) continue;
    if (seenNormalized.has(normalized)) continue;

    seenNormalized.add(normalized);
    userParts.push(text);
  }

  return userParts.join("\n\n").trim();
}

function hasEnoughStoryContent(history) {
  const story = extractUserStoryFromTranscript(history);
  if (!story) return false;

  const parts = story
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  const totalWords = wordCount(story);

  if (totalWords >= 18) return true;
  if (parts.length >= 2 && totalWords >= 10) return true;

  return false;
}

function buildArchiveUrl(userId) {
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (publicBase) {
    return `${publicBase}/u/${encodeURIComponent(String(userId || "").trim())}`;
  }

  const storyBase = String(process.env.STORY_BASE_URL || "").replace(/\/+$/, "");
  if (!storyBase) return "";

  const archiveBase = storyBase.replace(/\/story$/i, "/u");
  return `${archiveBase}/${encodeURIComponent(String(userId || "").trim())}`;
}

async function finalizeStory({ session, lang, user_id, withUserTurn }) {
  const cleanedStory = extractUserStoryFromTranscript(withUserTurn);
  const closureMessage = finalClosingText(lang);

  if (cleanedStory) {
    await saveStory({
      user_id,
      story_text: cleanedStory,
      polished_story_text: cleanedStory,
      transcript_text: withUserTurn,
      publish: true,
      privacy: "share",
      title: "My stories",
    });
  }

  const archiveUrl = buildArchiveUrl(user_id);
  const linkMessage = archiveUrl ? linkMessageText(lang, archiveUrl) : "";

  await upsertSession({
    ...session,
    state: "READY",
    lang,
    story_id: "",
    story_text: "",
    msg_count: Number(session.msg_count || 0) + 1,
    last_agent_prompt: closureMessage,
    last_bot_mode: "GENTLE_CLOSURE",
    question_streak: 0,
    turns_since_question: Number(session.turns_since_question ?? 99) + 1,
    bot_turns_after_story: 0,
    story_window_open: false,
  });

  return {
    text: closureMessage,
    messages: [closureMessage, linkMessage].filter(Boolean),
  };
}

function toMessageResult(messages) {
  const cleanMessages = (messages || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  return {
    text: cleanMessages[0] || "",
    messages: cleanMessages,
  };
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
      lang: forcedLang || "en",
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: "",
      last_bot_mode: "none",
      question_streak: 0,
      turns_since_question: 99,
      bot_turns_after_story: 0,
      story_window_open: false,
    };

    await upsertSession(session);
  }

  let lang = forcedLang || session.lang || "en";
  const explicitLang = explicitLanguageChoice(msg);
  if (explicitLang) {
    lang = explicitLang;
  }

  const lower = msg.toLowerCase();

  if (explicitLang) {
    const open = openingText(explicitLang);

    await upsertSession({
      ...session,
      state: "READY",
      lang: explicitLang,
      last_agent_prompt: open,
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      bot_turns_after_story: 0,
      story_window_open: false,
    });

    return toMessageResult([open]);
  }

  if (lower === "stop") {
    const reply = stoppedText(lang);

    await upsertSession({
      ...session,
      state: "STOPPED",
      lang,
      last_agent_prompt: reply,
      last_bot_mode: "GENTLE_CLOSURE",
      question_streak: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
      story_window_open: false,
      bot_turns_after_story: 0,
    });

    return toMessageResult([reply]);
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
      last_bot_mode: "ACKNOWLEDGMENT",
      question_streak: 0,
      turns_since_question: 99,
      bot_turns_after_story: 0,
      story_window_open: false,
    });

    return toMessageResult([open]);
  }

  if (session.state === "STOPPED") {
    return toMessageResult([]);
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

    return toMessageResult([open]);
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

    return toMessageResult([reply]);
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

    return toMessageResult([open]);
  }

  let storyWindowOpen = Boolean(session.story_window_open);
  let botTurnsAfterStory = Number(session.bot_turns_after_story || 0);

  const withUserTurn = appendTurn(session.story_text, "User", msg);
  const enoughStoryContent = hasEnoughStoryContent(withUserTurn);

  if (isLikelyFullStory(msg) || enoughStoryContent) {
    storyWindowOpen = true;
  }

  if (storyWindowOpen && session.last_bot_mode === "GENTLE_CLOSURE" && isClosureSignal(msg)) {
    await upsertSession({
      ...session,
      state: "READY",
      lang,
      story_text: "",
      story_id: "",
      story_window_open: false,
      bot_turns_after_story: 0,
      turns_since_question: Number(session.turns_since_question ?? 99) + 1,
    });
    return toMessageResult([]);
  }

  if (
    shouldFinalizeOnUserClosure({
      storyWindowOpen,
      enoughStoryContent,
      botTurnsAfterStory,
      lastBotMode: session.last_bot_mode,
      msg,
    })
  ) {
    return finalizeStory({
      session,
      lang,
      user_id,
      withUserTurn,
    });
  }

  // Hard cap: no more than 2 bot responses after story begins
  if (storyWindowOpen && botTurnsAfterStory >= 2) {
    return finalizeStory({
      session,
      lang,
      user_id,
      withUserTurn,
    });
  }

  const updatedCount = Number(session.msg_count || 0) + 1;

  let aiTurn = await buildListenerReply({
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

  // Enforce max 1 question total
  if (
    nextMode === "ASK" &&
    Number(session.question_streak || 0) >= 1
  ) {
    replyText =
      lang === "hi"
        ? "आपकी बात सुनकर अच्छा लगा।"
        : lang === "gu"
        ? "તમારી વાત સાંભળીને સારું લાગ્યું."
        : "It was good to hear this.";
    nextMode = "ACKNOWLEDGMENT";
  }

  // Enforce 2nd bot response to be reflection only
  if (storyWindowOpen && botTurnsAfterStory >= 1) {
    if (/\?/.test(replyText)) {
      replyText =
        lang === "hi"
          ? "यह याद बहुत सजीव लगती है।"
          : lang === "gu"
          ? "આ યાદ ખૂબ જીવંત લાગે છે."
          : "This memory feels very vivid.";
      nextMode = "ACKNOWLEDGMENT";
    }
  }

  const withBotTurn = appendTurn(withUserTurn, "Bot", replyText);

  const nextQuestionStreak =
    nextMode === "ASK" ? Number(session.question_streak || 0) + 1 : Number(session.question_streak || 0);
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

  return toMessageResult([replyText]);
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
  const result = await processTurn({
    user_id: String(user_id || ""),
    text: String(text || ""),
    forcedLang: lang || null,
  });

  const session = await loadSession(String(user_id || ""));

  return {
    screen: "BUILD",
    story_so_far: session?.story_text || "",
    agent_prompt: result?.text || "",
    extra_messages: result?.messages?.slice(1) || [],
    seed_prompt: session?.seed_prompt || "",
  };
}