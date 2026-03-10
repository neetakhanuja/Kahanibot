// server.js
import "dotenv/config";
import express from "express";
import path from "path";
import * as convo from "./src/conversation.js";
import { getStoriesByUser } from "./src/storyStore.js";

const app = express();

app.use(express.static("public"));
app.use("/cards", express.static("cards"));
app.use(express.json());

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
}

// Health
app.get("/health", (req, res) => res.status(200).send("OK"));

// Web App UI
app.get("/app", (req, res) => {
  res.sendFile(path.resolve("public", "index.html"));
});

// ✅ DST Builder API endpoint
app.post("/api/turn", async (req, res) => {
  try {
    const { user_id, text, lang, seed_prompt } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const out = await convo.handleAppTurn({
      user_id: String(user_id),
      text: String(text || ""),
      lang: lang ? String(lang) : undefined,
      seed_prompt:
        seed_prompt !== undefined ? String(seed_prompt) : undefined,
    });

    // IMPORTANT: return full object
    return res.json(out);
  } catch (err) {
    console.error("Error in /api/turn:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Public stories page
app.get("/u/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const stories = await getStoriesByUser({
      user_id: userId,
      onlyPublic: true,
    });

    if (!stories.length) {
      return res.status(404).send("No public stories found for this user.");
    }

    const sorted = [...stories].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    const itemsHtml = sorted
      .map((s) => {
        const date = escapeHtml(formatDate(s.created_at));
        const text = escapeHtml(s.story_text).replaceAll("\n", "<br/>");

        return `
          <article style="
            background:#fff;
            border:1px solid #e6e6e6;
            border-radius:12px;
            padding:16px;
            margin:16px 0;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          ">
            <div style="color:#666; font-size:13px; margin-bottom:10px;">
              ${date}
            </div>
            <div style="font-size:16px; line-height:1.7; color:#111;">
              ${text}
            </div>
          </article>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Stories by ${escapeHtml(userId)}</title>
        </head>
        <body style="font-family: system-ui, Arial; background:#fafafa; color:#111;">
          <div style="max-width: 780px; margin: 40px auto; padding: 0 16px;">
            <h1 style="margin:0 0 8px 0;">Stories by ${escapeHtml(userId)}</h1>
            <div style="color:#444; margin-bottom: 20px;">
              Showing public stories only.
            </div>
            ${itemsHtml}
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    console.error("Error in /u/:userId:", err);
    res.status(500).send("Server error");
  }
});

// WhatsApp webhook test route
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    return res.status(200).json({
      ok: true,
      message: "Webhook received"
    });
  } catch (err) {
    console.error("Error in /webhook:", err);
    return res.status(500).json({ error: "Webhook server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));