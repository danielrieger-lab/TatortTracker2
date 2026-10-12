# TatortTracker2

A vanilla JavaScript progressive web app with a Cloudflare Worker API and D1 database.

## Structure

- `src/` application JavaScript and styles
- `public/` static PWA files
- `data/` application data
- `.github/workflows/` GitHub Pages deployment
- `worker/` Worker API, D1 schema, and migrations
- `wrangler.toml` Cloudflare Worker configuration

## Local development

```powershell
python -m http.server 4173
```

Open <http://localhost:4173>.

## Cloudflare backend setup

1. Install Wrangler and authenticate:

	```powershell
	npm.cmd install
	npx wrangler login
	```

2. Create the D1 database and copy its ID into `wrangler.toml`:

	```powershell
	npx wrangler d1 create tatorttracker-db
	```

3. Apply the schema locally or remotely:

	```powershell
	npm.cmd run db:migrate:local
	npm.cmd run db:migrate:remote
	```

4. Deploy the API:

	```powershell
	npm.cmd run deploy:api
	```

The frontend uses `/api` by default. When the Worker is deployed on a separate hostname, define `window.TATORT_API_URL` before `src/app.js` loads, for example `https://api.example.com/api`. Configure `FRONTEND_ORIGIN` in `wrangler.toml` to the exact frontend origin.

The current API implements username plus private PIN authentication, secure cookie sessions, logout, current-user lookup, and four-digit friend-code lookup. There is intentionally no account recovery yet.
