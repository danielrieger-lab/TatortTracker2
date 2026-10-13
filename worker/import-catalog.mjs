import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const catalog = JSON.parse(readFileSync(new URL("../data/tatort-episodes.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
const escapeSql = (value) => String(value ?? "").replaceAll("'", "''");
const wrangler = resolve("node_modules/.bin/wrangler.cmd");
const seenIds = new Set();
const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

for (let offset = 0; offset < catalog.length; offset += 50) {
  const rows = catalog.slice(offset, offset + 50).map((episode) => {
    const baseId = String(episode.no);
    const id = seenIds.has(baseId) ? `${baseId}-${slugify(episode.title)}` : baseId;
    seenIds.add(baseId);
    return [
    id,
    episode.title,
    episode.sender,
    episode.date,
    episode.ermittler,
    episode.location,
    episode.besonderheiten,
    JSON.stringify(Array.isArray(episode.roles) ? episode.roles : []),
  ].map(escapeSql);
  });
  const values = rows.map((row) => `('${row.join("','")}')`).join(",");
  const sql = `INSERT OR REPLACE INTO episode_catalog (id, title, sender, air_date, investigator, location, notes, roles_json) VALUES ${values};\n`;
  const filePath = resolve(`.wrangler-catalog-${offset}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const command = process.platform === "win32" ? "cmd.exe" : wrangler;
  const commandLine = `echo y|${wrangler} d1 execute tatorttracker-db --remote --file ${filePath}`;
  const args = process.platform === "win32" ? ["/d", "/s", "/c", commandLine] : ["d1", "execute", "tatorttracker-db", "--remote", "--file", filePath];
  const result = spawnSync(command, args, { stdio: "inherit" });
  unlinkSync(filePath);
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Imported ${catalog.length} episodes.`);
