CREATE TABLE IF NOT EXISTS episode_catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sender TEXT NOT NULL,
  air_date TEXT,
  investigator TEXT,
  location TEXT,
  notes TEXT,
  roles_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS episode_catalog_title_idx ON episode_catalog(title);
CREATE INDEX IF NOT EXISTS episode_catalog_date_idx ON episode_catalog(air_date);
