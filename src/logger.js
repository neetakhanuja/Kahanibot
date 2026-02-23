import { getSheetsClient } from "./sheets.js";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-J0cHIQvz9r13lCft15Shb7gLnBF2798DOoJ8OKC5Tc";
const TAB = "logs";
const RANGE = `${TAB}!A:D`;

function isoNow() {
  return new Date().toISOString();
}

export async function logEvent({ user_id, event, details = "" }) {
  try {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: RANGE,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[isoNow(), user_id, event, details]],
      },
    });
  } catch (err) {
    // Logging should never break the bot
    console.error("logEvent failed:", err?.message || err);
  }
}