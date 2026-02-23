import { getSheetsClient, readRange } from "./sheets.js";
import { saveStory, updatePublishStatus } from "./storyStore.js";
import { makeDraft, normalizeYesNo } from "./storyEngine.js";
import { logEvent } from "./logger.js";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-J0cHIQvz9r13lCft15Shb7gLnBF2798DOoJ8OKC5Tc";

const SESSIONS_TAB = "sessions";
const SESSIONS_RANGE = `${SESSIONS_TAB}!A:G`;

function isoNow() {
  return new Date().toISOString();
}

function isGreeting(text) {
  const t = String(text || "").trim().toLowerCase();
  return ["hi", "hello", "hey", "hii", "hiii", "namaste"].includes(t);
}

function consentMessage() {
  return (
    "Before we begin: This bot helps you write stories. Your messages may be saved for the study. " +
    "Reply OK to continue. Reply STOP anytime to opt out."
  );
}

function helpMessage() {
  return (
    "How to use Kahanibot:\n" +
    "1) Type your story.\n" +
    "2) Type DONE when finished.\n" +
    "3) Reply YES to save, NO to rewrite.\n" +
    "4) Reply YES to publish, NO to keep private.\n" +
    "Commands: HELP, RESET, STOP, START"
  );
}

async function loadSession(user_id) {
  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${SESSIONS_TAB}!A1:G`,
  });

  if (!rows.length) return null;

  const headers = rows[0];
  const data = rows.slice(1);

  const idxUser = headers.indexOf("user_id");
  const idxState = headers.indexOf("state");
  const idxStoryText = headers.indexOf("story_text");
  const idxStoryId = headers.indexOf("story_id");
  const idxConsent = headers.indexOf("consent");

  if (idxUser === -1) return null;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[idxUser] || "") === String(user_id)) {
      return {
        state: row[idxState] || "IDLE",
        story_text: row[idxStoryText] || "",
        story_id: row[idxStoryId] || "",
        consent: String(row[idxConsent] || "").toLowerCase() === "true",
      };
    }
  }

  return null;
}

async function upsertSession({ user_id, state, story_text, story_id, consent }) {
  const sheets = await getSheetsClient();

  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${SESSIONS_TAB}!A1:G`,
  });

  if (!rows.length) {
    console.error("sessions tab appears empty (no header row found)");
    return;
  }

  const headers = rows[0];
  const data = rows.slice(1);

  const idxUser = headers.indexOf("user_id");
  if (idxUser === -1) {
    console.error("sessions tab headers missing user_id");
    return;
  }

  let foundSheetRowNumber = null;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[idxUser] || "") === String(user_id)) {
      foundSheetRowNumber = i + 2; // header + 1-based
      break;
    }
  }

  const created_at = isoNow();
  const updated_at = isoNow();

  const consentVal = consent ? "true" : "false";

  if (foundSheetRowNumber) {
    // Update B-E: state, story_text, story_id, consent
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!B${foundSheetRowNumber}:E${foundSheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[state, story_text, story_id, consentVal]],
      },
    });

    // Update updated_at (G)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!G${foundSheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[updated_at]],
      },
    });

    return;
  }

  // Insert new row
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SESSIONS_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[user_id, state, story_text, story_id, consentVal, created_at, updated_at]],
    },
  });
}

async function resetSession(user_id, consent) {
  await upsertSession({
    user_id,
    state: "IDLE",
    story_text: "",
    story_id: "",
    consent: !!consent,
  });
}

