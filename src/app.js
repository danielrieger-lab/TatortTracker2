const API_BASE = window.TATORT_API_URL || "/api";
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
    finderStatus.textContent = data.user ? `Gefunden: ${data.user.username}` : "Kein Benutzer gefunden.";
  } catch (error) {
    finderStatus.textContent = error.message;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await request("/auth/logout", { method: "POST" });
  showUser(null);
  authStatus.textContent = "Du bist abgemeldet.";
});

request("/me").then((data) => showUser(data.user)).catch(() => showUser(null));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}
