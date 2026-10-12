const SESSION_COOKIE = "tt_session";
const SESSION_DAYS = 30;
const PIN_ITERATIONS = 1000;

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
      if (url.pathname === "/api/statistics" && request.method === "GET") {
        return statistics(request, env, headers);
      }
      if (url.pathname === "/api/admin/sync-episodes" && request.method === "POST") {
        return manualEpisodeSync(request, env, headers);
      }
      if (url.pathname === "/api/episodes" && request.method === "GET") {
        return listEpisodes(env, headers);
      }
      const episodeDetailMatch = url.pathname.match(/^\/api\/episodes\/([a-zA-Z0-9_-]+)$/);
      if (episodeDetailMatch && request.method === "GET") {
        return episodeDetail(episodeDetailMatch[1], env, headers);
      }
      if (url.pathname === "/api/follows" && (request.method === "POST" || request.method === "DELETE")) {
        return changeFollow(request, env, headers);
      }
      if (url.pathname === "/api/blocks" && (request.method === "POST" || request.method === "DELETE")) {
        return changeBlock(request, env, headers);
      }
      if (url.pathname === "/api/reports" && request.method === "POST") {
        return createReport(request, env, headers);
      }
      if (url.pathname === "/api/admin/reports" && request.method === "GET") {
        return listReports(request, env, headers);
      }
      const reportMatch = url.pathname.match(/^\/api\/admin\/reports\/([a-f0-9-]+)$/);
      if (reportMatch && request.method === "PATCH") {
        return updateReport(reportMatch[1], request, env, headers);
      }
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500, headers);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(syncEpisodes(env));
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
  const user = await env.DB.prepare("SELECT id, username, friend_code, pin_hash, is_admin FROM users WHERE username_normalized = ?1")
    .bind(username.toLowerCase()).first();
  if (!user || !(await verifyPin(pin, user.pin_hash))) {
    return json({ error: "Invalid username or PIN." }, 401, headers);
  }
  return createSessionResponse(user.id, { id: user.id, username: user.username, friendCode: user.friend_code, isAdmin: Boolean(user.is_admin) }, env, headers, 200);
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

async function listEpisodes(env, headers) {
  const episodes = await env.DB.prepare("SELECT id, title, investigator AS team, air_date AS airDate, location, notes AS synopsis FROM episode_catalog ORDER BY CAST(id AS INTEGER) DESC LIMIT 2000").all();
  return json({ episodes: episodes.results || [] }, 200, headers);
}

async function manualEpisodeSync(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user?.isAdmin) return json({ error: "Admin access required." }, 403, headers);
  return json(await syncEpisodes(env), 200, headers);
}

async function syncEpisodes(env) {
  const response = await fetch("https://de.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&format=json&formatversion=2&origin=*&titles=Liste_der_Tatort-Folgen", { headers: { "User-Agent": "TatortTracker2/1.0 (episode sync)" } });
  if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
  const data = await response.json();
  const raw = data?.query?.pages?.[0]?.revisions?.[0]?.content || "";
  const rows = parseWikipediaEpisodes(raw);
  const existing = await env.DB.prepare("SELECT id, title FROM episode_catalog").all();
  const byId = new Map((existing.results || []).map((item) => [item.id, item.title]));
  const statements = rows.map((row) => {
    const baseId = String(row.no);
    const candidate = byId.get(baseId) && byId.get(baseId) !== row.title ? `${baseId}-${slugify(row.title)}` : baseId;
    byId.set(candidate, row.title);
    return env.DB.prepare("INSERT OR REPLACE INTO episode_catalog (id, title, sender, air_date, investigator, location, notes, roles_json) VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT location FROM episode_catalog WHERE id = ?1), ''), ?6, COALESCE((SELECT roles_json FROM episode_catalog WHERE id = ?1), '[]'))")
      .bind(candidate, row.title, row.sender, row.date, row.investigator, row.notes);
  });
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
  return { ok: true, synced: rows.length };
}

function parseWikipediaEpisodes(raw) {
  const rows = [];
  let cells = [];
  let current = -1;
  for (const line of String(raw).split(/\r?\n/)) {
    if (/^\|-/.test(line)) { pushWikipediaRow(rows, cells); cells = []; current = -1; continue; }
    if (/^\|\}/.test(line)) { pushWikipediaRow(rows, cells); cells = []; current = -1; continue; }
    if (/^!/.test(line)) continue;
    const cell = line.match(/^\|\s*(.*)$/);
    if (cell) { cell[1].split("||").forEach((part) => cells.push(part.trim())); current = cells.length - 1; continue; }
    if (current >= 0 && line.trim()) cells[current] = `${cells[current]} ${line.trim()}`;
  }
  return rows;
}

