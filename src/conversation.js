// src/conversation.js
import { getSheetsClient, readRange } from "./sheets.js";
import { saveStory } from "./storyStore.js";
import { makeDraft, normalizeYesNo } from "./storyEngine.js";
import { logEvent } from "./logger.js";
import { generateReflectionAndQuestion } from "./ai.js";

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
        "Okay. Please share your memory. Speak or type freely. When you are finished, type DONE.",
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
        "ठीक है। अपनी याद साझा करें। आराम से बोलें या लिखें। जब पूरा हो जाए, DONE लिखें।",
      added: "धन्यवाद। आगे बताइए। (पूरा होने पर DONE लिखें।)",

      draftIntro: "यह आपका ड्राफ्ट है:",
      saveAsk: "क्या इसे सेव करें? सेव के लिए YES, दोबारा लिखने के लिए NO।",
      rewrite: "ठीक है। कृपया कहानी फिर से साझा करें। पूरा होने पर DONE लिखें।",

      published: `सेव हो गया। यहाँ देखें: /u/${vars.user_id || ""}`,

      stopped: "आपने ऑप्ट आउट कर लिया है। फिर शुरू करने के लिए START लिखें।",
      resetDone: "रीसेट हो गया।",
      help:
        "Commands: HELP, RESET, STOP, START\n\nFlow:\n• कहानी साझा करें\n• DONE लिखें\n• सेव के लिए YES या बदलने के लिए NO",
      langSet: "ठीक है। अब मैं आपकी चुनी हुई भाषा में आगे बढ़ूँगा/बढ़ूँगी।",
    },

    gu: {
      consent:
        "શરુ કરવા પહેલા: આ બોટ વાર્તા ગોઠવવામાં મદદ કરે છે. અભ્યાસ માટે તમારા સંદેશાઓ સેવ થઈ શકે છે. આગળ વધવા OK લખો. ક્યારે પણ STOP લખી શકો છો.",
      chooseLang: "ભાષા પસંદ કરો (1/2/3):\n1) Hindi\n2) ગુજરાતી\n3) English",

      startCollecting:
        "બરાબર. તમારી યાદ શેર કરો. આરામથી બોલો અથવા લખો. પૂરું થાય ત્યારે DONE લખો.",
      added: "આભાર. આગળ કહો. (પૂરું થાય ત્યારે DONE લખો.)",

      draftIntro: "આ તમારો ડ્રાફ્ટ છે:",
      saveAsk: "આ વાર્તા સેવ કરવી? સેવ માટે YES, ફરી લખવા NO.",
      rewrite: "બરાબર. કૃપા કરીને વાર્તા ફરીથી શેર કરો. પૂરું થાય ત્યારે DONE લખો.",

      published: `સેવ થઈ ગયું. અહીં જુઓ: /u/${vars.user_id || ""}`,

      stopped: "તમે ઑપ્ટ આઉટ કર્યું છે. ફરી શરૂ કરવા START લખો.",
      resetDone: "રીસેટ થઈ ગયું.",
      help:
        "Commands: HELP, RESET, STOP, START\n\nFlow:\n• વાર્તા શેર કરો\n• DONE લખો\n• સેવ માટે YES અથવા બદલવા NO",
      langSet: "બરાબર. હવે હું તમારી પસંદ કરેલી ભાષામાં આગળ વધું છું.",
    },
  };

  const pack = strings[L] || strings.en;
  return pack[key] || strings.en[key] || "";
}

function headerIndex(headers, name) {
  return headers.findIndex((h) => String(h || "").trim() === name);
}

function normalizeHeaderRow(row) {
  return (row || []).map((h) => String(h || "").trim());
}

function isDone(msg) {
  return String(msg || "").trim().toUpperCase() === "DONE";
}

