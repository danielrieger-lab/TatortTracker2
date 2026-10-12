const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const authForm = document.querySelector("#auth-form");
const authSubmit = authForm.querySelector("button[type=submit]");
const authStatus = document.querySelector("#auth-status");
const pinNote = document.querySelector("#pin-note");
const accountPanel = document.querySelector("#account-panel");
const accountName = document.querySelector("#account-name");
const accountCode = document.querySelector("#account-code");
const adminPanel = document.querySelector("#admin-panel");
const reportList = document.querySelector("#report-list");
let authMode = "login";
const EPISODE_CACHE_KEY = "tatorttracker.episodes.v1";
const REVIEW_DRAFT_KEY = "tatorttracker.review-draft.v1";
const FULL_CATALOG_SOURCE = "data/tatort-episodes.json";
let allEpisodes = [];

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Etwas ist schiefgelaufen.");
  return data;
}

function showUser(user) {
  accountPanel.hidden = !user;
  adminPanel.hidden = !user?.isAdmin;
  if (user) {
    accountName.textContent = user.username;
    accountCode.textContent = user.friendCode;
    if (user.isAdmin) loadReports();
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
  item.className = "episode-item";
  const title = document.createElement("h3");
  title.textContent = episode.title;
  const meta = document.createElement("p");
  meta.textContent = `${episode.team || episode.investigator || "Ermittler offen"} | ${episode.airDate || episode.date || "Datum offen"}${episode.location ? ` | ${episode.location}` : ""}`;
  const synopsis = document.createElement("p");
  synopsis.textContent = episode.synopsis;
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = "Bewerten";
  button.addEventListener("click", () => selectEpisode(episode));
  item.append(title, meta, synopsis, button);
  return item;
}

function normalizeCatalogEpisode(episode) {
  return {
    id: String(episode.id || episode.no),
    title: episode.title,
    team: episode.team || episode.ermittler || "",
    investigator: episode.ermittler || episode.investigator || "",
    airDate: episode.airDate || episode.date || "",
    location: episode.location || "",
    synopsis: episode.synopsis || episode.besonderheiten || "Keine Beschreibung vorhanden.",
  };
}

function renderFilteredEpisodes() {
  const query = document.querySelector("#episode-search").value.trim().toLocaleLowerCase("de-DE");
  const filtered = allEpisodes.filter((episode) => [episode.id, episode.title, episode.team, episode.investigator, episode.location, episode.airDate]
    .join(" ").toLocaleLowerCase("de-DE").includes(query));
  document.querySelector("#episode-list").replaceChildren(...filtered.slice(0, 100).map(renderEpisode));
  document.querySelector("#episodes-status").textContent = `${filtered.length.toLocaleString("de-DE")} Folgen${filtered.length > 100 ? " (erste 100 angezeigt)" : ""}.`;
}

function selectEpisode(episode) {
  document.querySelector("#episode-id").value = episode.id;
  document.querySelector("#review-title").textContent = episode.title;
  document.querySelector("#review-status").textContent = "Fall ausgewaehlt.";
  saveReviewDraft();
  loadEpisodeActivity(episode.id).catch(() => {});
  document.querySelector("#review-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadEpisodes() {
  const status = document.querySelector("#episodes-status");
  const list = document.querySelector("#episode-list");
  try {
    const data = await request("/episodes");
    const onlineEpisodes = data.episodes.map(normalizeCatalogEpisode);
    if (onlineEpisodes.length < 1000) {
      throw new Error("Online catalog is incomplete");
    }
    allEpisodes = onlineEpisodes;
    localStorage.setItem(EPISODE_CACHE_KEY, JSON.stringify(allEpisodes));
    renderFilteredEpisodes();
    status.textContent = "Online synchronisiert.";
  } catch (error) {
    try {
      const response = await fetch(`${FULL_CATALOG_SOURCE}?refresh=${Date.now()}`, { cache: "no-store" });
      const catalog = await response.json();
      allEpisodes = catalog.map(normalizeCatalogEpisode);
      localStorage.setItem(EPISODE_CACHE_KEY, JSON.stringify(allEpisodes));
      renderFilteredEpisodes();
      status.textContent = "Lokaler Vollkatalog geladen.";
    } catch {
      const cached = JSON.parse(localStorage.getItem(EPISODE_CACHE_KEY) || "[]");
      allEpisodes = cached;
      renderFilteredEpisodes();
      status.textContent = cached.length ? "Offline: gespeicherte Sammlung." : "Sammlung offline nicht verfuegbar.";
    }
  }
}

function saveReviewDraft() {
  localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({
    episodeId: document.querySelector("#episode-id").value,
    score: scoreInput.value,
    comment: document.querySelector("#comment").value,
  }));
}

function restoreReviewDraft() {
  const draft = JSON.parse(localStorage.getItem(REVIEW_DRAFT_KEY) || "null");
  if (!draft) return;
  document.querySelector("#episode-id").value = draft.episodeId || "";
  scoreInput.value = draft.score || "5";
  document.querySelector("#score-value").textContent = scoreInput.value;
  document.querySelector("#comment").value = draft.comment || "";
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
  await request("/auth/logout", { method: "POST" });
  showUser(null);
  authStatus.textContent = "Du bist abgemeldet.";
});

const scoreInput = document.querySelector("#score");
scoreInput.addEventListener("input", () => {
  document.querySelector("#score-value").textContent = scoreInput.value;
});

async function loadEpisodeActivity(episodeId) {
  const data = await request(`/episodes/${episodeId}/activity`);
  document.querySelector("#episode-summary").hidden = false;
  document.querySelector("#average-score").textContent = data.rating.average ?? "Noch keine";
  document.querySelector("#rating-count").textContent = data.rating.count;
  const list = document.querySelector("#comment-list");
  list.replaceChildren(...data.comments.map((item) => {
    const entry = document.createElement("li");
    entry.textContent = `${item.username}: ${item.body}`;
    return entry;
  }));
}

document.querySelector("#review-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#review-status");
  const episodeId = document.querySelector("#episode-id").value;
  status.textContent = "Wird gespeichert ...";
  try {
    await request("/ratings", { method: "POST", body: JSON.stringify({ episodeId, score: Number(scoreInput.value) }) });
    const comment = document.querySelector("#comment").value.trim();
    if (comment) await request("/comments", { method: "POST", body: JSON.stringify({ episodeId, body: comment }) });
    await loadEpisodeActivity(episodeId);
    status.textContent = "Bewertung gespeichert.";
    document.querySelector("#comment").value = "";
    localStorage.removeItem(REVIEW_DRAFT_KEY);
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#comment").addEventListener("input", saveReviewDraft);
scoreInput.addEventListener("change", saveReviewDraft);

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

request("/me").then((data) => showUser(data.user)).catch(() => showUser(null));
restoreReviewDraft();
loadEpisodes();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}
