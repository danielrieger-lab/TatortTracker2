const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
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
    if (!me.user) throw new Error("Bitte zuerst anmelden.");
    profileData = stats;
    document.querySelector("#profile-username").textContent = me.user.username;
    document.querySelector("#profile-friend-code").textContent = `Freundescode ${me.user.friendCode}`;
    const totalEpisodes = episodes.episodes.length;
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

document.querySelectorAll("[data-profile-section]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-profile-section]").forEach((item) => item.classList.toggle("is-active", item === button));
  renderSection(button.dataset.profileSection);
}));

loadProfile();
