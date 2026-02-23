import { normalizeYesNo, makeDraft } from "./storyEngine.js";
import { saveStory, updatePublishStatus } from "./storyStore.js";

// In-memory sessions (simple for pilot)
const sessions = new Map();

const STATES = {
  IDLE: "IDLE",
  COLLECTING: "COLLECTING",
  REVIEW: "REVIEW",
  ASK_PUBLISH: "ASK_PUBLISH",
};

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      state: STATES.IDLE,
      transcript: "",
      storyId: null,
    });
  }
  return sessions.get(userId);
}

function isDone(text) {
  const t = (text || "").trim().toLowerCase();
  return ["done", "finish", "finished", "end", "stop"].includes(t);
}

export async function handleMessage({ from, text }) {
  const s = getSession(from);
  const clean = (text || "").trim();

  // Reset (helpful for testing)
  if (clean.toLowerCase() === "reset") {
    sessions.delete(from);
    return "Reset done. Send a message to start your story.";
  }

  // ===== IDLE STATE =====
  if (s.state === STATES.IDLE) {
    const greetingWords = ["hello", "hi", "hey", "namaste", "hola"];
    const lower = clean.toLowerCase();

    s.state = STATES.COLLECTING;
    s.transcript = "";
    s.storyId = null;

    // If only greeting, do not store it
    if (greetingWords.includes(lower)) {
      return "Hello. Tell me your story. When you are finished, type DONE.";
    }

    // Otherwise treat first message as story content
    s.transcript = clean;
    return "Got it. Keep going. Type DONE when finished.";
  }

  // ===== COLLECTING STATE =====
  if (s.state === STATES.COLLECTING) {
    if (isDone(clean)) {
      if (!s.transcript.trim()) {
        return "I did not get any story text yet. Please type your story, then type DONE.";
      }

      const draft = makeDraft(s.transcript);
      s.state = STATES.REVIEW;

      return `Here is your draft:\n\n${draft.storyBody}\n\nReply YES to save, or NO to rewrite.`;
    }

    s.transcript += (s.transcript ? "\n" : "") + clean;
    return "Got it. Keep going. Type DONE when finished.";
  }

  // ===== REVIEW STATE =====
  if (s.state === STATES.REVIEW) {
    const yn = normalizeYesNo(clean);

    if (yn === "NO") {
      s.state = STATES.COLLECTING;
      s.transcript = "";
      s.storyId = null;
      return "Okay. Please tell your story again. Type DONE when finished.";
    }

    if (yn === "YES") {
      const saved = await saveStory({
        user_id: from,
        story_text: s.transcript,
        publish: false,
      });

      s.storyId = saved.id;
      s.state = STATES.ASK_PUBLISH;

      return "Saved. Do you want to publish it publicly? Reply YES or NO.";
    }

    return "Please reply YES to save, or NO to rewrite.";
  }

  // ===== ASK PUBLISH STATE =====
  if (s.state === STATES.ASK_PUBLISH) {
    const yn = normalizeYesNo(clean);

    if (yn === "YES") {
      await updatePublishStatus({ id: s.storyId, publish: true });
      sessions.delete(from);
      return "Published. Thank you. Send a new message to start another story.";
    }

    if (yn === "NO") {
      await updatePublishStatus({ id: s.storyId, publish: false });
      sessions.delete(from);
      return "Saved privately. Thank you. Send a new message to start another story.";
    }

    return "Please reply YES to publish publicly, or NO to keep it private.";
  }

  // Fallback safety
  sessions.delete(from);
  return "Send a message to start your story.";
}