import { google } from "googleapis";
import path from "path";

const KEY_FILE_PATH = path.join(
  process.cwd(),
  "secrets",
  "kahaanibot-243ea048849f.json"
);

function getCredentialsFromEnv() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  const parsed = JSON.parse(raw);

  // Sometimes private_key comes in with literal "\n"
  if (parsed.private_key && parsed.private_key.includes("\\n")) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

export async function getSheetsClient() {
  const creds = getCredentialsFromEnv();

  const auth = new google.auth.GoogleAuth({
    ...(creds ? { credentials: creds } : { keyFile: KEY_FILE_PATH }),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const client = await auth.getClient();

  return google.sheets({
    version: "v4",
    auth: client,
  });
}

export async function readRange({ spreadsheetId, range }) {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values || [];
}