// --------------------
// Sessions
// --------------------
async function getSessionsTable() {
  if (!SHEET_ID) {
    throw new Error(
      "GOOGLE_SHEET_ID is missing in environment. Set it in .env or Render."
    );
  }

  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${SESSIONS_TAB}!A1:Z`,
  });
  if (!rows.length) return { headers: [], data: [] };

  const headers = normalizeHeaderRow(rows[0]);
  const data = rows.slice(1);
  return { headers, data };
}

async function loadSession(user_id) {
  const { headers, data } = await getSessionsTable();
  if (!headers.length) return null;

  const idxUser = headerIndex(headers, "user_id");
  if (idxUser < 0) return null;

  for (const row of data) {
    if (String(row[idxUser] || "").trim() === String(user_id).trim()) {
      const idxState = headerIndex(headers, "state");
      const idxStory = headerIndex(headers, "story_text");
      const idxStoryId = headerIndex(headers, "story_id");
      const idxConsent = headerIndex(headers, "consent");
      const idxLang = headerIndex(headers, "lang");
      const idxMsg = headerIndex(headers, "msg_count");

      return {
        user_id,
        state: row[idxState] || "",
        story_text: row[idxStory] || "",
        story_id: row[idxStoryId] || "",
        consent: String(row[idxConsent] || "").toUpperCase() === "TRUE",
        lang: row[idxLang] || "en",
        msg_count: Number(row[idxMsg] || 0),
      };
    }
  }

  return null;
}

async function upsertSession(session) {
  const { headers, data } = await getSessionsTable();
  if (!headers.length) throw new Error("sessions sheet missing header row");

  const idxUser = headerIndex(headers, "user_id");
  const idxState = headerIndex(headers, "state");
  const idxStory = headerIndex(headers, "story_text");
  const idxStoryId = headerIndex(headers, "story_id");
  const idxConsent = headerIndex(headers, "consent");
  const idxLang = headerIndex(headers, "lang");
  const idxMsg = headerIndex(headers, "msg_count");

  const rowValues = Array(headers.length).fill("");

  rowValues[idxUser] = session.user_id;
  if (idxState >= 0) rowValues[idxState] = session.state || "";
  if (idxStory >= 0) rowValues[idxStory] = session.story_text || "";
  if (idxStoryId >= 0) rowValues[idxStoryId] = session.story_id || "";
  if (idxConsent >= 0) rowValues[idxConsent] = session.consent ? "TRUE" : "FALSE";
  if (idxLang >= 0) rowValues[idxLang] = session.lang || "en";
  if (idxMsg >= 0) rowValues[idxMsg] = String(session.msg_count || 0);

  const existingRowIndex0 = data.findIndex(
    (r) => String(r[idxUser] || "").trim() === String(session.user_id).trim()
  );

  const sheets = await getSheetsClient();

  if (existingRowIndex0 === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    const sheetRowNumber = existingRowIndex0 + 2; // +1 for header, +1 for 1-based
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!A${sheetRowNumber}:Z${sheetRowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  }
}

async function resetToCollecting(user_id, lang) {
  await upsertSession({
    user_id,
    state: "COLLECTING",
    story_text: "",
    story_id: "",
    consent: true,
    lang: lang || "en",
    msg_count: 0,
  });
}

// --------------------
// Main WhatsApp-style flow (kept)
// --------------------
export async function handleMessage({ from, text }) {
  const user_id = String(from || "").trim();
  const msg = String(text || "").trim();

  let session = await loadSession(user_id);

  // Create new session
  if (!session) {
    session = {
      user_id,
      state: "CONSENT",
      story_text: "",
      story_id: "",
      consent: false,
      lang: "en",
      msg_count: 0,
    };
    await upsertSession(session);
  }

  const lang = session.lang || "en";
  const upper = msg.toUpperCase();
  const yn = normalizeYesNo(msg);

  // STOP / START / RESET / HELP
  if (upper === "STOP") {
    await upsertSession({
      ...session,
      state: "STOPPED",
      consent: false,
      msg_count: 0,
    });
    return getText(lang, "stopped");
  }

  if (upper === "START") {
    await upsertSession({
      ...session,
      state: "CONSENT",
      consent: false,
      msg_count: 0,
    });
    return getText(lang, "consent");
  }

  if (upper === "RESET") {
    await resetToCollecting(user_id, lang);
    return getText(lang, "resetDone");
  }

  if (upper === "HELP") {
    return getText(lang, "help");
  }

  // STOPPED
  if (session.state === "STOPPED") {
    return getText(lang, "stopped");
  }

  // CONSENT
  if (session.state === "CONSENT") {
    if (upper === "OK") {
      await upsertSession({
        ...session,
        state: "CHOOSE_LANG",
        consent: true,
      });
      return getText(lang, "chooseLang");
    }
    return getText(lang, "consent");
  }

  // CHOOSE_LANG
  if (session.state === "CHOOSE_LANG") {
    const chosen = normalizeLangChoice(msg);
    if (!chosen) return getText(lang, "chooseLang");

    await upsertSession({
      ...session,
      lang: chosen,
      state: "COLLECTING",
      story_text: "",
      msg_count: 0,
    });

    return getText(chosen, "langSet") + "\n\n" + getText(chosen, "startCollecting");
  }

  // COLLECTING
  if (session.state === "COLLECTING") {
    if (!msg) return getText(lang, "startCollecting");

    if (isDone(msg)) {
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
      });

      return (
        `${aiBlock}${getText(lang, "draftIntro")}\n\n` +
        `Title: ${draft.title}\n\n` +
        `${draft.body}\n\n` +
        `${getText(lang, "saveAsk")}`
      );
    }

    // Treat EVERYTHING as story text while collecting (including YES/NO)
    const updatedText = session.story_text ? session.story_text + "\n" + msg : msg;

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: updatedText,
      story_id: "",
      consent: true,
      lang: session.lang || "",
      msg_count: (session.msg_count || 0) + 1,
    });

    return getText(lang, "added");
  }

  // REVIEW
  if (session.state === "REVIEW") {
    if (yn === "YES") {
      console.log("[SAVE BRANCH] Entered YES path", {
        user_id,
        state: session.state,
        storyLength: (session.story_text || "").length,
      });

      const saved = await saveStory({
        user_id,
        story_text: session.story_text,
        publish: true,
      });

      console.log("[SAVE BRANCH] saveStory returned:", saved);

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
// ✅ NEW: Web App DST Builder flow
// --------------------
function appStartPrompt(lang) {
  if (lang === "hi")
    return "नमस्ते। कोई याद साझा करें। आप बोल सकते हैं या लिख सकते हैं। जब पूरा हो जाए तो DONE लिखें।";
  if (lang === "gu")
    return "નમસ્તે. કોઈ યાદ શેર કરો. તમે બોલી શકો અથવા લખી શકો. પૂરું થાય ત્યારે DONE લખો.";
  return "Hello. Share a memory. Speak or type freely. When finished, type DONE.";
}

function appSaveAsk(lang) {
  if (lang === "hi") return "ये कहानी कैसी लगी? सेव करने के लिए YES लिखें, या बदलने के लिए NO।";
  if (lang === "gu") return "આ વાર્તા કેવી લાગી? સેવ માટે YES, બદલવા NO લખો.";
  return "How is this story? Reply YES to save or NO to rewrite.";
}

function appSavedMsg(lang, user_id) {
  const url = `/u/${user_id}`;
  if (lang === "hi") return `बहुत बढ़िया। सेव हो गया। आपकी कहानियाँ: ${url}`;
  if (lang === "gu") return `સરસ. સેવ થઈ ગયું. તમારી વાર્તાઓ: ${url}`;
  return `Saved. Your stories: ${url}`;
}

export async function handleAppTurn({ user_id, text, lang }) {
  const incoming = String(text || "").trim();
  const chosenLang = lang || "hi";

  let session = await loadSession(user_id);

  // Create new app session
  if (!session) {
    await upsertSession({
      user_id,
      state: "APP_BUILD",
      story_text: "",
      story_id: "",
      consent: true,
      lang: chosenLang,
      msg_count: 0,
    });

    return {
      screen: "BUILD",
      story_so_far: "",
      agent_prompt: appStartPrompt(chosenLang),
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

  // BUILD: collect user story chunks only
  if (session.state === "APP_BUILD") {
    if (!incoming) {
      return {
        screen: "BUILD",
        story_so_far: session.story_text || "",
        agent_prompt: appStartPrompt(L),
      };
    }

    if (isDone(incoming)) {
      const draft = makeDraft(session.story_text || "");

      await upsertSession({
        ...session,
        state: "APP_REVIEW",
        msg_count: 0,
      });

      return {
        screen: "REVIEW",
        story_so_far: session.story_text || "",
        draft,
        agent_prompt: appSaveAsk(L),
      };
    }

    const updatedText = session.story_text
      ? session.story_text + "\n" + incoming
      : incoming;

    await upsertSession({
      ...session,
      state: "APP_BUILD",
      story_text: updatedText,
      msg_count: (session.msg_count || 0) + 1,
    });

    // Agent prompt (AI if enabled inside ai.js, otherwise safe fallback)
    let agent_prompt = getText(L, "added");
    const aiResult = await generateReflectionAndQuestion({
      lang: L,
      story_text: updatedText,
    });
    if (aiResult?.combined) agent_prompt = aiResult.combined;

    return {
      screen: "BUILD",
      story_so_far: updatedText,
      agent_prompt,
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
        state: "APP_BUILD",
        story_text: "",
        story_id: "",
        consent: true,
        lang: L,
        msg_count: 0,
      });

      return {
        screen: "SUCCESS",
        story_so_far: "",
        agent_prompt: appSavedMsg(L, user_id),
        saved_url: `/u/${user_id}`,
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
      });

      return {
        screen: "BUILD",
        story_so_far: "",
        agent_prompt: appStartPrompt(L),
      };
    }

    const draft = makeDraft(session.story_text || "");
    return {
      screen: "REVIEW",
      story_so_far: session.story_text || "",
      draft,
      agent_prompt: appSaveAsk(L),
    };
  }

  // Any other state: reset to app
  await upsertSession({
    user_id,
    state: "APP_BUILD",
    story_text: "",
    story_id: "",
    consent: true,
    lang: L,
    msg_count: 0,
  });

  return {
    screen: "BUILD",
    story_so_far: "",
    agent_prompt: appStartPrompt(L),
  };
}