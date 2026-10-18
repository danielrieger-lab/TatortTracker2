CREATE TABLE ratings_0_5 (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fall_quality INTEGER NOT NULL DEFAULT 3 CHECK (fall_quality BETWEEN 0 AND 5),
  team_rating INTEGER NOT NULL DEFAULT 3 CHECK (team_rating BETWEEN 0 AND 5),
  direction_rating INTEGER NOT NULL DEFAULT 3 CHECK (direction_rating BETWEEN 0 AND 5),
  tension INTEGER NOT NULL DEFAULT 3 CHECK (tension BETWEEN 0 AND 5),
  scary INTEGER NOT NULL DEFAULT 3 CHECK (scary BETWEEN 0 AND 5),
  watched_date TEXT,
  watch_count INTEGER NOT NULL DEFAULT 1 CHECK (watch_count BETWEEN 1 AND 999),
  favorite_character TEXT NOT NULL DEFAULT '',
  least_favorite_character TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, episode_id)
);

INSERT INTO ratings_0_5 (
  user_id, episode_id, score, created_at, updated_at, fall_quality, team_rating,
  direction_rating, tension, scary, watched_date, watch_count,
  favorite_character, least_favorite_character, notes
)
SELECT
  user_id, episode_id,
  CAST(ROUND(score / 2.0) AS INTEGER),
  created_at, updated_at,
  CAST(ROUND(fall_quality / 2.0) AS INTEGER),
  CAST(ROUND(team_rating / 2.0) AS INTEGER),
  CAST(ROUND(direction_rating / 2.0) AS INTEGER),
  CAST(ROUND(tension / 2.0) AS INTEGER),
  CAST(ROUND(scary / 2.0) AS INTEGER),
  watched_date, watch_count, favorite_character, least_favorite_character, notes
FROM ratings;

DROP TABLE ratings;
ALTER TABLE ratings_0_5 RENAME TO ratings;
CREATE INDEX ratings_episode_id_idx ON ratings(episode_id);
