// src/ai.js
// DST-style AI probing + reflection for Kahanibot

const AI_ENABLED =
  String(process.env.AI_ENABLED || "").toLowerCase() === "true";

const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Startup logs
console.log("[AI] AI_ENABLED:", AI_ENABLED);
console.log("[AI] AI_MODEL:", AI_MODEL);
console.log(
  "[AI] OPENAI_API_KEY loaded:",
  OPENAI_API_KEY ? "yes" : "no"
);
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

async function callOpenAI({ system, user }) {
  if (!AI_ENABLED) {
    console.log("[AI] AI disabled");
    return null;
  }

  if (!OPENAI_API_KEY) {
    console.log("[AI] Missing OPENAI_API_KEY");
    return null;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.5,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log("[AI] OpenAI HTTP error:", errText);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      console.log("[AI] No content returned");
      return null;
    }

    return String(text).trim();
  } catch (err) {
    console.log("[AI] Exception:", err?.message || err);
    return null;
  }
}

// ---------------------------
// MAIN DST PROBING FUNCTION
// ---------------------------
export async function generateReflectionAndQuestion({
  lang,
  story_text,
}) {
  try {
    const system = `
You are a warm storytelling companion for older adults.
Write in ${langLabel(lang)}.

Goal:
Help the person deepen their memory naturally.

Rules:
- Output EXACTLY 2 lines.
- Line 1: A short acknowledgment mentioning something specific from the story.
- Line 2: One open question about a concrete detail (person, place, action, or moment).
- Do NOT say "tell me more".
- Do NOT give advice.
- Do NOT invent details.
- Keep both lines short and simple.
- Use respectful tone.
`;

    const user = `
Story so far:
${story_text}

Return exactly 2 short lines.
`;

    const out = await callOpenAI({ system, user });

    if (!out) return null;

    const cleaned = hardLimitLines(out, 2);
    const lines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      return {
        reflection: lines[0],
        question: lines[1],
        combined: `${lines[0]}\n${lines[1]}`,
      };
    }

    // fallback: try sentence split
    const sentences = out
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length >= 2) {
      return {
        reflection: sentences[0],
        question: sentences[1],
        combined: `${sentences[0]}\n${sentences[1]}`,
      };
    }

    return null;
  } catch (err) {
    console.log(
      "[AI] generateReflectionAndQuestion exception:",
      err?.message || err
    );
    return null;
  }
}

// Keep this for future expansion
export async function extractMemories() {
  return null;
}