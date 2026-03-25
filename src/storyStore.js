import crypto from "crypto";
import { getSheetsClient, readRange } from "./sheets.js";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-J0cHIQvz9r13lCft15Shb7gLnBF2798DOoJ8OKC5Tc";
const TAB_NAME = process.env.GOOGLE_SHEET_TAB || "stories";
const RANGE = `${TAB_NAME}!A:Z`;

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function toBool(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1";
}

function findHeaderIndex(headers, name) {
  return (headers || []).findIndex(
    (h) => String(h || "").trim().toLowerCase() === String(name || "").trim().toLowerCase()
  );
}

function buildRowFromHeaders(headers, valuesByHeader) {
  return (headers || []).map((h) => {
    const key = String(h || "").trim();
    return valuesByHeader[key] ?? "";
  });
}

function pickFirst(row, headers, names) {
  for (const name of names) {
    const idx = findHeaderIndex(headers, name);
    if (idx !== -1) {
      return row[idx] || "";
    }
  }
  return "";
}

async function getSheetRows() {
  const sheets = await getSheetsClient();
  const rows = await readRange({
    sheets,
    spreadsheetId: SHEET_ID,
    range: RANGE,
  });

  return { sheets, rows: rows || [] };
}

export async function saveStory({
  user_id,
  story_text,
  publish = false,
  transcript_text = "",
  polished_story_text = "",
  privacy = "",
  audio_url = "",
  title = "",
}) {
  const { sheets, rows } = await getSheetRows();

  if (!rows.length) {
    throw new Error(`Missing stories sheet or headers in tab: ${TAB_NAME}`);
  }

  const headers = rows[0];
  const id = makeId();
  const created_at = new Date().toISOString();

  const finalPrivacy =
    privacy ||
    (publish ? "share" : "private");

  const finalPolished = String(polished_story_text || story_text || "").trim();
  const finalTranscript = String(transcript_text || story_text || "").trim();

  const row = buildRowFromHeaders(headers, {
    id,
    user_id: String(user_id || ""),
    story_text: finalPolished,
    transcript_text: finalTranscript,
    polished_story_text: finalPolished,
    publish: String(Boolean(publish)),
    privacy: finalPrivacy,
    audio_url: String(audio_url || ""),
    title: String(title || ""),
    created_at,
    updated_at: created_at,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });

  return {
    id,
    user_id: String(user_id || ""),
    story_text: finalPolished,
    transcript_text: finalTranscript,
    polished_story_text: finalPolished,
    publish: Boolean(publish),
    privacy: finalPrivacy,
    audio_url: String(audio_url || ""),
    title: String(title || ""),
    created_at,
  };
}

export async function updatePublishStatus({ id, publish }) {
  const { sheets, rows } = await getSheetRows();

  if (rows.length <= 1) {
    return { ok: false, reason: "No data rows found" };
  }

  const headers = rows[0];
  const publishIndex = findHeaderIndex(headers, "publish");
  const privacyIndex = findHeaderIndex(headers, "privacy");
  const idIndex = findHeaderIndex(headers, "id");

  if (idIndex === -1) {
    return { ok: false, reason: "Missing id column" };
  }

  let foundRowNumber = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowId = String(row[idIndex] || "").trim();

    if (rowId === String(id || "").trim()) {
      foundRowNumber = i + 1;
      break;
    }
  }

  if (!foundRowNumber) {
    return { ok: false, reason: "Story id not found" };
  }

  if (publishIndex !== -1) {
    const colLetter = String.fromCharCode(65 + publishIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!${colLetter}${foundRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[String(Boolean(publish))]],
      },
    });
  }

  if (privacyIndex !== -1) {
    const colLetter = String.fromCharCode(65 + privacyIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!${colLetter}${foundRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[publish ? "share" : "private"]],
      },
    });
  }

  return { ok: true, id, publish: Boolean(publish) };
}

export async function getStoriesByUser({ user_id, onlyPublic = false }) {
  const { rows } = await getSheetRows();

  if (!rows.length) return [];

  const headers = rows[0];
  const data = rows.slice(1);

  const userIndex = findHeaderIndex(headers, "user_id");
  if (userIndex === -1) return [];

  const stories = data
    .filter((row) => String(row[userIndex] || "") === String(user_id))
    .map((row) => {
      const publishValue = pickFirst(row, headers, ["publish"]);
      const privacyValue = String(pickFirst(row, headers, ["privacy"])).trim().toLowerCase();
      const publish =
        publishValue !== ""
          ? toBool(publishValue)
          : privacyValue === "share" || privacyValue === "public";

      const polished = pickFirst(row, headers, ["polished_story_text"]);
      const storyText = pickFirst(row, headers, ["story_text"]);
      const transcript = pickFirst(row, headers, ["transcript_text"]);

      return {
        id: pickFirst(row, headers, ["id"]),
        user_id: pickFirst(row, headers, ["user_id"]),
        title: pickFirst(row, headers, ["title"]),
        story_text: polished || storyText || transcript || "",
        transcript_text: transcript || storyText || "",
        polished_story_text: polished || storyText || "",
        publish,
        privacy: privacyValue || (publish ? "share" : "private"),
        audio_url: pickFirst(row, headers, ["audio_url"]),
        created_at: pickFirst(row, headers, ["created_at"]),
        updated_at: pickFirst(row, headers, ["updated_at"]),
      };
    })
    .filter((story) => (onlyPublic ? story.publish === true : true));

  return stories;
}