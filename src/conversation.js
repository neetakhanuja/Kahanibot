// src/conversation.js

import fs from "fs";
import path from "path";

import { getSheetsClient, readRange } from "./sheets.js";
import { saveStory } from "./storyStore.js";
import { makeDraft, normalizeYesNo } from "./storyEngine.js";
import { logEvent } from "./logger.js";
import { generateReflectionAndQuestion, polishStory } from "./ai.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SESSIONS_TAB = "sessions";

console.log("[BOOT] conversation.js loaded");

// --------------------
// Helpers
// --------------------
function isoNow() {
  return new Date().toISOString();
}

function normalizeLangChoice(msg) {
  const t = String(msg || "").trim().toLowerCase();
  if (t === "1" || t === "hindi" || t === "hi" || t === "हिंदी") return "hi";
  if (t === "2" || t === "gujarati" || t === "gu" || t === "ગુજરાતી") return "gu";
  if (t === "3" || t === "english" || t === "en") return "en";
  return null;
}

function getText(lang, key, vars = {}) {
  const L = lang || "en";

  const strings = {
    en: {
      consent:
        "Before we begin: This helps shape personal stories. Your messages may be saved for the study. Reply OK to continue. Reply STOP anytime.",
      chooseLang:
        "Choose your language (reply with 1/2/3):\n1) Hindi\n2) Gujarati\n3) English",

      startCollecting:
        "Okay. Please share your story. Speak or type freely. When you are finished, type DONE.",
      added: "Thank you. Go on. (Type DONE when finished.)",

      draftIntro: "Here is your draft:",
      saveAsk: "Save this story? Reply YES to save or NO to rewrite.",
      rewrite: "Okay. Please share your story again. Type DONE when finished.",

      published: `Saved. View your stories here: /u/${vars.user_id || ""}`,

      stopped: "You have opted out. Send START anytime to resume.",
      resetDone: "Reset done.",
      help:
        "Commands: HELP, RESET, STOP, START\n\nHow it works:\n• Share your story\n• Type DONE\n• Save YES or rewrite NO",
      langSet: "Okay. I will continue in your chosen language.",
    },

    hi: {
      consent:
        "शुरू करने से पहले: यह आपकी कहानियों को गढ़ने में मदद करता है। अध्ययन के लिए संदेश सेव हो सकते हैं। आगे बढ़ने के लिए OK लिखें। कभी भी STOP लिख सकते हैं।",
      chooseLang: "भाषा चुनें (1/2/3):\n1) हिंदी\n2) गुजराती\n3) English",

      startCollecting:
        "ठीक है। अपनी कहानी साझा करें। आप बोल सकते हैं या लिख सकते हैं। जब पूरा हो जाए तो DONE लिखें।",
      added: "धन्यवाद। आगे बताइए। (पूरा होने पर DONE लिखें।)",

      draftIntro: "यह आपका ड्राफ्ट है:",
      saveAsk: "इसे सेव करें? सेव के लिए YES, दोबारा लिखने के लिए NO।",
      rewrite: "ठीक है। कृपया कहानी फिर से बताइए। पूरा होने पर DONE लिखें।",

      published: `सेव हो गया। आपकी कहानियाँ: /u/${vars.user_id || ""}`,

      stopped: "आपने रोक दिया है। फिर से शुरू करने के लिए START लिखें।",
      resetDone: "रीसेट हो गया।",
      help:
        "कमांड: HELP, RESET, STOP, START\n\nकैसे काम करता है:\n• कहानी बताइए\n• DONE लिखिए\n• सेव के लिए YES, बदलने के लिए NO",
      langSet: "ठीक है। मैं आपकी चुनी भाषा में जारी रखूँगा/रखूँगी।",
    },

    gu: {
      consent:
        "શરૂ કરતા પહેલા: આ તમારી વાર્તા ગોઠવવામાં મદદ કરે છે. અભ્યાસ માટે સંદેશાઓ સેવ થઈ શકે છે. આગળ વધવા OK લખો. ક્યારે પણ STOP લખી શકો.",
      chooseLang: "ભાષા પસંદ કરો (1/2/3):\n1) Hindi\n2) Gujarati\n3) English",

      startCollecting:
        "બરાબર. તમારી વાર્તા શેર કરો. તમે બોલી શકો અથવા લખી શકો. પૂરું થાય ત્યારે DONE લખો.",
      added: "આભાર. આગળ કહો. (પૂરું થાય ત્યારે DONE લખો.)",

      draftIntro: "આ રહ્યો તમારો ડ્રાફ્ટ:",
      saveAsk: "સેવ કરવું છે? સેવ માટે YES, ફરી લખવા NO.",
      rewrite: "બરાબર. કૃપા કરીને વાર્તા ફરી કહો. પૂરું થાય ત્યારે DONE લખો.",

      published: `સેવ થઈ ગયું. તમારી વાર્તાઓ: /u/${vars.user_id || ""}`,

      stopped: "તમે રોકી દીધું છે. ફરી શરૂ કરવા START લખો.",
      resetDone: "રીસેટ થઈ ગયું.",
      help:
        "કમાન્ડ: HELP, RESET, STOP, START\n\nકેવી રીતે કામ કરે છે:\n• વાર્તા કહો\n• DONE લખો\n• સેવ માટે YES, બદલવા NO",
      langSet: "બરાબર. હું તમારી પસંદ કરેલી ભાષામાં ચાલુ રાખીશ.",
    },
  };

  return strings[L]?.[key] || strings.en[key] || "";
}

