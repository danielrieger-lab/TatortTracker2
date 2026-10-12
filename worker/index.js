const SESSION_COOKIE = "tt_session";
const SESSION_DAYS = 30;
const PIN_ITERATIONS = 120000;

export default {
  async fetch(request, env) {
    const origin = env.FRONTEND_ORIGIN || new URL(request.url).origin;
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404, headers);
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true }, 200, headers);
      }
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        return register(request, env, headers);
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return login(request, env, headers);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return logout(request, env, headers);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        return me(request, env, headers);
      }
      const codeMatch = url.pathname.match(/^\/api\/users\/by-code\/(\d{4})$/);
      if (codeMatch && request.method === "GET") {
        return findByCode(codeMatch[1], env, headers);
      }
      const episodeMatch = url.pathname.match(/^\/api\/episodes\/([a-zA-Z0-9_-]+)\/activity$/);
      if (episodeMatch && request.method === "GET") {
        return episodeActivity(episodeMatch[1], env, headers);
      }
      if (url.pathname === "/api/ratings" && request.method === "POST") {
        return saveRating(request, env, headers);
      }
      if (url.pathname === "/api/comments" && request.method === "POST") {
        return addComment(request, env, headers);
      }
      if (url.pathname === "/api/follows" && (request.method === "POST" || request.method === "DELETE")) {
        return changeFollow(request, env, headers);
      }
      if (url.pathname === "/api/blocks" && (request.method === "POST" || request.method === "DELETE")) {
        return changeBlock(request, env, headers);
      }
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500, headers);
    }
  },
};

async function register(request, env, headers) {
  const body = await readJson(request);
  const username = cleanUsername(body.username);
  const pin = cleanPin(body.pin);
  if (!username || username.length < 3 || username.length > 24 || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return json({ error: "Username must be 3-24 letters, numbers, or underscores." }, 400, headers);
  }
  if (!pin || pin.length < 6 || pin.length > 32) {
    return json({ error: "PIN must contain 6-32 characters." }, 400, headers);
  }

  const normalized = username.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username_normalized = ?1").bind(normalized).first();
  if (existing) return json({ error: "Username is already taken." }, 409, headers);

  const pinHash = await hashPin(pin);
  let friendCode;
  let userId;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    friendCode = randomCode();
    const collision = await env.DB.prepare("SELECT id FROM users WHERE friend_code = ?1").bind(friendCode).first();
    if (!collision) {
      userId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO users (id, username, username_normalized, pin_hash, friend_code) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(userId, username, normalized, pinHash, friendCode)
        .run();
      break;
    }
  }
  if (!userId) return json({ error: "Could not allocate a friend code. Try again." }, 503, headers);

  return createSessionResponse(userId, { id: userId, username, friendCode }, env, headers, 201);
}

async function login(request, env, headers) {
  const body = await readJson(request);
  const username = cleanUsername(body.username);
  const pin = cleanPin(body.pin);
  const user = await env.DB.prepare("SELECT id, username, friend_code, pin_hash FROM users WHERE username_normalized = ?1")
    .bind(username.toLowerCase()).first();
  if (!user || !(await verifyPin(pin, user.pin_hash))) {
    return json({ error: "Invalid username or PIN." }, 401, headers);
  }
  return createSessionResponse(user.id, { id: user.id, username: user.username, friendCode: user.friend_code }, env, headers, 200);
}

async function logout(request, env, headers) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await digest(token)).run();
  headers.set("Set-Cookie", clearCookie());
  return json({ ok: true }, 200, headers);
}

async function me(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ user: null }, 200, headers);
  return json({ user }, 200, headers);
}

async function findByCode(code, env, headers) {
  const user = await env.DB.prepare("SELECT id, username, friend_code FROM users WHERE friend_code = ?1").bind(code).first();
  return json({ user: user ? { id: user.id, username: user.username, friendCode: user.friend_code } : null }, 200, headers);
}

async function episodeActivity(episodeId, env, headers) {
  const summary = await env.DB.prepare("SELECT COUNT(*) AS count, ROUND(AVG(score), 1) AS average FROM ratings WHERE episode_id = ?1").bind(episodeId).first();
  const comments = await env.DB.prepare("SELECT comments.id, comments.body, comments.created_at AS createdAt, users.username FROM comments JOIN users ON users.id = comments.user_id WHERE comments.episode_id = ?1 ORDER BY comments.created_at DESC LIMIT 50").bind(episodeId).all();
  return json({ rating: { count: summary?.count || 0, average: summary?.average || null }, comments: comments.results || [] }, 200, headers);
}

