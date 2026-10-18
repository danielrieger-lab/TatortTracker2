const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const SESSION_TOKEN_KEY = "tatorttracker.session-token";
const BROADCAST_COUNT_CACHE_KEY = "tatorttracker.broadcast-count.v2";
const status = document.querySelector("#profile-status");
const statModal = document.querySelector("#profile-stat-modal");
const statTitle = document.querySelector("#profile-stat-title");
const statList = document.querySelector("#profile-stat-list");
const teamAssetBase = new URL("../assets/teams/", import.meta.url);
let profileData;
const avatarButton = document.querySelector("#profile-avatar");
const avatarFile = document.querySelector("#profile-avatar-file");
const avatarImage = document.querySelector("#profile-avatar-image");
const avatarPlaceholder = document.querySelector("#profile-avatar-placeholder");
const avatarModal = document.querySelector("#profile-avatar-modal");
const cropImage = document.querySelector("#profile-crop-image");
const cropZoom = document.querySelector("#profile-crop-zoom");
const cropX = document.querySelector("#profile-crop-x");
const cropY = document.querySelector("#profile-crop-y");
const avatarStatus = document.querySelector("#profile-avatar-status");
let selectedImageUrl = "";

async function uploadProfilePicture(profilePicture) {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const response = await fetch(`${API_BASE}/profile-picture`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ profilePicture }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Profilbild konnte nicht gespeichert werden.");
  return data;
}

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
    document.querySelector("#profile-rank-short").textContent = me.user.rankShort;
    document.querySelector("#profile-username-name").textContent = me.user.username;
    document.querySelector("#profile-rank-title").textContent = me.user.rankTitle;
      document.querySelector("#profile-friend-code").textContent = `T${me.user.friendCode}`;
    setProfilePicture(me.user.profilePicture);
    const totalEpisodes = await getBroadcastedEpisodeCount(episodes.episodes);
    const rated = ratings.ratings.length;
    profileData = calculateStatistics(ratings.ratings, episodes.episodes);
    document.querySelector("#profile-count").textContent = `${rated} / ${totalEpisodes} Fällen`;
    document.querySelector("#profile-percent").textContent = `${totalEpisodes ? ((rated / totalEpisodes) * 100).toFixed(1).replace(".", ",") : "0,0"} %`;
    document.querySelector("#profile-overall-average").textContent = profileData.overallAverage ? `${profileData.overallAverage.toFixed(1).replace(".", ",")}/5` : "-";
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
    document.querySelector("#profile-username").textContent = "Nicht angemeldet";
  }
}

function setProfilePicture(profilePicture) {
  if (profilePicture) {
    avatarImage.src = profilePicture;
    avatarImage.hidden = false;
    avatarPlaceholder.hidden = true;
    avatarButton.setAttribute("aria-label", "Profilbild ändern");
  } else {
    avatarImage.removeAttribute("src");
    avatarImage.hidden = true;
    avatarPlaceholder.hidden = false;
    avatarButton.setAttribute("aria-label", "Profilbild hinzufügen");
  }
}

function updateCropPreview() {
  cropImage.style.objectPosition = `${cropX.value}% ${cropY.value}%`;
  cropImage.style.transform = `scale(${cropZoom.value})`;
}

function closeAvatarModal() {
  avatarModal.hidden = true;
  if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
  selectedImageUrl = "";
}

avatarButton.addEventListener("click", () => avatarFile.click());
avatarFile.addEventListener("change", () => {
  const file = avatarFile.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    status.textContent = "Bitte waehle ein JPG-, PNG- oder WebP-Bild bis 8 MB.";
    avatarFile.value = "";
    return;
  }
  selectedImageUrl = URL.createObjectURL(file);
  cropImage.src = selectedImageUrl;
  cropZoom.value = "1";
  cropX.value = "50";
  cropY.value = "50";
  updateCropPreview();
  avatarStatus.textContent = "";
  avatarModal.hidden = false;
});
[cropZoom, cropX, cropY].forEach((input) => input.addEventListener("input", updateCropPreview));
document.querySelectorAll("[data-close-profile-avatar]").forEach((element) => element.addEventListener("click", closeAvatarModal));
document.querySelector("#profile-avatar-save").addEventListener("click", async () => {
  if (!cropImage.naturalWidth) return;
  avatarStatus.textContent = "Wird gespeichert ...";
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const sourceSize = Math.min(cropImage.naturalWidth, cropImage.naturalHeight) / Number(cropZoom.value);
  const sourceX = (cropImage.naturalWidth - sourceSize) * Number(cropX.value) / 100;
  const sourceY = (cropImage.naturalHeight - sourceSize) * Number(cropY.value) / 100;
  context.drawImage(cropImage, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 256, 256);
  try {
    const data = await uploadProfilePicture(canvas.toDataURL("image/jpeg", 0.82));
    setProfilePicture(data.profilePicture);
    closeAvatarModal();
    avatarFile.value = "";
    status.textContent = "Profilbild gespeichert.";
  } catch (error) {
    avatarStatus.textContent = error.message;
  }
});

