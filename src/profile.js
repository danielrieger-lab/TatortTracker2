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
  const sectionData = profileData.sections[section] || profileData.sections.best;
  detailTitle.textContent = sectionData.title;
  renderList(sectionData.items, (item) => item.label);
}

function calculateProfileStatistics(ratings, episodes) {
  const byId = new Map(episodes.map((episode) => [String(episode.id), episode]));
  const get = (rating, key) => Math.max(0, Math.min(5, Number(rating[key] || 0) / 2));
  const episodeScores = ratings.map((rating) => ({ rating, episode: byId.get(String(rating.episodeId)), score: (get(rating, "fallQuality") + get(rating, "teamRating") + get(rating, "directionRating") + get(rating, "tension")) / 4 }));
  const ratedScores = episodeScores.filter((item) => item.score > 0);
  const average = (key) => ratings.length ? ratings.reduce((sum, rating) => sum + get(rating, key), 0) / ratings.length : 0;
  const makeRank = (items, descending = true) => items.filter((item) => item.score > 0).sort((a, b) => (descending ? b.score - a.score : a.score - b.score) || a.label.localeCompare(b.label, "de")).slice(0, 10);
  const teamGroups = new Map(); const cityGroups = new Map();
  for (const item of episodeScores) {
    const team = String(item.episode?.team || item.episode?.investigator || "").trim();
    const city = String(item.episode?.location || "").trim();
    if (team) { const group = teamGroups.get(team) || { general: [], team: [], label: team }; if (item.score > 0) group.general.push(item.score); if (item.score > 0 || get(item.rating, "teamRating") > 0) group.team.push(get(item.rating, "teamRating")); teamGroups.set(team, group); }
    if (city && item.score > 0) { const group = cityGroups.get(city) || { values: [], label: city }; group.values.push(item.score); cityGroups.set(city, group); }
  }
  const teams = [...teamGroups.values()].map((group) => ({ label: group.label, score: ((group.general.reduce((a, b) => a + b, 0) / (group.general.length || 1)) + (group.team.reduce((a, b) => a + b, 0) / (group.team.length || 1))) / 2 }));
  const cities = [...cityGroups.values()].map((group) => ({ label: group.label, score: group.values.reduce((a, b) => a + b, 0) / group.values.length }));
  const bestEpisodes = ratedScores.map((item) => ({ label: item.episode?.title || item.rating.episodeId, score: item.score }));
  const scary = ratings.map((rating) => ({ label: byId.get(String(rating.episodeId))?.title || rating.episodeId, score: get(rating, "scary") }));
  const categories = [["Gesamt", ratedScores.length ? ratedScores.reduce((sum, item) => sum + item.score, 0) / ratedScores.length : 0], ["Fallqualität", average("fallQuality")], ["Team", average("teamRating")], ["Inszenierung", average("directionRating")], ["Spannung", average("tension")], ["Gruseligkeit", average("scary")]];
  return { sections: { best: { title: "Beste Fälle", items: makeRank(bestEpisodes) }, worst: { title: "Schlechteste Fälle", items: makeRank(bestEpisodes, false) }, teams: { title: "Beste Teams", items: makeRank(teams) }, worstTeams: { title: "Schlechteste Teams", items: makeRank(teams, false) }, cities: { title: "Beste Städte", items: makeRank(cities) }, worstCities: { title: "Schlechteste Städte", items: makeRank(cities, false) }, scary: { title: "Gruseligste Fälle", items: makeRank(scary) }, average: { title: "Durchschnitt", items: categories.map(([label, score]) => ({ label, score })) } } };
}

async function loadProfile() {
  try {
    const [me, ratings, episodes] = await Promise.all([request("/me"), request("/ratings"), request("/episodes")]);
    if (!me.user) {
      window.location.replace("index.html");
      return;
    }
    profileData = calculateProfileStatistics(ratings.ratings, episodes.episodes);
    document.querySelector("#profile-username").textContent = `${me.user.rankShort} ${me.user.username}`;
    document.querySelector("#profile-rank-title").textContent = me.user.rankTitle;
      document.querySelector("#profile-friend-code").textContent = `T${me.user.friendCode}`;
    const totalEpisodes = await getBroadcastedEpisodeCount(episodes.episodes);
    const rated = ratings.ratings.length;
    document.querySelector("#profile-count").textContent = `${rated} / ${totalEpisodes} Fällen`;
    document.querySelector("#profile-percent").textContent = `${totalEpisodes ? ((rated / totalEpisodes) * 100).toFixed(1).replace(".", ",") : "0,0"} %`;
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