function headerIndex(headers, name) {
  const idx = (headers || []).findIndex(
    (h) => String(h || "").trim().toLowerCase() === String(name || "").trim().toLowerCase()
  );
  return idx;
}

function isDone(msg) {
  const t = String(msg || "").trim().toLowerCase();
  return t === "done" || t === "finish" || t === "end";
}

// --------------------
// MANAN deck (cards/manan_cards.json)
// --------------------
let MANAN_CACHE = null;

function loadMananCards() {
  if (MANAN_CACHE) return MANAN_CACHE;

  const filePath = path.join(process.cwd(), "cards", "manan_cards.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(raw);

  MANAN_CACHE = (arr || [])
    .map((c) => (c && (c.en || c.hi || c.gu) ? c : null))
    .filter(Boolean);

  return MANAN_CACHE;
}

function randomTopic(lang = "en") {
  const cards = loadMananCards();
  if (!cards.length) return "A turning point";

  const c = cards[Math.floor(Math.random() * cards.length)];
  return String(c?.[lang] || c?.en || c?.hi || c?.gu || "A turning point").trim();
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
        state: row[idxState] || "",
        story_text: row[idxStory] || "",
        story_id: row[idxStoryId] || "",
        consent: String(row[idxConsent] || "").toLowerCase() === "true",
        lang: row[idxLang] || "",
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
  outRow[idxState] = session.state || "";
  outRow[idxStory] = session.story_text || "";
  outRow[idxStoryId] = session.story_id || "";
  outRow[idxConsent] = String(!!session.consent);
  outRow[idxLang] = session.lang || "";
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

// --------------------
// WhatsApp-style engine (existing)
// --------------------
async function resetToCollecting(user_id, lang) {
  await upsertSession({
    user_id,
    state: "COLLECTING",
    story_text: "",
    story_id: "",
    consent: true,
    lang: lang || "en",
    msg_count: 0,
    seed_prompt: "",
    last_agent_prompt: "",
  });
}

export async function handleMessage({ from, text }) {
  const user_id = String(from || "");
  const msg = String(text || "").trim();
  const lower = msg.toLowerCase();

  let session = await loadSession(user_id);
  if (!session) {
    await upsertSession({
      user_id,
      state: "CONSENT",
      story_text: "",
      story_id: "",
      consent: false,
      lang: "",
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: "",
    });
    return getText("en", "consent");
  }

  const lang = session.lang || "en";
  const yn = normalizeYesNo(msg);

  if (session.state === "STOPPED") return "";

  // Consent flow
  if (!session.consent || session.state === "CONSENT") {
    if (lower === "ok") {
      const hasLangColumn = session.headers
        ? headerIndex(session.headers, "lang") !== -1
        : false;

      const nextState = hasLangColumn && !session.lang ? "ASK_LANG" : "COLLECTING";

      await upsertSession({
        user_id,
        state: nextState,
        story_text: "",
        story_id: "",
        consent: true,
        lang: session.lang || "",
        msg_count: 0,
        seed_prompt: "",
        last_agent_prompt: "",
      });

      if (nextState === "ASK_LANG") return getText("en", "chooseLang");
      return getText(lang, "startCollecting");
    }

    return getText(lang, "consent");
  }

  // ASK_LANG
  if (session.state === "ASK_LANG") {
    const chosen = normalizeLangChoice(msg);
    if (!chosen) return getText("en", "chooseLang");

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: "",
      story_id: "",
      consent: true,
      lang: chosen,
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: "",
    });

    return `${getText(chosen, "langSet")}\n${getText(chosen, "startCollecting")}`;
  }

  // RESET
  if (lower === "reset") {
    await resetToCollecting(user_id, session.lang || "en");
    return getText(lang, "resetDone");
  }

  // COLLECTING
  if (session.state === "COLLECTING") {
    if (lower === "done") {
      let aiBlock = "";
      const aiResult = await generateReflectionAndQuestion({
        lang: session.lang || "en",
        story_text: session.story_text,
      });
      if (aiResult?.combined) aiBlock = `${aiResult.combined}\n\n`;

      const draft = makeDraft(session.story_text);

      await upsertSession({
        user_id,
        state: "REVIEW",
        story_text: session.story_text,
        story_id: "",
        consent: true,
        lang: session.lang || "",
        msg_count: 0,
        seed_prompt: "",
        last_agent_prompt: "",
      });

      return (
        `${aiBlock}${getText(lang, "draftIntro")}\n\n` +
        `Title: ${draft.title}\n\n` +
        `${draft.body}\n\n` +
        `${getText(lang, "saveAsk")}`
      );
    }

    const updatedText = session.story_text ? session.story_text + "\n" + msg : msg;

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: updatedText,
      story_id: "",
      consent: true,
      lang: session.lang || "",
      msg_count: (session.msg_count || 0) + 1,
      seed_prompt: "",
      last_agent_prompt: "",
    });

    return getText(lang, "added");
  }

  // REVIEW
  if (session.state === "REVIEW") {
    if (yn === "YES") {
      const saved = await saveStory({
        user_id,
        story_text: session.story_text,
        publish: true,
      });

      await logEvent({ user_id, event: "story_saved", details: saved.id });
      await resetToCollecting(user_id, session.lang || "en");
      return getText(lang, "published", { user_id });
    }

    if (yn === "NO") {
      await resetToCollecting(user_id, session.lang || "en");
      return getText(lang, "rewrite");
    }

    return getText(lang, "saveAsk");
  }

  // Fallback
  await resetToCollecting(user_id, session.lang || "en");
  return getText(lang, "startCollecting");
}