function calculateStatistics(ratings, episodes) {
  const episodesById = new Map(episodes.map((episode) => [String(episode.id), episode]));
  const score = (rating, key) => Number(rating[key] || 0);
  const caseRows = ratings.map((rating) => {
    const episode = episodesById.get(String(rating.episodeId));
    return { episode, score: ["fallQuality", "teamRating", "directionRating", "tension"].reduce((sum, key) => sum + score(rating, key), 0) / 4, scary: score(rating, "scary"), team: score(rating, "teamRating") };
  });
  const groupRows = (key) => {
    const groups = new Map();
    for (const row of caseRows) { const label = String(row.episode?.[key] || "").trim(); if (!label) continue; const group = groups.get(label) || { label, general: [], team: [] }; group.general.push(row.score); group.team.push(row.team); groups.set(label, group); }
    return [...groups.values()].map((group) => ({ label: group.label, score: key === "team" ? (group.general.reduce((a, b) => a + b, 0) / group.general.length + group.team.reduce((a, b) => a + b, 0) / group.team.length) / 2 : group.general.reduce((a, b) => a + b, 0) / group.general.length }));
  };
  const rank = (items, descending = true) => items.filter((item) => item.score > 0).sort((a, b) => (descending ? b.score - a.score : a.score - b.score) || a.label.localeCompare(b.label, "de")).slice(0, 5);
  const cases = caseRows.filter((row) => row.score > 0).map((row) => ({ label: row.episode?.title || row.episodeId, score: row.score }));
  const averageLabels = { fallQuality: "Fallqualität", teamRating: "Team", directionRating: "Inszenierung", tension: "Spannung", scary: "Gruselig" };
  const average = ["fallQuality", "teamRating", "directionRating", "tension", "scary"].map((key) => ({ label: averageLabels[key], score: ratings.length ? ratings.reduce((sum, rating) => sum + score(rating, key), 0) / ratings.length : 0 }));
  const overallAverage = caseRows.length ? caseRows.reduce((sum, row) => sum + row.score, 0) / caseRows.length : 0;
  return { best: rank(cases), worst: rank(cases, false), teams: rank(groupRows("team")), worstTeams: rank(groupRows("team"), false), cities: rank(groupRows("location")), worstCities: rank(groupRows("location"), false), average, overallAverage, scary: rank(caseRows.map((row) => ({ label: row.episode?.title || "", score: row.scary }))) };
}

function openStatistics(key) {
  const labels = { best: "Beste Fälle", worst: "Schlechteste Fälle", teams: "Beste Teams", worstTeams: "Schlechteste Teams", cities: "Beste Städte", worstCities: "Schlechteste Städte", average: "Durchschnitt", scary: "Gruseligste Fälle" };
  const showTeamImages = key === "teams" || key === "worstTeams";
  statTitle.textContent = labels[key];
  statList.replaceChildren(...(profileData[key] || []).map((item, index) => {
    const row = document.createElement("div");
    row.className = "profile-stat-row";
    if (showTeamImages) row.classList.add("profile-stat-team-row");
    const label = document.createElement("span");
    const name = `${index + 1}. ${item.label}`;
    if (showTeamImages) {
      const meta = document.createElement("span");
      meta.className = "profile-stat-team-meta";
      const place = document.createElement("span");
      place.textContent = `${index + 1}. Platz`;
      const rating = document.createElement("span");
      rating.textContent = `${item.score.toFixed(1)}/5`;
      meta.append(place, rating);
      const image = document.createElement("img");
      image.className = "profile-stat-team-image";
      image.src = new URL(`${teamImageSlug(item.label)}.webp`, teamAssetBase).href;
      image.alt = item.label;
      image.title = item.label;
      image.onerror = () => { image.remove(); label.textContent = name; };
      label.append(meta, image);
    } else {
      label.textContent = name;
    }
    const score = document.createElement("strong");
    score.textContent = `${item.score.toFixed(1)}/5`;
    row.append(label);
    if (!showTeamImages) row.append(score);
    return row;
  }));
  statModal.hidden = false;
}

function teamImageSlug(name) {
  const slug = String(name || "").toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, " und ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    "odenthal-und-stern": "stern-und-odenthal",
    "gorniak-schnabel-und-winkler": "gorniak-winkler-und-schnabel",
    "moormann-andersen-und-selb": "moormann-und-selb",
  }[slug] || slug;
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

document.querySelectorAll("[data-profile-stat]").forEach((button) => button.addEventListener("click", () => openStatistics(button.dataset.profileStat)));
document.querySelectorAll("[data-close-profile-stat]").forEach((element) => element.addEventListener("click", () => { statModal.hidden = true; }));

loadProfile();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js?v=51", { updateViaCache: "none" }).then((registration) => registration.update());
  });
}
