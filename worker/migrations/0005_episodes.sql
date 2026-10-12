CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  team TEXT NOT NULL,
  air_date TEXT,
  synopsis TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO episodes (id, title, team, air_date, synopsis) VALUES
  ('muenster-2026-01', 'Tatort: Der letzte Klick', 'Thiel und Boerne', '2026-01-18', 'Ein digitaler Nachlass fuehrt das Muensteraner Team in ein Netz aus alten Konflikten.'),
  ('koeln-2026-02', 'Tatort: Schattenlinie', 'Ballauf und Schenk', '2026-02-15', 'Ein Fall an einer stillgelegten Bahnstrecke stellt eine lang verdrangte Geschichte frei.'),
  ('wien-2026-03', 'Tatort: Kaltes Licht', 'Batic und Leitmayr', '2026-03-08', 'Eine Spur aus dem Wiener Nachtleben endet in einem Fall ohne einfache Antworten.'),
  ('berlin-2026-04', 'Tatort: Nebenan', 'Rubin und Karow', '2026-04-19', 'Als eine Nachbarschaft schweigt, muessen Rubin und Karow zwischen Loyalitaet und Wahrheit waehlen.'),
  ('hamburg-2026-05', 'Tatort: Stroemung', 'Falke und Grosz', '2026-05-10', 'Ein Fund im Hafen bringt eine alte Lieferkette und neue Gefahren ans Licht.'),
  ('frankfurt-2026-06', 'Tatort: Durchbruch', 'Brix und Janneke', '2026-06-21', 'Ein scheinbar klarer Fall veraendert sich mit jedem neuen Blick auf die Beweise.');

CREATE INDEX IF NOT EXISTS episodes_air_date_idx ON episodes(air_date DESC);
