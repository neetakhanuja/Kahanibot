import crypto from "crypto";
import { getSheetsClient, readRange } from "./sheets.js";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-J0cHIQvz9r13lCft15Shb7gLnBF2798DOoJ8OKC5Tc";
const TAB_NAME = process.env.GOOGLE_SHEET_TAB || "stories";
const RANGE = `${TAB_NAME}!A:E`;

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

export async function saveStory({ user_id, story_text, publish = false }) {
  const sheets = await getSheetsClient();

  const id = makeId();
  const created_at = new Date().toISOString();

  const row = [id, user_id, story_text, String(publish), created_at];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });

  return { id, user_id, story_text, publish, created_at };
}

export async function updatePublishStatus({ id, publish }) {
  const sheets = await getSheetsClient();

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
  });

  const values = read.data.values || [];

  if (values.length <= 1) {
    return { ok: false, reason: "No data rows found" };
  }

  let foundRowNumber = null;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowId = (row?.[0] || "").trim();

    if (rowId === id) {
      foundRowNumber = i + 1;
      break;
    }
  }

  if (!foundRowNumber) {
    return { ok: false, reason: "Story id not found" };
  }

  const publishCellRange = `${TAB_NAME}!D${foundRowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: publishCellRange,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[String(publish)]],
    },
  });

  return { ok: true, id, publish };
}

export async function getStoriesByUser({ user_id, onlyPublic = false }) {
  const rows = await readRange({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A1:E`,
  });

  if (!rows.length) return [];

  const headers = rows[0];
  const data = rows.slice(1);

  const userIndex = headers.indexOf("user_id");
  const storyIndex = headers.indexOf("story_text");
  const publishIndex = headers.indexOf("publish");
  const createdIndex = headers.indexOf("created_at");
  const idIndex = headers.indexOf("id");

  if (userIndex === -1) return [];

  const stories = data
    .filter((row) => String(row[userIndex] || "") === String(user_id))
    .map((row) => ({
      id: row[idIndex] || "",
      user_id: row[userIndex] || "",
      story_text: row[storyIndex] || "",
      publish: toBool(row[publishIndex]),
      created_at: row[createdIndex] || "",
    }))
    .filter((story) => (onlyPublic ? story.publish === true : true));

  return stories;
}