const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
const authForm = document.querySelector("#auth-form");
const authSubmit = authForm.querySelector("button[type=submit]");
const authStatus = document.querySelector("#auth-status");
const pinNote = document.querySelector("#pin-note");
const accountPanel = document.querySelector("#account-panel");
const accountName = document.querySelector("#account-name");
const accountCode = document.querySelector("#account-code");
const adminPanel = document.querySelector("#admin-panel");
const reportList = document.querySelector("#report-list");
const authPanel = document.querySelector("#auth-panel");
let authMode = "login";
let ratingsByEpisode = new Map();
const EPISODE_CACHE_KEY = "tatorttracker.episodes.v1";
const REVIEW_DRAFT_KEY = "tatorttracker.review-draft.v1";
const FULL_CATALOG_SOURCE = "data/tatort-episodes.json";
let allEpisodes = [];

async function request(path, options = {}) {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Etwas ist schiefgelaufen.");
  return data;
}

function showUser(user) {
  if (user) {
    window.location.replace("profile.html");
    return;
  }
  if (authPanel) authPanel.hidden = false;
  document.querySelectorAll(".requires-auth").forEach((element) => {
    element.hidden = true;
  });
  if (accountPanel) accountPanel.hidden = true;
  if (adminPanel) adminPanel.hidden = true;
}

async function loadRatings() {
  try {
    const data = await request("/ratings");
    ratingsByEpisode = new Map(data.ratings.map((rating) => [String(rating.episodeId), rating]));
    renderFilteredEpisodes();
  } catch {
    ratingsByEpisode = new Map();
  }
}

async function loadReports() {
  const status = document.querySelector("#admin-status");
  status.textContent = "Wird geladen ...";
  try {
    const data = await request("/admin/reports");
    reportList.replaceChildren(...data.reports.map(renderReport));
    status.textContent = data.reports.length ? "" : "Keine Meldungen.";
  } catch (error) {
    status.textContent = error.message;
  }
}

function renderReport(report) {
  const item = document.createElement("li");
  item.className = "report-item";
  const text = document.createElement("p");
  text.textContent = `${report.targetType} ${report.targetId}: ${report.reason} (${report.reporter})`;
  const resolve = document.createElement("button");
  resolve.className = "secondary-button";
  resolve.type = "button";
  resolve.textContent = report.status === "resolved" ? "Erledigt" : "Erledigen";
  resolve.disabled = report.status === "resolved";
  resolve.addEventListener("click", async () => {
    await updateReportStatus(report.id, "resolved");
  });
  const dismiss = document.createElement("button");
  dismiss.className = "quiet-button";
  dismiss.type = "button";
  dismiss.textContent = "Verwerfen";
  dismiss.disabled = report.status === "dismissed";
  dismiss.addEventListener("click", async () => {
    await updateReportStatus(report.id, "dismissed");
  });
  item.append(text, resolve, dismiss);
  return item;
}

