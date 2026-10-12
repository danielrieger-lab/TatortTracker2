import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const catalog = JSON.parse(readFileSync(new URL("../data/tatort-episodes.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
const escapeSql = (value) => String(value ?? "").replaceAll("'", "''");
const wrangler = resolve("node_modules/.bin/wrangler.cmd");

for (let offset = 0; offset < catalog.length; offset += 20) {
  const rows = catalog.slice(offset, offset + 20).map((episode) => [
    episode.no,
    episode.title,
    episode.sender,
    episode.date,
    episode.ermittler,
    episode.location,
    episode.besonderheiten,
    "[]",
  ].map(escapeSql));
  const values = rows.map((row) => `('${row.join("','")}')`).join(",");
  const sql = `INSERT OR REPLACE INTO episode_catalog (id, title, sender, air_date, investigator, location, notes, roles_json) VALUES ${values};`;
  const command = process.platform === "win32" ? "cmd.exe" : wrangler;
  const args = process.platform === "win32" ? ["/d", "/s", "/c", wrangler, "d1", "execute", "tatorttracker-db", "--remote", "--command", sql] : ["d1", "execute", "tatorttracker-db", "--remote", "--command", sql];
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Imported ${catalog.length} episodes.`);
