// src/ai.js
// Minimal OpenAI wrapper for Kahanibot (reflection + question) + story polish.

const AI_ENABLED = String(process.env.AI_ENABLED || "").toLowerCase() === "true";
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Startup logs
console.log("[AI] AI_ENABLED:", AI_ENABLED);
console.log("[AI] AI_MODEL:", AI_MODEL);
console.log("[AI] OPENAI_API_KEY loaded:", OPENAI_API_KEY ? "yes" : "no");
console.log("[AI] Node version:", process.version);
console.log("[AI] typeof fetch:", typeof fetch);

function langLabel(lang) {
  if (lang === "hi") return "Hindi";
  if (lang === "gu") return "Gujarati";
  return "English";
}

function hardLimitLines(text, maxLines) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}

async function callOpenAI({ system, user, temperature = 0.5 }) {
  console.log("[AI] callOpenAI entered");

  if (!AI_ENABLED) {
    console.log("[AI] AI disabled");
    return null;
  }

  if (!OPENAI_API_KEY) {
    console.log("[AI] Missing OPENAI_API_KEY");
    return null;
  }

  try {
    console.log("[AI] Sending request to OpenAI...");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    console.log("[AI] Response status:", res.status);

    if (!res.ok) {
      const errText = await res.text();
      console.log("[AI] OpenAI HTTP error:", errText);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      console.log("[AI] No content returned:", JSON.stringify(data));
      return null;
    }

    console.log("[AI] OpenAI returned text");
    return String(text).trim();
  } catch (err) {
    console.log("[AI] Exception:", err?.message || err);
    return null;
  }
}

export async function generateReflectionAndQuestion({ lang, story_text }) {
  console.log("[AI] generateReflectionAndQuestion CALLED", {
    lang,
    storyChars: String(story_text || "").length,
  });

  try {
    const system =
      `You are a warm and simple storytelling companion for older adults.\n` +
      `Write in ${langLabel(lang)}.\n` +
      `Tone:\n` +
      `- Warm but simple.\n` +
      `- Do not exaggerate emotions.\n` +
      `- Do not interpret feelings beyond what is said.\n` +
      `- Use clear and plain language.\n` +
      `Rules:\n` +
      `- Do not give advice.\n` +
      `- Do not assume anything not stated.\n` +
      `- Keep it short.\n` +
      `Output EXACTLY 2 lines:\n` +
      `Line 1: one simple acknowledgment of what was shared.\n` +
      `Line 2: one gentle, open question.\n` +
      `No extra lines. No explanations.`;

    const user = `Story:\n${story_text}\n\nReturn exactly 2 sentences.`;

    const out = await callOpenAI({ system, user, temperature: 0.5 });

    if (!out) {
      console.log("[AI] OpenAI returned null");
      return null;
    }

    const cleaned = hardLimitLines(out, 2);
    const lines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      const reflection = lines[0];
      const question = lines[1];
      console.log("[AI] SUCCESS (2 lines)");
      return {
        reflection,
        question,
        combined: `${reflection}\n${question}`,
      };
    }

    // If model returned one line, split by sentence instead
    console.log("[AI] Single line returned, attempting sentence split");
    const one = String(out).trim();
    const parts = one.split(/(?<=[.?!।])\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const reflection = parts[0].trim();
      const question = parts.slice(1).join(" ").trim();
      return {
        reflection,
        question,
        combined: `${reflection}\n${question}`,
      };
    }

    // Fallback
    return {
      reflection: one,
      question:
        lang === "hi"
          ? "और क्या याद आता है?"
          : lang === "gu"
          ? "આ પછી શું થયું?"
          : "What happened next?",
      combined:
        lang === "hi"
          ? `${one}\nऔर क्या याद आता है?`
          : lang === "gu"
          ? `${one}\nઆ પછી શું થયું?`
          : `${one}\nWhat happened next?`,
    };
  } catch (err) {
    console.log("[AI] generateReflectionAndQuestion exception:", err?.message || err);
    return null;
  }
}

/**
 * NEW: Polish/clean the final story for REVIEW + saving.
 * Returns: { title, body } OR null if AI disabled/fails.
 */
export async function polishStory({ lang, story_text }) {
  console.log("[AI] polishStory CALLED", {
    lang,
    storyChars: String(story_text || "").length,
  });

  const raw = String(story_text || "").trim();
  if (!raw) return null;

  const system =
    `You edit spoken transcripts into a clean short story draft for older adults.\n` +
    `Write in ${langLabel(lang)}.\n` +
    `Goals:\n` +
    `- Keep the person's original wording and meaning.\n` +
    `- Remove obvious duplicate lines and repeated fragments.\n` +
    `- Fix small speech-to-text mistakes only when very confident.\n` +
    `- Do not add new events.\n` +
    `- Do not add moral lessons or advice.\n` +
    `Format:\n` +
    `Return ONLY valid JSON with keys: "title" and "body".\n` +
    `Title: short (max 8 words).\n` +
    `Body: 70-140 words if possible, in 1-2 short paragraphs.\n`;

  const user =
    `Transcript (may contain repeats):\n` +
    `${raw}\n\n` +
    `Return JSON only.`;

  const out = await callOpenAI({ system, user, temperature: 0.3 });
  if (!out) return null;

  // Try parse JSON
  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    const jsonStr = start >= 0 && end >= 0 ? out.slice(start, end + 1) : out;
    const obj = JSON.parse(jsonStr);

    const title = String(obj.title || "").trim();
    const body = String(obj.body || "").trim();

    if (!body) return null;

    return {
      title: title || "A Memory",
      body,
    };
  } catch (e) {
    console.log("[AI] polishStory JSON parse failed:", e?.message || e);
    return null;
  }
}