// --------------------
// ✅ Web App DST Builder flow (facilitator-style)
// --------------------
function appModePrompt(lang) {
  if (lang === "hi") {
    return (
      "नमस्ते। क्या आप अपनी कहानी साझा करना चाहेंगे या मैं आपको एक विषय दूँ?\n\n" +
      "1 — मैं अपनी कहानी साझा करूँगा/करूँगी\n" +
      "2 — मुझे एक विषय दें"
    );
  }
  if (lang === "gu") {
    return (
      "નમસ્તે. શું તમે તમારી વાર્તા શેર કરવા માંગો છો કે હું તમને એક વિષય આપું?\n\n" +
      "1 — હું મારી વાર્તા કહું\n" +
      "2 — મને એક વિષય આપો"
    );
  }
  return (
    "Hello.\n\nWould you like to share a story\nor would you like me to suggest a topic?\n\n" +
    "1 — I will share a story\n" +
    "2 — Give me a topic"
  );
}

function appTellStoryPrompt(lang) {
  if (lang === "hi") return "ठीक है। अपनी कहानी बताइए। पूरा होने पर DONE लिखें।";
  if (lang === "gu") return "બરાબર. તમારી વાર્તા કહો. પૂરું થાય ત્યારે DONE લખો.";
  return "Okay. Please share your story. Type DONE when finished.";
}

function appTopicPrompt(lang, topic) {
  if (lang === "hi")
    return `यह एक विषय है:\n\n${topic}\n\nक्या यही विषय रखें?\nYES — शुरू करें\nANOTHER — दूसरा विषय`;
  if (lang === "gu")
    return `આ એક વિષય છે:\n\n${topic}\n\nઆ વિષય રાખવો છે?\nYES — શરૂ કરો\nANOTHER — બીજો વિષય`;
  return `Here is a topic:\n\n${topic}\n\nUse this topic?\nYES — start story\nANOTHER — show another topic`;
}

