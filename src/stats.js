const API_BASE = window.TATORT_API_URL || "https://my-worker.tatorttracker.workers.dev/api";
const status = document.querySelector("#stats-status");

async function loadStatistics() {
  try {
    const response = await fetch(`${API_BASE}/statistics`, { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Statistik konnte nicht geladen werden.");
    document.querySelector("#stats-content").hidden = false;
    status.hidden = true;
    document.querySelector("#stat-rated").textContent = data.overview.rated;
    document.querySelector("#stat-watched").textContent = data.overview.watched;
    document.querySelector("#stat-average").textContent = data.overview.average ?? "-";
    const categories = [["Fallqualität", data.categories.fallQuality], ["Team", data.categories.team], ["Inszenierung", data.categories.direction], ["Spannung", data.categories.tension], ["Gruseligkeit", data.categories.scary]];
    document.querySelector("#category-list").replaceChildren(...categories.map(([label, value]) => {
      const item = document.createElement("div"); item.className = "category-item";
      const name = document.createElement("span"); name.textContent = label;
      const score = document.createElement("strong"); score.textContent = value ?? "-";
      item.append(name, score); return item;
    }));
    renderRank("best-list", data.best, "score");
    renderRank("scary-list", data.scary, "score");
    renderRank("team-list", data.teams, "score");
    renderRank("city-list", data.cities, "score");
  } catch (error) { status.textContent = error.message; }
}

function renderRank(id, items, key) {
  const list = document.querySelector(`#${id}`);
  list.replaceChildren(...items.map((item) => { const row = document.createElement("li"); const label = document.createElement("span"); label.textContent = item.title || item.label; const score = document.createElement("strong"); score.textContent = `${item[key]}/10`; row.append(label, score); return row; }));
}

loadStatistics();
