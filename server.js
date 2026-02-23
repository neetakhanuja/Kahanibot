import "dotenv/config";
import express from "express";
import { handleMessage } from "./src/conversation.js";
import { getStoriesByUser } from "./src/storyStore.js";

const app = express();
app.use(express.json());

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// PUBLIC STORY PAGE
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

    const itemsHtml = stories
      .map((s) => {
        const date = escapeHtml(s.created_at);
        const text = escapeHtml(s.story_text).replaceAll("\n", "<br/>");

        return `
          <article style="padding:16px 0; border-bottom:1px solid #eee;">
            <div style="color:#666; font-size:14px;">${date}</div>
            <div style="margin-top:8px; line-height:1.6;">${text}</div>
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
          <title>Kahanibot Stories</title>
        </head>
        <body style="font-family: system-ui, Arial; max-width: 720px; margin: 40px auto; padding: 0 16px;">
          <h1>Stories by ${escapeHtml(userId)}</h1>
          ${itemsHtml}
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

// WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// INCOMING WEBHOOK EVENTS
app.post("/webhook", (req, res) => {
  console.log("==== INCOMING WEBHOOK ====");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("==========================");
  res.sendStatus(200);
});

// LOCAL SIMULATION ROUTE
app.post("/simulate", async (req, res) => {
  const { from, text } = req.body;

  const reply = await handleMessage({ from, text });

  res.json({
    to: from,
    reply,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});