async function updateReportStatus(id, status) {
  try {
    await request(`/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadReports();
  } catch (error) {
    document.querySelector("#admin-status").textContent = error.message;
  }
}

document.querySelector("#refresh-reports").addEventListener("click", loadReports);

function renderEpisode(episode) {
  const item = document.createElement("li");
  item.className = "episode-card";
  if (ratingsByEpisode.has(String(episode.id))) item.classList.add("viewed");
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  const line = document.createElement("p");
  line.className = "episode-line";
  line.append(document.createTextNode(`${episode.id} - `));
  const title = document.createElement("strong");
  title.textContent = episode.title;
  line.append(title);
  if (episode.location) line.append(document.createTextNode(` (${episode.location})`));
  item.append(line);
  item.addEventListener("click", () => openEpisodeModal(episode));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEpisodeModal(episode); }
  });
  return item;
}

function normalizeCatalogEpisode(episode) {
  return {
    id: String(episode.id || episode.no),
    title: cleanEpisodeTitle(episode.title),
    team: episode.team || episode.ermittler || "",
    investigator: episode.ermittler || episode.investigator || "",
    airDate: episode.airDate || episode.date || "",
    location: episode.location || "",
    synopsis: episode.synopsis || episode.besonderheiten || "Keine Beschreibung vorhanden.",
    sender: episode.sender || "",
    roles: Array.isArray(episode.roles) ? episode.roles : [],
  };
}

function cleanEpisodeTitle(title) {
  return String(title || "").replace(/^\s*Tatort\s*:\s*/i, "").trim();
}

function deduplicateEpisodes(episodes) {
  const preferred = new Map();
  for (const episode of episodes) {
    const number = String(episode.id).match(/^\d+/)?.[0] || String(episode.id);
    const current = preferred.get(number);
    const score = (String(episode.id) === number ? 2 : 0) + (/Ã|Â|�/.test(episode.title) ? 0 : 1);
    const currentScore = current ? (String(current.id) === number ? 2 : 0) + (/Ã|Â|�/.test(current.title) ? 0 : 1) : -1;
    if (!current || score > currentScore) preferred.set(number, episode);
  }
  return [...preferred.values()];
}

function openEpisodeModal(episode) {
  document.querySelector("#modal-title").textContent = episode.title;
  const body = document.querySelector("#modal-body");
  body.replaceChildren();
  const form = document.createElement("form");
  form.className = "rating-area";
  const savedRating = ratingsByEpisode.get(String(episode.id)) || {};
  const roleNames = episode.roles.map((role) => role.split(":").slice(1).join(":").trim() || role.trim()).filter(Boolean);
  const roleSuggestions = document.createElement("datalist"); roleSuggestions.id = `episode-roles-${episode.id}`;
  roleSuggestions.replaceChildren(...[...new Set(roleNames)].map((role) => { const option = document.createElement("option"); option.value = role; return option; }));
  body.append(roleSuggestions);
  const ratingFields = [["fallQuality", "Fallqualität", "fallqualität.svg"], ["teamRating", "Team", "team.svg"], ["directionRating", "Inszenierung", "inszenierung.svg"], ["tension", "Spannung", "spannung.svg"], ["scary", "gruselig (Kissenfaktor)", "gruselig.svg"]];
  const mainRatingFields = new Set(["fallQuality", "teamRating", "directionRating", "tension"]);
  const overallRow = document.createElement("div"); overallRow.className = "rating-row general-rating";
  const overallLabel = document.createElement("span"); overallLabel.className = "rating-label"; overallLabel.textContent = "Gesamtbewertung";
  const overallValue = document.createElement("span"); overallValue.className = "rating-value"; overallValue.textContent = "0.0/5";
  const overallStars = document.createElement("span"); overallStars.className = "stars overall-stars";
  for (let value = 1; value <= 5; value += 1) {
    const star = document.createElement("span"); star.className = "star-button";
    star.textContent = "★"; overallStars.append(star);
  }
  overallRow.append(overallLabel, overallValue, overallStars); form.append(overallRow);
  const updateOverall = () => {
    const values = [...form.querySelectorAll(".stars")].filter((stars) => mainRatingFields.has(stars.dataset.field)).map((stars) => Number(stars.dataset.value || 0));
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    overallValue.textContent = `${average.toFixed(1)}/5`;
    [...overallStars.children].forEach((star, index) => star.classList.toggle("filled", index < Math.round(average)));
  };
  for (const [field, label, iconFile] of ratingFields) {
    const row = document.createElement("div"); row.className = "rating-row";
    const text = document.createElement("span"); text.className = "rating-label"; text.textContent = label;
    const stars = document.createElement("span"); stars.className = "stars interactive";
    for (let value = 1; value <= 5; value += 1) {
      const star = document.createElement("button"); star.type = "button"; star.className = "star-button"; star.setAttribute("aria-label", `${value} Sterne`); star.dataset.value = value;
      const icon = document.createElement("img"); icon.className = "rating-icon"; icon.alt = ""; icon.src = `assets/icons/${encodeURI(iconFile)}`;
      const fallback = document.createElement("span"); fallback.className = "rating-icon-fallback"; fallback.textContent = "★";
      icon.addEventListener("load", () => { fallback.hidden = true; });
      icon.addEventListener("error", () => { icon.hidden = true; fallback.hidden = false; });
      star.append(icon, fallback);
      star.addEventListener("click", () => {
        const nextValue = Number(stars.dataset.value || 0) === value ? 0 : value;
        stars.dataset.value = nextValue;
        [...stars.children].forEach((item, index) => item.classList.toggle("filled", index < nextValue));
        updateOverall();
      });
      stars.append(star);
    }
    stars.dataset.field = field; stars.dataset.value = "0";
    const savedValue = Number(savedRating[field] || 0);
    const selectedValue = Math.round(savedValue / 2);
    stars.dataset.value = String(selectedValue);
    [...stars.children].forEach((item, index) => item.classList.toggle("filled", index < selectedValue));
    row.append(text, stars); form.append(row);
  }
  updateOverall();
  const topFields = document.createElement("div"); topFields.className = "rating-row top-fields";
  for (const [id, label, type] of [["watchedDate", "zuerst gesehen", "date"], ["watchCount", "Anzahl gesehen", "number"]]) { const field = document.createElement("div"); field.className = "top-field"; const text = document.createElement("span"); text.className = "rating-label"; text.textContent = label; const input = document.createElement("input"); input.id = `modal-${id}`; input.name = id; input.type = type; input.className = type === "date" ? "top-date-input" : "top-count-input"; input.min = type === "number" ? "1" : ""; input.value = savedRating[id] ?? (type === "number" ? "1" : ""); field.append(text, input); topFields.append(field); } form.append(topFields);
  for (const [id, label] of [["favoriteCharacter", "most loved Charakter"], ["leastFavoriteCharacter", "most hated Charakter"]]) { const row = document.createElement("div"); row.className = "rating-row character-row"; const text = document.createElement("span"); text.className = "rating-label"; text.textContent = label; const input = document.createElement("input"); input.id = `modal-${id}`; input.name = id; input.type = "text"; input.className = "character-input"; input.placeholder = "keine Auswahl"; input.setAttribute("list", roleSuggestions.id); input.value = savedRating[id] || ""; row.append(text, input); form.append(row); }
  const notesRow = document.createElement("div"); notesRow.className = "rating-row besonderheiten-row"; const notesLabel = document.createElement("span"); notesLabel.className = "rating-label"; notesLabel.textContent = "Besonderheiten"; const notes = document.createElement("p"); notes.id = "modal-notes"; notes.className = "besonderheiten-text readonly-field"; notes.textContent = episode.synopsis; notesRow.append(notesLabel, notes); form.append(notesRow);
  const commentRow = document.createElement("div"); commentRow.className = "rating-row kommentar-row"; const commentLabel = document.createElement("span"); commentLabel.className = "rating-label"; commentLabel.textContent = "Kommentare"; const comment = document.createElement("textarea"); comment.id = "modal-comment"; comment.placeholder = "Kommentar eingeben"; comment.rows = 3; comment.className = "kommentar-input"; commentRow.append(commentLabel, comment); form.append(commentRow);
  const save = document.createElement("button"); save.className = "primary-button"; save.type = "submit"; save.textContent = "Bewertung speichern"; form.append(save);
  const status = document.createElement("p"); status.className = "form-status"; status.setAttribute("role", "status"); form.append(status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); status.textContent = "Wird gespeichert ...";
    const values = Object.fromEntries([...form.querySelectorAll(".stars")].map((stars) => [stars.dataset.field, Number(stars.dataset.value || 0)]));
    const total = [values.fallQuality, values.teamRating, values.directionRating, values.tension].reduce((sum, value) => sum + value, 0) / 4;
    const apiValue = (value) => value ? value * 2 : 5;
    const apiValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, apiValue(value)]));
    const payload = { episodeId: episode.id, score: Math.round(total * 2) || 5, ...apiValues, watchedDate: form.querySelector("#modal-watchedDate").value, watchCount: Number(form.querySelector("#modal-watchCount").value || 1), favoriteCharacter: form.querySelector("#modal-favoriteCharacter").value, leastFavoriteCharacter: form.querySelector("#modal-leastFavoriteCharacter").value, notes: episode.synopsis };
    try { const saved = await request("/ratings", { method: "POST", body: JSON.stringify(payload) }); ratingsByEpisode.set(String(episode.id), saved); renderFilteredEpisodes(); status.textContent = "Bewertung gespeichert."; if (comment.value.trim()) await request("/comments", { method: "POST", body: JSON.stringify({ episodeId: episode.id, body: comment.value.trim() }) }); } catch (error) { status.textContent = error.message; }
  });
  body.append(form);
  document.querySelector("#episode-modal").hidden = false;
}

document.querySelectorAll("[data-close-modal]").forEach((element) => element.addEventListener("click", () => { document.querySelector("#episode-modal").hidden = true; }));

function renderFilteredEpisodes() {
  const query = document.querySelector("#episode-search").value.trim().toLocaleLowerCase("de-DE");
  const filtered = allEpisodes.filter((episode) => [episode.id, episode.title, episode.team, episode.investigator, episode.location, episode.airDate]
    .join(" ").toLocaleLowerCase("de-DE").includes(query));
  filtered.sort((left, right) => {
    const leftNumber = Number.parseInt(left.id, 10) || 0;
    const rightNumber = Number.parseInt(right.id, 10) || 0;
    return leftNumber - rightNumber || left.title.localeCompare(right.title, "de");
  });
  document.querySelector("#episode-list").replaceChildren(...filtered.map(renderEpisode));
  document.querySelector("#episodes-status").textContent = `${filtered.length.toLocaleString("de-DE")} Folgen.`;
}

async function loadEpisodes() {
  const status = document.querySelector("#episodes-status");
  const list = document.querySelector("#episode-list");
  try {
    const data = await request("/episodes");
    const localResponse = await fetch(`${FULL_CATALOG_SOURCE}?metadata=${Date.now()}`, { cache: "no-store" });
    const localCatalog = await localResponse.json();
    const localById = new Map();
    for (const episode of localCatalog) {
      const normalized = normalizeCatalogEpisode(episode);
      const id = String(normalized.id);
      localById.set(id, normalized);
      const numericId = id.match(/^\d+/)?.[0];
      if (numericId && !localById.has(numericId)) localById.set(numericId, normalized);
    }
    const onlineEpisodes = data.episodes.map((episode) => {
      const normalized = normalizeCatalogEpisode(episode);
      const local = localById.get(normalized.id) || localById.get(normalized.id.match(/^\d+/)?.[0]);
      return local ? { ...normalized, team: normalized.team || local.team, investigator: normalized.investigator || local.investigator, location: normalized.location || local.location, roles: normalized.roles.length ? normalized.roles : local.roles } : normalized;
    });
    if (onlineEpisodes.length < 1000) {
      throw new Error("Online catalog is incomplete");
    }
    allEpisodes = deduplicateEpisodes(onlineEpisodes);
    localStorage.setItem(EPISODE_CACHE_KEY, JSON.stringify(allEpisodes));
    renderFilteredEpisodes();
    status.textContent = "Online synchronisiert.";
  } catch (error) {
    try {
      const response = await fetch(`${FULL_CATALOG_SOURCE}?refresh=${Date.now()}`, { cache: "no-store" });
      const catalog = await response.json();
      allEpisodes = deduplicateEpisodes(catalog.map(normalizeCatalogEpisode));
      localStorage.setItem(EPISODE_CACHE_KEY, JSON.stringify(allEpisodes));
      renderFilteredEpisodes();
      status.textContent = "Lokaler Vollkatalog geladen.";
    } catch {
      const cached = JSON.parse(localStorage.getItem(EPISODE_CACHE_KEY) || "[]");
      allEpisodes = deduplicateEpisodes(cached);
      renderFilteredEpisodes();
      status.textContent = cached.length ? "Offline: gespeicherte Sammlung." : "Sammlung offline nicht verfuegbar.";
    }
  }
}

document.querySelector("#refresh-episodes").addEventListener("click", loadEpisodes);
document.querySelector("#episode-search").addEventListener("input", renderFilteredEpisodes);

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    authMode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
    authSubmit.textContent = authMode === "login" ? "Anmelden" : "Konto erstellen";
    pinNote.textContent = authMode === "login" ? "Dein PIN bleibt privat. Es gibt zunächst keine Wiederherstellung." : "Wähle einen privaten PIN mit mindestens 6 Zeichen. Es gibt zunächst keine Wiederherstellung.";
    authStatus.textContent = "";
  });
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatus.textContent = "Wird geprüft ...";
  const form = new FormData(authForm);
  try {
    const data = await request(`/auth/${authMode}`, { method: "POST", body: JSON.stringify({ username: form.get("username"), pin: form.get("pin") }) });
    if (data.token) localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    showUser(data.user);
    authStatus.textContent = authMode === "login" ? "Willkommen zurück." : `Konto erstellt. Dein Freundescode ist ${data.user.friendCode}.`;
    authForm.reset();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

document.querySelector("#finder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.querySelector("#friend-code").value;
  const finderStatus = document.querySelector("#finder-status");
  finderStatus.textContent = "Suche ...";
  try {
    const data = await request(`/users/by-code/${code}`);
    const result = document.querySelector("#finder-result");
    result.replaceChildren();
    result.hidden = !data.user;
    if (!data.user) {
      finderStatus.textContent = "Kein Benutzer gefunden.";
      return;
    }
    finderStatus.textContent = "Gefunden.";
    const name = document.createElement("strong");
    name.textContent = data.user.username;
    const followButton = document.createElement("button");
    followButton.className = "secondary-button";
    followButton.type = "button";
    followButton.textContent = "Folgen";
    followButton.addEventListener("click", () => updateSocial("/follows", data.user.id, followButton, "Folgen", "Folge ich"));
    const blockButton = document.createElement("button");
    blockButton.className = "quiet-button";
    blockButton.type = "button";
    blockButton.textContent = "Blockieren";
    blockButton.addEventListener("click", () => updateSocial("/blocks", data.user.id, blockButton, "Blockieren", "Blockiert", "POST"));
    result.append(name, followButton, blockButton);
  } catch (error) {
    finderStatus.textContent = error.message;
  }
});

async function updateSocial(path, userId, button, idleText, activeText, method = "POST") {
  button.disabled = true;
  try {
    await request(path, { method, body: JSON.stringify({ userId }) });
    button.textContent = activeText;
  } catch (error) {
    document.querySelector("#finder-status").textContent = error.message;
    button.disabled = false;
    button.textContent = idleText;
  }
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await request("/auth/logout", { method: "POST" }); } finally { localStorage.removeItem(SESSION_TOKEN_KEY); }
  showUser(null);
  authStatus.textContent = "Du bist abgemeldet.";
});

document.querySelector("#report-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#report-status");
  status.textContent = "Wird gesendet ...";
  try {
    await request("/reports", {
      method: "POST",
      body: JSON.stringify({
        targetType: document.querySelector("#report-type").value,
        targetId: document.querySelector("#report-target").value,
        reason: document.querySelector("#report-reason").value,
      }),
    });
    status.textContent = "Meldung gesendet.";
    document.querySelector("#report-form").reset();
  } catch (error) {
    status.textContent = error.message;
  }
});

request("/me").then((data) => {
  if (data.token) localStorage.setItem(SESSION_TOKEN_KEY, data.token);
  showUser(data.user);
}).catch(() => showUser(null));
loadEpisodes();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js?v=22", { updateViaCache: "none" }).then((registration) => registration.update());
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  });
}
