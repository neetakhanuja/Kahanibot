// src/conversation.js

import fs from "fs";
import path from "path";

import { getSheetsClient, readRange } from "./sheets.js";
import { generateListenerTurn } from "./ai.js";

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
  });
}

async function buildListenerReply({
  lang,
  seed_prompt,
  fullConversation,
  msg_count,
  last_bot_reply,
  last_bot_mode,
}) {
  const promptPrefix = seed_prompt ? `Today's prompt: ${seed_prompt}\n\n` : "";
  const recentConversation = lastTurns(fullConversation, 10);

  return generateListenerTurn({
    lang,
    conversation_text: `${promptPrefix}${recentConversation}`,
    msg_count: Number(msg_count || 0),
    last_bot_reply: last_bot_reply || "",
    last_bot_mode: last_bot_mode || "none",
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
    });
    return stoppedText(lang);
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
    });

    return open;
  }

  if (session.state === "STOPPED") {
    return "";
  }

  if (!msg || isGreetingOnly(msg)) {
    const open = openingText(lang);

    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
      last_bot_mode: "ACKNOWLEDGMENT",
    });

    return open;
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
    });

    return reply;
  }

  if (!shouldTreatAsMemory(msg)) {
    const open = openingText(lang);

    await upsertSession({
      ...session,
      state: "READY",
      lang,
      last_agent_prompt: open,
      last_bot_mode: "ACKNOWLEDGMENT",
    });

    return open;
  }

  const withUserTurn = appendTurn(session.story_text, "User", msg);
  const updatedCount = Number(session.msg_count || 0) + 1;

  const aiTurn = await buildListenerReply({
    lang,
    seed_prompt: session.seed_prompt || "",
    fullConversation: withUserTurn,
    msg_count: updatedCount,
    last_bot_reply: session.last_agent_prompt || "",
    last_bot_mode: session.last_bot_mode || "none",
  });

  const replyText = aiTurn?.text || "";
  const nextMode = aiTurn?.mode || "ACKNOWLEDGMENT";
  const withBotTurn = appendTurn(withUserTurn, "Bot", replyText);

  await upsertSession({
    ...session,
    state: "LISTENING",
    lang,
    story_text: withBotTurn,
    msg_count: updatedCount,
    last_agent_prompt: replyText,
    last_bot_mode: nextMode,
  });

  return replyText;
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