function pushWikipediaRow(rows, cells) {
  const no = cleanWikiText(cells[0]);
  if (!/^\d+$/.test(no) || !cells[1]) return;
  rows.push({ no, title: cleanWikiText(cells[1]), sender: cleanWikiText(cells[2]), date: cleanWikiText(cells[3]), investigator: cleanWikiText(cells[4]), notes: cleanWikiText(cells[8] || "") });
}

function cleanWikiText(value) { return String(value || "").replace(/<br\s*\/?>([\s\S])*$/i, "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/'''?/g, "").replace(/<[^>]+>/g, "").trim(); }
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); }

async function episodeDetail(episodeId, env, headers) {
  const episode = await env.DB.prepare("SELECT id, title, investigator AS team, air_date AS airDate, location, notes AS synopsis FROM episode_catalog WHERE id = ?1").bind(episodeId).first();
  if (!episode) return json({ error: "Episode not found." }, 404, headers);
  return json({ episode }, 200, headers);
}

async function statistics(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const rows = await env.DB.prepare("SELECT episode_catalog.id, episode_catalog.title, episode_catalog.investigator AS team, episode_catalog.location, ratings.score, ratings.fall_quality AS fallQuality, ratings.team_rating AS teamRating, ratings.direction_rating AS directionRating, ratings.tension, ratings.scary, ratings.watch_count AS watchCount FROM ratings LEFT JOIN episode_catalog ON episode_catalog.id = ratings.episode_id WHERE ratings.user_id = ?1").bind(user.id).all();
  const ratings = rows.results || [];
  const average = (key) => ratings.length ? Number((ratings.reduce((sum, item) => sum + Number(item[key] || 0), 0) / ratings.length).toFixed(1)) : null;
  const rank = (key, limit = 10) => ratings.filter((item) => item[key]).sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, limit).map((item) => ({ title: item.title || item.id, score: item[key], id: item.id }));
  const groups = (key) => Object.values(ratings.reduce((result, item) => {
    const label = String(item[key] || "Unbekannt").trim();
    const group = result[label] || { label, total: 0, count: 0 };
    group.total += Number(item.score || 0); group.count += 1; result[label] = group; return result;
  }, {})).map((group) => ({ label: group.label, score: Number((group.total / group.count).toFixed(1)), count: group.count })).sort((a, b) => b.score - a.score).slice(0, 10);
  return json({ overview: { rated: ratings.length, watched: ratings.filter((item) => Number(item.watchCount) > 0).length, average: average("score") }, categories: { fallQuality: average("fallQuality"), team: average("teamRating"), direction: average("directionRating"), tension: average("tension"), scary: average("scary") }, best: rank("score"), worst: rank("score").reverse(), scary: rank("scary"), teams: groups("team"), cities: groups("location") }, 200, headers);
}