function appSaveAsk(lang) {
  if (lang === "hi") return "यह कहानी कैसी लगी? सेव करने के लिए YES लिखें, बदलने के लिए NO।";
  if (lang === "gu") return "આ વાર્તા કેવી લાગી? સેવ માટે YES, બદલવા NO લખો.";
  return "How is this story? Reply YES to save or NO to rewrite.";
}

function appSavedMsg(lang, user_id) {
  const url = `/u/${user_id}`;
  if (lang === "hi") return `बहुत बढ़िया। सेव हो गया। आपकी कहानियाँ: ${url}`;
  if (lang === "gu") return `સરસ. સેવ થઈ ગયું. તમારી વાર્તાઓ: ${url}`;
  return `Saved. Your stories: ${url}`;
}

export async function handleAppTurn({ user_id, text, lang, seed_prompt }) {
  const incoming = String(text || "").trim();
  const chosenLang = lang || "en";

  let session = await loadSession(user_id);

  // Create new app session
  if (!session) {
    await upsertSession({
      user_id,
      state: "APP_MODE",
      story_text: "",
      story_id: "",
      consent: true,
      lang: chosenLang,
      msg_count: 0,
      seed_prompt: "",
      last_agent_prompt: "",
    });

    return {
      screen: "BUILD",
      story_so_far: "",
      agent_prompt: appModePrompt(chosenLang),
      seed_prompt: "",
    };
  }

  // If caller sends lang, update session lang
  if (lang && lang !== session.lang) {
    await upsertSession({
      ...session,
      lang,
    });
    session.lang = lang;
  }

  const L = session.lang || chosenLang;

  // If UI sends a seed_prompt explicitly (Pick a Prompt button)
  // Treat it like "topic mode" and ask YES/ANOTHER.
  if (seed_prompt !== undefined && String(seed_prompt || "").trim() !== "") {
    const topic = String(seed_prompt).trim();

    await upsertSession({
      ...session,
      state: "APP_TOPIC_CONFIRM",
      seed_prompt: topic,
      // clear last agent prompt to avoid carry-over
      last_agent_prompt: "",
    });

    return {
      screen: "BUILD",
      story_so_far: session.story_text || "",
      agent_prompt: appTopicPrompt(L, topic),
      seed_prompt: topic,
    };
  }

  // MODE: choose story vs topic
  if (session.state === "APP_MODE") {
    if (!incoming) {
      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appModePrompt(L),
        seed_prompt: session.seed_prompt || "",
      };
    }

    if (incoming === "1") {
      await upsertSession({
        ...session,
        state: "APP_BUILD",
        story_text: "",
        msg_count: 0,
        seed_prompt: "",
        last_agent_prompt: "",
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTellStoryPrompt(L),
        seed_prompt: "",
      };
    }

    if (incoming === "2") {
      const topic = randomTopic(L);

      await upsertSession({
        ...session,
        state: "APP_TOPIC_CONFIRM",
        story_text: "",
        msg_count: 0,
        seed_prompt: topic,
        last_agent_prompt: "",
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTopicPrompt(L, topic),
        seed_prompt: topic,
      };
    }

    return {
      screen: "BUILD",
      story_so_far: "",
      agent_prompt: appModePrompt(L),
      seed_prompt: session.seed_prompt || "",
    };
  }

  // TOPIC CONFIRM
  if (session.state === "APP_TOPIC_CONFIRM") {
    if (!incoming) {
      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTopicPrompt(L, session.seed_prompt || randomTopic(L)),
        seed_prompt: session.seed_prompt || "",
      };
    }

    const yn = normalizeYesNo(incoming);

    if (yn === "YES") {
      await upsertSession({
        ...session,
        state: "APP_BUILD",
        story_text: "",
        msg_count: 0,
        last_agent_prompt: "",
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTellStoryPrompt(L),
        seed_prompt: session.seed_prompt || "",
      };
    }

    if (incoming.toLowerCase() === "another") {
      const topic = randomTopic(L);

      await upsertSession({
        ...session,
        seed_prompt: topic,
        last_agent_prompt: "",
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTopicPrompt(L, topic),
        seed_prompt: topic,
      };
    }

    // stay in topic confirm until valid response
    return {
      screen: "BUILD",
      story_so_far: "",
      agent_prompt: appTopicPrompt(L, session.seed_prompt || randomTopic(L)),
      seed_prompt: session.seed_prompt || "",
    };
  }

  // BUILD: collect story chunks + AI probing
  if (session.state === "APP_BUILD") {
    if (!incoming) {
      return {
        screen: "BUILD",
        story_so_far: session.story_text || "",
        agent_prompt: session.last_agent_prompt || appTellStoryPrompt(L),
        seed_prompt: session.seed_prompt || "",
      };
    }

    if (isDone(incoming)) {
      const raw = (session.story_text || "").trim();

      const polished = await polishStory({ lang: L, story_text: raw });
      const finalBody = polished?.body?.trim() ? polished.body.trim() : raw.trim();

      const draft = polished?.body?.trim()
        ? { title: polished.title || (L === "hi" ? "एक कहानी" : L === "gu" ? "એક વાર્તા" : "A Story"), body: finalBody }
        : makeDraft(finalBody);

      await upsertSession({
        ...session,
        state: "APP_REVIEW",
        story_text: finalBody,
        msg_count: 0,
        // keep seed_prompt for metadata
        last_agent_prompt: "",
      });

      return {
        screen: "REVIEW",
        story_so_far: finalBody,
        draft,
        agent_prompt: appSaveAsk(L),
        seed_prompt: session.seed_prompt || "",
      };
    }

    const updatedText = session.story_text ? session.story_text + "\n" + incoming : incoming;

    let agent_prompt = appTellStoryPrompt(L);

    try {
      const recentLines = String(updatedText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(-8);

      const contextText = recentLines.join("\n");

      const aiInput =
        (session.seed_prompt ? `Theme:\n${session.seed_prompt}\n\n` : "") +
        (session.last_agent_prompt ? `Previous question:\n${session.last_agent_prompt}\n\n` : "") +
        `Context so far:\n${contextText}\n\n` +
        `Latest message:\n${incoming}\n`;

      const ai = await generateReflectionAndQuestion({
        lang: L,
        story_text: aiInput,
      });

      if (ai?.combined) agent_prompt = ai.combined;
      else agent_prompt = getText(L, "added");
    } catch {
      agent_prompt = getText(L, "added");
    }

    await upsertSession({
      ...session,
      state: "APP_BUILD",
      story_text: updatedText,
      msg_count: (session.msg_count || 0) + 1,
      last_agent_prompt: agent_prompt,
    });

    return {
      screen: "BUILD",
      story_so_far: updatedText,
      agent_prompt,
      seed_prompt: session.seed_prompt || "",
    };
  }

  // REVIEW: save or rewrite
  if (session.state === "APP_REVIEW") {
    const yn = normalizeYesNo(incoming);

    if (yn === "YES") {
      const saved = await saveStory({
        user_id,
        story_text: session.story_text || "",
        publish: true,
      });

      await logEvent({ user_id, event: "story_saved_app", details: saved.id });

      await upsertSession({
        user_id,
        state: "APP_MODE",
        story_text: "",
        story_id: "",
        consent: true,
        lang: L,
        msg_count: 0,
        seed_prompt: "",
        last_agent_prompt: "",
      });

      return {
        screen: "SUCCESS",
        story_so_far: "",
        agent_prompt: appSavedMsg(L, user_id),
        saved_url: `/u/${user_id}`,
        seed_prompt: "",
      };
    }

    if (yn === "NO") {
      await upsertSession({
        user_id,
        state: "APP_BUILD",
        story_text: "",
        story_id: "",
        consent: true,
        lang: L,
        msg_count: 0,
        seed_prompt: session.seed_prompt || "",
        last_agent_prompt: "",
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appTellStoryPrompt(L),
        seed_prompt: session.seed_prompt || "",
      };
    }

    const draft = makeDraft(session.story_text || "");
    return {
      screen: "REVIEW",
      story_so_far: session.story_text || "",
      draft,
      agent_prompt: appSaveAsk(L),
      seed_prompt: session.seed_prompt || "",
    };
  }

  // Any other state: reset to mode selection
  await upsertSession({
    user_id,
    state: "APP_MODE",
    story_text: "",
    story_id: "",
    consent: true,
    lang: L,
    msg_count: 0,
    seed_prompt: "",
    last_agent_prompt: "",
  });

  return {
    screen: "BUILD",
    story_so_far: "",
    agent_prompt: appModePrompt(L),
    seed_prompt: "",
  };
}