async function saveRating(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const episodeId = cleanEpisodeId(body.episodeId);
  const score = Number(body.score);
  if (!episodeId || !Number.isInteger(score) || score < 1 || score > 10) {
    return json({ error: "Episode and a score from 1 to 10 are required." }, 400, headers);
  }
  await env.DB.prepare("INSERT INTO ratings (user_id, episode_id, score) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, episode_id) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP")
    .bind(user.id, episodeId, score).run();
  return json({ ok: true, episodeId, score }, 200, headers);
}

async function addComment(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const episodeId = cleanEpisodeId(body.episodeId);
  const comment = typeof body.body === "string" ? body.body.trim() : "";
  if (!episodeId || !comment || comment.length > 500) {
    return json({ error: "Episode and a comment of 1-500 characters are required." }, 400, headers);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO comments (id, user_id, episode_id, body) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, user.id, episodeId, comment).run();
  return json({ comment: { id, username: user.username, body: comment } }, 201, headers);
}

async function changeFollow(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  if (!targetUserId || targetUserId === user.id) return json({ error: "Choose another user." }, 400, headers);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(targetUserId).first();
  if (!target) return json({ error: "User not found." }, 404, headers);
  const blocked = await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1)").bind(user.id, targetUserId).first();
  if (blocked) return json({ error: "This user is blocked." }, 403, headers);
  if (request.method === "POST") {
    await env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?1, ?2)").bind(user.id, targetUserId).run();
    return json({ following: true }, 200, headers);
  }
  await env.DB.prepare("DELETE FROM follows WHERE follower_id = ?1 AND following_id = ?2").bind(user.id, targetUserId).run();
  return json({ following: false }, 200, headers);
}

async function changeBlock(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  if (!targetUserId || targetUserId === user.id) return json({ error: "Choose another user." }, 400, headers);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(targetUserId).first();
  if (!target) return json({ error: "User not found." }, 404, headers);
  if (request.method === "POST") {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?1, ?2)").bind(user.id, targetUserId),
      env.DB.prepare("DELETE FROM follows WHERE (follower_id = ?1 AND following_id = ?2) OR (follower_id = ?2 AND following_id = ?1)").bind(user.id, targetUserId),
    ]);
    return json({ blocked: true }, 200, headers);
  }
  await env.DB.prepare("DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2").bind(user.id, targetUserId).run();
  return json({ blocked: false }, 200, headers);
}

async function authenticatedUser(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT users.id, users.username, users.friend_code FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?1 AND sessions.expires_at > datetime('now')")
    .bind(await digest(token)).first();
  return row ? { id: row.id, username: row.username, friendCode: row.friend_code } : null;
}

async function createSessionResponse(userId, user, env, headers, status) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await digest(token), userId, expiresAt).run();
  headers.set("Set-Cookie", `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return json({ user }, status, headers);
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function cleanUsername(value) { return typeof value === "string" ? value.trim() : ""; }
function cleanPin(value) { return typeof value === "string" ? value : ""; }
function cleanEpisodeId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : ""; }
function randomCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 10000).padStart(4, "0");
}
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return toBase64Url(bytes); }
function toBase64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function hashPin(pin) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await derivePinKey(pin, salt);
  return `pbkdf2$${PIN_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(key))}`;
}

async function verifyPin(pin, stored) {
  const [, iterations, saltText, hashText] = String(stored).split("$");
  if (!iterations || !saltText || !hashText) return false;
  const salt = Uint8Array.from(atob(saltText.replace(/-/g, "+").replace(/_/g, "/") + "=="), (char) => char.charCodeAt(0));
  const derived = new Uint8Array(await derivePinKey(pin, salt, Number(iterations)));
  return timingSafeEqual(derived, decodeBase64Url(hashText));
}

async function derivePinKey(pin, salt, iterations = PIN_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
}

function decodeBase64Url(value) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=="), (char) => char.charCodeAt(0)); }
function timingSafeEqual(left, right) { return left.length === right.length && left.reduce((result, value, index) => result | (value ^ right[index]), 0) === 0; }
async function digest(value) { return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function getCookie(header, name) { return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
function clearCookie() { return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function corsHeaders(origin) { return new Headers({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" }); }
function json(body, status, headers) { return new Response(JSON.stringify(body), { status, headers }); }
