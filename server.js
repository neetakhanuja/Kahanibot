import "dotenv/config";
import express from "express";
import path from "path";
import FormData from "form-data";
import * as convo from "./src/conversation.js";
import { getStoriesByUser } from "./src/storyStore.js";

const app = express();

app.use(express.static("public"));
app.use("/cards", express.static("cards"));
app.use(express.json({ limit: "10mb" }));

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

async function sendWhatsAppText(to, text) {
  if (!process.env.WASENDER_API_KEY) {
    throw new Error("Missing WASENDER_API_KEY");
  }

  const res = await fetch("https://www.wasenderapi.com/api/send-message", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: String(to || "").trim(),
      text: String(text || "").trim(),
    }),
  });

  const data = await res.json().catch(() => null);
  console.log("Wasender send response:", data);

  if (!res.ok) {
    throw new Error(`Wasender send failed with status ${res.status}`);
  }

  return data;
}

function extractIncomingMessage(body) {
  return body?.data?.messages || null;
}

function extractSenderPhone(msg) {
  return String(msg?.key?.cleanedSenderPn || "").trim();
}

function extractMessageText(msg) {
  return String(msg?.messageBody || "").trim();
}

function extractAudioMessage(msg) {
  return (
    msg?.message?.audioMessage ||
    msg?.message?.pttMessage ||
    msg?.audioMessage ||
    null
  );
}

async function decryptWasenderMedia(message) {
  try {
    if (!process.env.WASENDER_API_KEY) {
      throw new Error("Missing WASENDER_API_KEY");
    }

    const requestBody = {
      data: {
        messages: message,
      },
    };

    console.log("Wasender decrypt request body:", JSON.stringify(requestBody, null, 2));

    const res = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await res.json().catch(() => null);
    console.log("Wasender decrypt response:", data);

    if (!res.ok) {
      throw new Error(`Wasender decrypt failed with status ${res.status}`);
    }

    const mediaUrl =
    data?.publicUrl ||
    data?.url ||
    data?.media_url ||
    data?.downloadUrl ||
    data?.download_url ||
    data?.data?.publicUrl ||
    data?.data?.url ||
    data?.data?.media_url ||
    data?.data?.downloadUrl ||
    data?.data?.download_url ||
      null;

    return mediaUrl ? String(mediaUrl).trim() : null;
  } catch (err) {
    console.error("Media decrypt error:", err);
    return null;
  }
}

async function transcribeAudioFromUrl(mediaUrl) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY");
    }

    if (!mediaUrl) {
      throw new Error("Missing mediaUrl");
    }

    const audioRes = await fetch(mediaUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to download audio: ${audioRes.status}`);
    }

    const contentType =
      audioRes.headers.get("content-type") || "audio/ogg";
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const formData = new FormData();
    formData.append("file", audioBuffer, {
      filename: "voice.ogg",
      contentType,
    });
    formData.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => "");
      throw new Error(`Whisper transcription failed: ${whisperRes.status} ${errText}`);
    }

    const json = await whisperRes.json();
    return String(json?.text || "").trim();
  } catch (err) {
    console.error("Audio transcription error:", err);
    return "";
  }
}

// Health
app.get("/health", (req, res) => res.status(200).send("OK"));

// Optional web app route
app.get("/app", (req, res) => {
  res.sendFile(path.resolve("public", "index.html"));
});

// Local testing route
app.post("/api/turn", async (req, res) => {
  try {
    const { user_id, text, lang } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const out = await convo.handleAppTurn({
      user_id: String(user_id),
      text: String(text || ""),
      lang: lang ? String(lang) : undefined,
    });

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
        const title = escapeHtml(s.title || "");
        const text = escapeHtml(s.story_text || "").replaceAll("\n", "<br/>");
        const audioUrl = String(s.audio_url || "").trim();

        return `
          <article style="
            background:#fff;
            border:1px solid #e6e6e6;
            border-radius:12px;
            padding:16px;
            margin:16px 0;
            box-shadow:0 1px 2px rgba(0,0,0,0.04);
          ">
            <div style="color:#666; font-size:13px; margin-bottom:10px;">
              ${date}
            </div>
            ${
              title
                ? `<h2 style="font-size:18px; margin:0 0 10px 0; color:#111;">${title}</h2>`
                : ""
            }
            <div style="font-size:16px; line-height:1.7; color:#111;">
              ${text}
            </div>
            ${
              audioUrl
                ? `<div style="margin-top:14px;">
                    <audio controls preload="none" style="width:100%;">
                      <source src="${escapeHtml(audioUrl)}" />
                    </audio>
                   </div>`
                : ""
            }
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
        <body style="font-family:system-ui,Arial; background:#fafafa; color:#111;">
          <div style="max-width:780px; margin:40px auto; padding:0 16px;">
            <h1 style="margin:0 0 8px 0;">Stories by ${escapeHtml(userId)}</h1>
            <div style="color:#444; margin-bottom:20px;">
              Showing public stories only.
            </div>
            ${itemsHtml}
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("Error in /u/:userId:", err);
    return res.status(500).send("Server error");
  }
});

// WhatsApp webhook
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    // Acknowledge immediately
    res.status(200).json({ ok: true });

    const event = req.body?.event;
    if (event !== "messages.received") return;

    const msg = extractIncomingMessage(req.body);
    if (!msg) return;
    if (msg?.key?.fromMe) return;

    const to = extractSenderPhone(msg);
    if (!to) return;

    let text = extractMessageText(msg);

    // Voice note pipeline:
    // webhook -> decrypt media -> download audio -> transcribe -> conversation engine
    if (!text) {
      const audioMsg = extractAudioMessage(msg);

      if (audioMsg) {
        console.log("Voice message detected");

        const decryptedUrl = await decryptWasenderMedia(msg);
        if (!decryptedUrl) {
          console.log("Could not decrypt media URL");
          await sendWhatsAppText(
            to,
            "I received your voice note, but I could not open it properly. Please try sending it again."
          );
          return;
        }

        console.log("Decrypted media URL:", decryptedUrl);

        text = await transcribeAudioFromUrl(decryptedUrl);
        console.log("Transcribed audio:", text);

        if (!text) {
          await sendWhatsAppText(
            to,
            "I could not understand that voice note clearly. Please try again, or send your story as text."
          );
          return;
        }
      }
    }

    if (!text) return;

    const reply = await convo.handleMessage({
      from: to,
      text,
    });

    console.log("Bot reply:", reply);

    if (!reply) return;

    await sendWhatsAppText(to, reply);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));