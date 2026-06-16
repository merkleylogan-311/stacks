/**
 * Stacks — Claude-powered book recommendation Cloud Function.
 *
 * Exposes a single HTTPS *callable* (`recommendBooks`). Callables verify the
 * Firebase Auth token automatically (request.auth), so the client never handles
 * the Anthropic key — it lives only here, as a Functions secret.
 *
 * Flow: client sends a taste profile → we throttle per-user via Firestore →
 * call Claude Haiku 4.5 with structured output → return ranked {title, author,
 * reason} recs. The client hydrates those titles through its existing Google
 * Books pipeline (covers, metadata, dedupe) and verifies they exist.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const db = admin.firestore();

// Set with:  firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MODEL = "claude-haiku-4-5";
const MIN_INTERVAL_MS = 60 * 1000; // server-side throttle: ≤ 1 generation per user per minute
const MAX_RECS = 30;

// Stable system prompt — kept byte-identical across requests so it can be cached.
// NOTE: Haiku 4.5's prompt-cache minimum prefix is 4096 tokens; this prompt is well
// under that, so caching won't actually engage yet (cache_read stays 0). The
// cache_control breakpoint is in place so it kicks in automatically if the prompt
// grows past the threshold — and it's harmless below it.
const SYSTEM_PROMPT = `You are the recommendation engine for Stacks, a book discovery and tracking app.

You receive a reader's taste signals and return a ranked list of book recommendations.

Signals you may receive:
- LIKED: books they rated 4-5 stars (strongest positive signal)
- RECENT: books they finished recently
- SAVED: books saved to their library but not yet read
- PASSED: books they explicitly rejected (negative signal — avoid these authors/themes unless strongly indicated otherwise)
- EXCLUDE: titles they have already seen — never recommend any of these

Rules:
1. Recommend only real, published books that genuinely exist. Do NOT invent titles or authors. If unsure a book is real, don't include it.
2. Prefer well-known, well-reviewed books a reader is likely to find on Open Library / Google Books.
3. Never recommend any title in EXCLUDE, and never recommend a book by an author that appears repeatedly in PASSED unless their LIKED list strongly suggests otherwise.
4. Synthesize taste — infer themes, tone, and style from LIKED/RECENT (e.g. "character-driven literary fiction", "fast-paced thrillers", "narrative non-fiction"). Mix safe in-taste picks with a few thoughtful adjacent discoveries.
5. Spread across the reader's evident genres rather than returning 20 books by one author.
6. For each recommendation, give a SHORT reason (one sentence) grounded in their signals.
7. Return 20-30 recommendations, best first.

Output must match the provided JSON schema exactly.`;

const RECS_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          author: { type: "string" },
          reason: { type: "string" },
        },
        required: ["title", "author", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
};

// Trim a client-supplied list to a sane size and shape so a malformed/huge
// payload can't blow up the prompt or cost.
function clampList(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map((b) => ({
    title: String(b?.title || "").slice(0, 200),
    author: String(b?.author || "").slice(0, 200),
    rating: typeof b?.rating === "number" ? b.rating : undefined,
  }));
}

function fmtBooks(list) {
  return list
    .map((b) => {
      const r = b.rating ? ` (${b.rating}★)` : "";
      const a = b.author ? ` — ${b.author}` : "";
      return `- ${b.title}${a}${r}`;
    })
    .join("\n");
}

function buildUserMessage({ liked, recent, saved, passed, exclude }) {
  const parts = [];
  if (liked.length) parts.push(`LIKED (rated 4-5★):\n${fmtBooks(liked)}`);
  if (recent.length) parts.push(`RECENT reads:\n${fmtBooks(recent)}`);
  if (saved.length) parts.push(`SAVED (unread):\n${fmtBooks(saved)}`);
  if (passed.length) parts.push(`PASSED (rejected):\n${fmtBooks(passed)}`);
  if (exclude.length) {
    // Titles only — keep this compact, it can be long.
    parts.push(`EXCLUDE (already seen, never recommend):\n${exclude.map((b) => `- ${b.title}`).join("\n")}`);
  }
  if (!liked.length && !recent.length && !saved.length) {
    parts.push("The reader has little history yet — recommend broadly popular, critically-loved books across major genres.");
  }
  parts.push("Return 20-30 recommendations as JSON matching the schema.");
  return parts.join("\n\n");
}

exports.recommendBooks = onCall(
  { secrets: [ANTHROPIC_API_KEY], cors: true },
  async (request) => {
    // 1. Auth — callables populate request.auth from the verified Firebase token.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to get personalized recommendations.");
    }
    const uid = request.auth.uid;

    // 2. Per-user throttle (Firestore). Admin SDK bypasses security rules.
    const metaRef = db.collection("users").doc(uid).collection("private").doc("recsMeta");
    const metaSnap = await metaRef.get();
    const now = Date.now();
    const prev = metaSnap.exists ? metaSnap.data() : {};
    if (prev.lastRunAt && now - prev.lastRunAt < MIN_INTERVAL_MS) {
      throw new HttpsError("resource-exhausted", "Recommendations were just refreshed — try again in a minute.");
    }

    // 3. Validate + clamp the taste profile the client sent.
    const profile = request.data && request.data.profile ? request.data.profile : {};
    const liked = clampList(profile.liked, 60);
    const recent = clampList(profile.recent, 30);
    const saved = clampList(profile.saved, 60);
    const passed = clampList(profile.passed, 60);
    const exclude = clampList(profile.exclude, 400);

    // 4. Call Claude. System prompt is the cached prefix; the volatile taste
    //    profile goes in the user turn, after the cache breakpoint.
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let message;
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: RECS_SCHEMA } },
        messages: [{ role: "user", content: buildUserMessage({ liked, recent, saved, passed, exclude }) }],
      });
    } catch (e) {
      console.error("Anthropic request failed:", e?.status, e?.message);
      throw new HttpsError("internal", "Recommendation service is temporarily unavailable.");
    }

    // 5. Parse structured output (output_config.format guarantees the first text block is valid JSON).
    const textBlock = message.content.find((b) => b.type === "text");
    let recs = [];
    try {
      const parsed = JSON.parse(textBlock.text);
      recs = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, MAX_RECS) : [];
    } catch (e) {
      console.error("Failed to parse recommendations JSON:", e?.message);
      throw new HttpsError("internal", "Could not parse recommendations.");
    }

    // 6. Record the throttle timestamp (best-effort) + log token usage.
    metaRef
      .set({ lastRunAt: now, runCount: (prev.runCount || 0) + 1 }, { merge: true })
      .catch((e) => console.warn("recsMeta write failed:", e?.message));
    if (message.usage) {
      console.log(
        `recommendBooks uid=${uid} in=${message.usage.input_tokens} out=${message.usage.output_tokens} ` +
          `cacheRead=${message.usage.cache_read_input_tokens || 0} recs=${recs.length}`
      );
    }

    return { recommendations: recs, generatedAt: now };
  }
);
