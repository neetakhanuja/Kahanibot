import { getSheetsClient, readRange } from "./sheets.js";
import { saveStory, updatePublishStatus } from "./storyStore.js";
import { makeDraft, normalizeYesNo } from "./storyEngine.js";
import { logEvent } from "./logger.js";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-J0cHIQvz9r13lCft15Shb7gLnBF2798DOoJ8OKC5Tc";

const SESSIONS_TAB = "sessions";
const SESSIONS_RANGE = `${SESSIONS_TAB}!A:F`;

function isoNow() {
  return new Date().toISOString();
}

function isGreeting(text) {
  const t = String(text || "").trim().toLowerCase();
  return ["hi", "hello", "hey", "hii", "hiii", "namaste"].includes(t);
}

async function loadSession(user_id) {
  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${SESSIONS_TAB}!A1:F`,
  });

  if (!rows.length) return null;

  const headers = rows[0];
  const data = rows.slice(1);

  const idxUser = headers.indexOf("user_id");
  const idxState = headers.indexOf("state");
  const idxStoryText = headers.indexOf("story_text");
  const idxStoryId = headers.indexOf("story_id");

  if (idxUser === -1) return null;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[idxUser] || "") === String(user_id)) {
      return {
        state: row[idxState] || "IDLE",
        story_text: row[idxStoryText] || "",
        story_id: row[idxStoryId] || "",
      };
    }
  }

  return null;
}

async function upsertSession({ user_id, state, story_text, story_id }) {
  const sheets = await getSheetsClient();

  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${SESSIONS_TAB}!A1:F`,
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

  if (foundSheetRowNumber) {
    // Update: state, story_text, story_id (B-D)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!B${foundSheetRowNumber}:D${foundSheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[state, story_text, story_id]],
      },
    });

    // Update only updated_at (F)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SESSIONS_TAB}!F${foundSheetRowNumber}`,
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
      values: [[user_id, state, story_text, story_id, created_at, updated_at]],
    },
  });
}

async function resetSession(user_id) {
  await upsertSession({
    user_id,
    state: "IDLE",
    story_text: "",
    story_id: "",
  });
}

export async function handleMessage({ from, text }) {
  const user_id = String(from || "").trim();
  const msg = String(text || "").trim();

  if (!user_id) return "Missing sender id.";

  let session = await loadSession(user_id);
  if (!session) {
    session = { state: "IDLE", story_text: "", story_id: "" };
    await upsertSession({ user_id, ...session });
  }

  const yn = normalizeYesNo(msg); // YES / NO / UNKNOWN
  const lower = msg.toLowerCase();

  // Commands
  if (lower === "reset") {
    await resetSession(user_id);
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
    });

    if (isGreeting(msg) || msg === "") {
      return "Please type your story. When finished, type DONE.";
    }

    await upsertSession({
      user_id,
      state: "COLLECTING",
      story_text: msg,
      story_id: "",
    });

    return "Added. Continue writing or type DONE.";
  }

  // COLLECTING
  if (session.state === "COLLECTING") {
    if (isGreeting(msg) && !session.story_text) {
      return "Please type your story. When finished, type DONE.";
    }

    // ✅ Prevent accidental YES/NO being appended into story text
    // (This happens if the user replies YES/NO but the state update is slightly delayed.)
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
      });

      return "Saved. Publish publicly? Reply YES to publish or NO to keep it private.";
    }

    if (yn === "NO") {
      await upsertSession({
        user_id,
        state: "COLLECTING",
        story_text: "",
        story_id: "",
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

      await resetSession(user_id);
      return `Published. View your stories here: /u/${user_id}`;
    }

    if (yn === "NO") {
      await logEvent({
        user_id,
        event: "kept_private",
        details: session.story_id || "",
      });

      await resetSession(user_id);
      return "Okay. Kept private. You can start a new story anytime.";
    }

    return "Please reply YES to publish or NO to keep it private.";
  }

  // Fallback
  await resetSession(user_id);
  return "Something went wrong. Resetting. Please type your story. When finished, type DONE.";
}