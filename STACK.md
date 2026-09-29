# USTEC stack

The local app is two processes. Vite serves the pages. The API serves
queries, charts, and saved cases. `cases.html` calls the API, so the UI
alone is not enough.

## Start both

From `ustec-demo`:

```bash
npm install
npm run dev
```

`npm run dev` runs `src/node/dev.ts`, which starts both processes and
stops both on Ctrl+C. One child exiting stops the other.

| Process | Command inside `dev` | Default URL | What it serves |
| --- | --- | --- | --- |
| UI | Vite | <http://localhost:5173> | `/`, `/help.html`, `/cases.html` |
| API | `src/node/serve.ts` | <http://localhost:5200> | `/api/*` and `/cases/<id>/...` |

Open the URL Vite prints. If 5173 is already taken, Vite moves to the
next free port and prints that URL. The API stays on 5200.

Pages:

- <http://localhost:5173/> — chart
- <http://localhost:5173/help.html> — help
- <http://localhost:5173/cases.html> — saved cases; fetches `http://localhost:5200/api/artifacts`
- <http://localhost:5200/api/report/<caseId>> — redirects to that case's report
- <http://localhost:5200/cases/<caseId>/report/index.html> — report HTML

`npm run dev` does not forward extra flags. To change a port, start the
two processes separately.

## Start one process

Two terminals, still from `ustec-demo`:

```bash
npm run serve-api
npm run dev:ui
```

| Script | Process | Port |
| --- | --- | --- |
| `npm run dev` | UI and API | 5173 and 5200 |
| `npm run dev:ui` | Vite only | 5173, or the next free port |
| `npm run serve-api` | API only | 5200 |

API port: `--port` or `PORT`.

```bash
npm run serve-api -- --port 5300
PORT=5300 npm run serve-api
```

`cases.html` still calls `http://localhost:5200` unless the page URL has
`?api=`. Example: <http://localhost:5173/cases.html?api=http://localhost:5300>.

Vite port:

```bash
npm run dev:ui -- --port 5173
```

Use `localhost`, not `127.0.0.1`, for the Vite URL. Vite binds `::1`.
The API listens on all interfaces.

## Check

```bash
curl -fsS http://localhost:5200/api/artifacts
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:5173/cases.html
```

`Cannot reach the API at http://localhost:5200` means the API process is
down, or the page is pointed at a different URL. Start `npm run serve-api`,
or open the page with `?api=<url>`.

## Not part of the running stack

`query`, `analyze`, `chart`, and `report` are one-shot CLIs. They do not
need to stay running. A report they write shows up in `cases.html` once
the API is up.

`npm run preview` serves the built UI only. Case files are still served
by the API, not by that preview server.
