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

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
}

// HOME (optional simple instructions)
app.get("/", (req, res) => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Kahanibot</title>
      </head>
      <body style="font-family: system-ui, Arial; max-width: 780px; margin: 40px auto; padding: 0 16px; color:#111;">
        <h1 style="margin:0 0 8px 0;">Kahanibot</h1>
        <p style="margin:0 0 16px 0; color:#444;">
          Public stories are available at <code>/u/&lt;userId&gt;</code>
        </p>
        <p style="margin:0; color:#444;">
          Example: <code>/u/test-user</code>
        </p>
      </body>
    </html>
  `;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// PUBLIC STORY PAGE (nicer layout)
app.get("/u/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const stories = await getStoriesByUser({
      user_id: userId,
      onlyPublic: true,
    });

    if (!stories.length) {
      return res
        .status(404)
        .send("No public stories found for this user.");
    }

    // Newest first
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
            background: #fff;
            border: 1px solid #e6e6e6;
            border-radius: 12px;
            padding: 16px;
            margin: 16px 0;
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

// INCOMING WEBHOOK EVENTS (still logs only for now)
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