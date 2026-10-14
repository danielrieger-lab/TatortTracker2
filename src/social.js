const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
const form = document.querySelector("#social-form");
const status = document.querySelector("#social-status");
const result = document.querySelector("#social-result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Suche ...";
  result.hidden = true;
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  try {
    const response = await fetch(`${API_BASE}/users/by-code/${form.elements["social-code"].value}`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Suche fehlgeschlagen.");
    if (!data.user) {
      status.textContent = "Kein Benutzer gefunden.";
      return;
    }
    const name = document.createElement("strong");
    name.textContent = data.user.username;
    result.replaceChildren(name);
    result.hidden = false;
    status.textContent = "Gefunden.";
  } catch (error) {
    status.textContent = error.message;
  }
});
