import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const api = "https://de.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&format=json&formatversion=2&origin=*&titles=Liste_der_Tatort-Folgen";
const response = await fetch(api, { headers: { "User-Agent": "TatortTracker2/1.0 (episode sync)" } });
if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
const payload = await response.json();
const raw = payload.query.pages[0].revisions[0].content;
const clean = (value) => String(value || "").replace(/<br\s*\/?>([\s\S])*$/i, "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/\{\{DatumZelle\|([^}]+)\}\}/g, "$1").replace(/'''?/g, "").replace(/<[^>]+>/g, "").trim();
const escape = (value) => String(value ?? "").replaceAll("'", "''");
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const rows = [];
let cells = [];
let current = -1;
for (const line of raw.split(/\r?\n/)) {
  if (/^\|-/.test(line) || /^\|\}/.test(line)) {
    const no = clean(cells[0]);
    if (/^\d+$/.test(no) && cells[1]) rows.push({ no, title: clean(cells[1]), sender: clean(cells[2]), date: clean(cells[3]), investigator: clean(cells[4]), notes: clean(cells[8] || "") });
    cells = []; current = -1; continue;
  }
  if (/^!/.test(line)) continue;
  const cell = line.match(/^\|\s*(.*)$/);
  if (cell) { cells.push(...cell[1].split("||").map((part) => part.trim())); current = cells.length - 1; continue; }
  if (current >= 0 && line.trim()) cells[current] = `${cells[current]} ${line.trim()}`;
}
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const syncRows = rows.filter((row) => Number(row.no) >= 1338);
for (let offset = 0; offset < syncRows.length; offset += 50) {
  const values = syncRows.slice(offset, offset + 50).map((row) => `('${escape(row.no)}','${escape(row.title)}','${escape(row.sender)}','${escape(row.date)}','${escape(row.investigator)}','${escape(row.notes)}','[]')`).join(",");
  const sql = `INSERT OR REPLACE INTO episode_catalog (id,title,sender,air_date,investigator,notes,roles_json) VALUES ${values};\n`;
  const file = resolve(`.wrangler-wikipedia-${offset}.sql`);
  writeFileSync(file, sql, "utf8");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "tatorttracker-db", "--remote", "--yes", "--file", file], { input: "y\n", stdio: ["pipe", "inherit", "inherit"] });
  unlinkSync(file);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Synchronized ${syncRows.length} current/upcoming Wikipedia rows.`);
