const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const authForm = document.querySelector("#auth-form");
const authSubmit = authForm.querySelector("button[type=submit]");
const authStatus = document.querySelector("#auth-status");
const pinNote = document.querySelector("#pin-note");
const accountPanel = document.querySelector("#account-panel");
const accountName = document.querySelector("#account-name");
const accountCode = document.querySelector("#account-code");
let authMode = "login";

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
  if (user) {
    accountName.textContent = user.username;
    accountCode.textContent = user.friendCode;
  }
}

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
  } catch (error) {
    status.textContent = error.message;
  }
});

request("/me").then((data) => showUser(data.user)).catch(() => showUser(null));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}