export async function handleMessage({ from, text }) {
  const user_id = String(from || "").trim();
  const msg = String(text || "").trim();
  const lower = msg.toLowerCase();

  if (!user_id) return "Missing sender id.";

  let session = await loadSession(user_id);
  if (!session) {
    // New user: require consent first
    session = { state: "CONSENT", story_text: "", story_id: "", consent: false };
    await upsertSession({ user_id, ...session });
    await logEvent({ user_id, event: "consent_shown", details: "" });
    return consentMessage();
  }

  const yn = normalizeYesNo(msg); // YES / NO / UNKNOWN

  // HELP always works (even if stopped)
  if (lower === "help") {
    await logEvent({ user_id, event: "help_shown", details: "" });
    return helpMessage();
  }

  // STOP / START
  if (lower === "stop") {
    await upsertSession({
      user_id,
      state: "STOPPED",
      story_text: "",
      story_id: "",
      consent: session.consent,
    });
    await logEvent({ user_id, event: "stopped", details: "" });
    return "You have opted out. Send START anytime to resume.";
  }

  if (lower === "start") {
    // Re-enable user
    // If they never consented, go to consent flow again
    if (!session.consent) {
      await upsertSession({
        user_id,
        state: "CONSENT",
        story_text: "",
        story_id: "",
        consent: false,
      });
      await logEvent({ user_id, event: "consent_shown", details: "" });
      return consentMessage();
    }

    await resetSession(user_id, true);
    await logEvent({ user_id, event: "started", details: "" });
    return "Welcome back. Please type your story. When finished, type DONE.";
  }

  // If STOPPED, ignore everything except HELP/START (already handled above)
  if (session.state === "STOPPED") {
    return "";
  }

  // Consent flow
  if (!session.consent || session.state === "CONSENT") {
    if (lower === "ok" || yn === "YES") {
      await upsertSession({
        user_id,
        state: "IDLE",
        story_text: "",
        story_id: "",
        consent: true,
      });
      await logEvent({ user_id, event: "consent_accepted", details: "" });
      return "Thank you. Please type your story. When finished, type DONE.";
    }

    return consentMessage();
  }

  // RESET (after consent only)
  if (lower === "reset") {
    await resetSession(user_id, true);
    await logEvent({ user_id, event: "reset", details: "" });
    return "Reset done. Please type your story. When finished, type DONE.";
  }

  // IDLE
  if (session.state === "IDLE") {
    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: "",
      story_id: "",
      consent: true,
    });

    if (isGreeting(msg) || msg === "") {
      return "Please type your story. When finished, type DONE.";
    }

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: msg,
      story_id: "",
      consent: true,
    });

    return "Added. Continue writing or type DONE.";
  }

  // COLLECTING
  if (session.state === "COLLECTING") {
    if (isGreeting(msg) && !session.story_text) {
      return "Please type your story. When finished, type DONE.";
    }

    // Prevent accidental YES/NO being appended into story text
    if (yn !== "UNKNOWN" && session.story_text && session.story_text.trim()) {
      return "Please continue your story or type DONE when finished.";
    }

    if (lower === "done") {
      if (!session.story_text || !session.story_text.trim()) {
        return "I did not get any story text yet. Please type your story, then type DONE.";
      }

      const draft = makeDraft(session.story_text);

      await upsertSession({
        user_id,
        state: "REVIEW",
        story_text: session.story_text,
        story_id: "",
        consent: true,
      });

      await logEvent({ user_id, event: "draft_shown", details: "" });

      return (
        `Here is your draft:\n\n` +
        `Title: ${draft.title}\n\n` +
        `${draft.body}\n\n` +
        `Save this story? Reply YES to save or NO to rewrite.`
      );
    }

    const updatedText = session.story_text
      ? session.story_text + "\n" + msg
      : msg;

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: updatedText,
      story_id: "",
      consent: true,
    });

    return "Added. Continue writing or type DONE.";
  }

  // REVIEW
  if (session.state === "REVIEW") {
    if (yn === "YES") {
      const saved = await saveStory({
        user_id,
        story_text: session.story_text,
        publish: false,
      });

      await logEvent({ user_id, event: "story_saved", details: saved.id });

      await upsertSession({
        user_id,
        state: "ASK_PUBLISH",
        story_text: session.story_text,
        story_id: saved.id,
        consent: true,
      });

      return "Saved. Publish publicly? Reply YES to publish or NO to keep it private.";
    }

    if (yn === "NO") {
      await upsertSession({
        user_id,
        state: "COLLECTING",
        story_text: "",
        story_id: "",
        consent: true,
      });

      return "Okay, let’s rewrite. Please type your story again. When finished, type DONE.";
    }

    return "Please reply YES to save or NO to rewrite.";
  }

  // ASK_PUBLISH
  if (session.state === "ASK_PUBLISH") {
    if (yn === "YES") {
      if (session.story_id) {
        await updatePublishStatus({ id: session.story_id, publish: true });
      }

      await logEvent({
        user_id,
        event: "published",
        details: session.story_id || "",
      });

      await resetSession(user_id, true);
      return `Published. View your stories here: /u/${user_id}`;
    }

    if (yn === "NO") {
      await logEvent({
        user_id,
        event: "kept_private",
        details: session.story_id || "",
      });

      await resetSession(user_id, true);
      return "Okay. Kept private. You can start a new story anytime.";
    }

    return "Please reply YES to publish or NO to keep it private.";
  }

  // Fallback
  await resetSession(user_id, true);
  return "Something went wrong. Resetting. Please type your story. When finished, type DONE.";
}