async function saveRating(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const episodeId = cleanEpisodeId(body.episodeId);
  const score = Number(body.score);
  const details = {
    fallQuality: cleanRating(body.fallQuality), teamRating: cleanRating(body.teamRating), directionRating: cleanRating(body.directionRating),
    tension: cleanRating(body.tension), scary: cleanRating(body.scary), watchedDate: cleanDate(body.watchedDate),
    watchCount: cleanCount(body.watchCount), favoriteCharacter: cleanText(body.favoriteCharacter, 120),
    leastFavoriteCharacter: cleanText(body.leastFavoriteCharacter, 120), notes: cleanText(body.notes, 1000),
  };
  if (!episodeId || !Number.isInteger(score) || score < 1 || score > 10 || Object.values(details).some((value) => value === null)) {
    return json({ error: "Episode and a score from 1 to 10 are required." }, 400, headers);
  }
  await env.DB.prepare("INSERT INTO ratings (user_id, episode_id, score, fall_quality, team_rating, direction_rating, tension, scary, watched_date, watch_count, favorite_character, least_favorite_character, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT(user_id, episode_id) DO UPDATE SET score = excluded.score, fall_quality = excluded.fall_quality, team_rating = excluded.team_rating, direction_rating = excluded.direction_rating, tension = excluded.tension, scary = excluded.scary, watched_date = excluded.watched_date, watch_count = excluded.watch_count, favorite_character = excluded.favorite_character, least_favorite_character = excluded.least_favorite_character, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP")
    .bind(user.id, episodeId, score, details.fallQuality, details.teamRating, details.directionRating, details.tension, details.scary, details.watchedDate, details.watchCount, details.favoriteCharacter, details.leastFavoriteCharacter, details.notes).run();
  return json({ ok: true, episodeId, score, ...details }, 200, headers);
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

async function createReport(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Authentication required." }, 401, headers);
  const body = await readJson(request);
  const targetType = cleanReportType(body.targetType);
  const targetId = typeof body.targetId === "string" ? body.targetId.trim().slice(0, 120) : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!targetType || !targetId || reason.length < 3 || reason.length > 500) {
    return json({ error: "Target and a reason of 3-500 characters are required." }, 400, headers);
  }
  const existing = await env.DB.prepare("SELECT id FROM reports WHERE reporter_id = ?1 AND target_type = ?2 AND target_id = ?3 AND status = 'open'")
    .bind(user.id, targetType, targetId).first();
  if (existing) return json({ error: "You already reported this." }, 409, headers);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, user.id, targetType, targetId, reason).run();
  return json({ ok: true, reportId: id }, 201, headers);
}

async function listReports(request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user?.isAdmin) return json({ error: "Admin access required." }, 403, headers);
  const reports = await env.DB.prepare("SELECT reports.id, reports.target_type AS targetType, reports.target_id AS targetId, reports.reason, reports.status, reports.created_at AS createdAt, users.username AS reporter FROM reports JOIN users ON users.id = reports.reporter_id ORDER BY reports.created_at DESC LIMIT 100").all();
  return json({ reports: reports.results || [] }, 200, headers);
}

async function updateReport(id, request, env, headers) {
  const user = await authenticatedUser(request, env);
  if (!user?.isAdmin) return json({ error: "Admin access required." }, 403, headers);
  const body = await readJson(request);
  const status = ["open", "resolved", "dismissed"].includes(body.status) ? body.status : "";
  if (!status) return json({ error: "Invalid report status." }, 400, headers);
  const result = await env.DB.prepare("UPDATE reports SET status = ?1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?2").bind(status, id).run();
  if (!result.meta.changes) return json({ error: "Report not found." }, 404, headers);
  return json({ ok: true, status }, 200, headers);
}

async function authenticatedUser(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT users.id, users.username, users.friend_code, users.is_admin FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?1 AND sessions.expires_at > datetime('now')")
    .bind(await digest(token)).first();
  return row ? { id: row.id, username: row.username, friendCode: row.friend_code, isAdmin: Boolean(row.is_admin) } : null;
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
function cleanRating(value) { const rating = Number(value ?? 5); return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null; }
function cleanCount(value) { const count = Number(value ?? 1); return Number.isInteger(count) && count >= 1 && count <= 999 ? count : null; }
function cleanDate(value) { return value === "" || value == null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ? (value || null) : null; }
function cleanText(value, max) { return value == null || value === "" ? "" : typeof value === "string" && value.length <= max ? value.trim() : null; }
function cleanReportType(value) { return ["user", "comment", "episode"].includes(value) ? value : ""; }
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
  try {
    const [, iterations, saltText, hashText] = String(stored).split("$");
    const count = Number(iterations);
    if (!Number.isInteger(count) || count < 1 || count > 20000 || !saltText || !hashText) return false;
    const salt = decodeBase64Url(saltText);
    const derived = new Uint8Array(await derivePinKey(pin, salt, count));
    return timingSafeEqual(derived, decodeBase64Url(hashText));
  } catch {
    return false;
  }
}

async function derivePinKey(pin, salt, iterations = PIN_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
}

function decodeBase64Url(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
function timingSafeEqual(left, right) { return left.length === right.length && left.reduce((result, value, index) => result | (value ^ right[index]), 0) === 0; }
async function digest(value) { return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function getCookie(header, name) { return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
function clearCookie() { return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function corsHeaders(origin) { return new Headers({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" }); }
function json(body, status, headers) { return new Response(JSON.stringify(body), { status, headers }); }
