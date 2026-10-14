const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
const BROADCAST_COUNT_CACHE_KEY = "tatorttracker.broadcast-count.v2";
const status = document.querySelector("#profile-status");
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

async function loadProfile() {
  try {
    const [me, ratings, episodes] = await Promise.all([request("/me"), request("/ratings"), request("/episodes")]);
    if (!me.user) {
      window.location.replace("index.html");
      return;
    }
    document.querySelector("#profile-username").textContent = `${me.user.rankShort} ${me.user.username}`;
    document.querySelector("#profile-rank-title").textContent = me.user.rankTitle;
      document.querySelector("#profile-friend-code").textContent = `T${me.user.friendCode}`;
    const totalEpisodes = await getBroadcastedEpisodeCount(episodes.episodes);
    const rated = ratings.ratings.length;
    document.querySelector("#profile-count").textContent = `${rated} / ${totalEpisodes} Fällen`;
    document.querySelector("#profile-percent").textContent = `${totalEpisodes ? ((rated / totalEpisodes) * 100).toFixed(1).replace(".", ",") : "0,0"} %`;
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

loadProfile();
