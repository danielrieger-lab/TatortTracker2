const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
const BROADCAST_COUNT_CACHE_KEY = "tatorttracker.broadcast-count.v2";
const status = document.querySelector("#profile-status");
const detailTitle = document.querySelector("#profile-detail-title");
const detailContent = document.querySelector("#profile-detail-content");
let profileData;

async function request(path) {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Profil konnte nicht geladen werden.");
  return data;
}

document.querySelector("#profile-logout").addEventListener("click", async () => {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } finally {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    window.location.href = "index.html";
  }
});

function renderList(items, formatter = (item) => item.title || item.label) {
  if (!items.length) {
    detailContent.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Noch keine Daten vorhanden." }));
    return;
  }
  detailContent.replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = "profile-result-row";
    const label = document.createElement("span");
    label.textContent = formatter(item);
    const score = document.createElement("strong");
    score.textContent = `${item.score}/10`;
    row.append(label, score);
    return row;
  }));
}

function renderSection(section) {
  const sections = {
    best: ["Beste Fälle", profileData.best, (item) => item.title],
    worst: ["Schlechteste Fälle", profileData.worst, (item) => item.title],
    teams: ["Beste Teams", profileData.teams, (item) => item.label],
    worstTeams: ["Schlechteste Teams", [...profileData.teams].reverse(), (item) => item.label],
    cities: ["Beste Städte", profileData.cities, (item) => item.label],
    worstCities: ["Schlechteste Städte", [...profileData.cities].reverse(), (item) => item.label],
    average: ["Durchschnitt", [["Gesamt", profileData.overview.average], ["Fallqualität", profileData.categories.fallQuality], ["Team", profileData.categories.team], ["Inszenierung", profileData.categories.direction], ["Spannung", profileData.categories.tension], ["Gruseligkeit", profileData.categories.scary]], (item) => item[0]],
    scary: ["Gruseligste Fälle", profileData.scary, (item) => item.title],
  };
  const [title, items, formatter] = sections[section] || sections.best;
  detailTitle.textContent = title;
  if (section === "average") {
    renderList(items.map(([label, score]) => ({ label, score: score ?? "-" })), (item) => item.label);
  } else {
    renderList(items, formatter);
  }
}

async function loadProfile() {
  try {
    const [me, stats, episodes] = await Promise.all([request("/me"), request("/statistics"), request("/episodes")]);
    if (!me.user) {
      window.location.replace("index.html");
      return;
    }
    profileData = stats;
    document.querySelector("#profile-username").textContent = `${me.user.rankShort} ${me.user.username}`;
    document.querySelector("#profile-rank-title").textContent = me.user.rankTitle;
    document.querySelector("#profile-friend-code").textContent = `Freundescode ${me.user.friendCode}`;
    const totalEpisodes = await getBroadcastedEpisodeCount(episodes.episodes);
    const rated = Number(stats.overview.rated || 0);
    document.querySelector("#profile-percent").textContent = `${totalEpisodes ? ((rated / totalEpisodes) * 100).toFixed(1).replace(".", ",") : "0,0"} %`;
    document.querySelector("#profile-count").textContent = `${rated} / ${totalEpisodes} Fällen`;
    renderSection("best");
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
    document.querySelector("#profile-username").textContent = "Nicht angemeldet";
  }
}

async function getBroadcastedEpisodeCount(episodes) {
  const today = new Date().toISOString().slice(0, 10);
  const cached = JSON.parse(localStorage.getItem(BROADCAST_COUNT_CACHE_KEY) || "null");
  if (cached?.date === today && Number.isInteger(cached.count)) return cached.count;
  const count = episodes.filter((episode) => {
    const date = parseAirDate(episode.airDate);
    return !date || date <= today;
  }).length;
  localStorage.setItem(BROADCAST_COUNT_CACHE_KEY, JSON.stringify({ date: today, count }));
  return count;
}

function parseAirDate(value) {
  const text = String(value || "").replace(/\{\{DatumZelle\|([^}]+)\}\}/gi, "$1").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const numeric = text.match(/^(\d{1,2})[.]\s*(\d{1,2})[.]\s*(\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  const named = text.match(/^(\d{1,2})[.]\s*(Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)\.?\s*(\d{4})$/i);
  if (named) {
    const months = { jan: "01", feb: "02", mär: "03", apr: "04", mai: "05", jun: "06", jul: "07", aug: "08", sep: "09", okt: "10", nov: "11", dez: "12" };
    return `${named[3]}-${months[named[2].toLocaleLowerCase("de-DE")]}-${named[1].padStart(2, "0")}`;
  }
  return null;
}

document.querySelectorAll("[data-profile-section]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-profile-section]").forEach((item) => item.classList.toggle("is-active", item === button));
  renderSection(button.dataset.profileSection);
}));

loadProfile();
