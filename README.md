# PUMMA

A personal life OS: tasks, projects, habits, goals, notes and a life calendar in
one prebuilt dashboard, with an AI assistant that runs on your own API key.
Source-available and self-hostable, or hosted for $2/month.

Nothing to configure before it is useful: habits are habits, goals roll up
progress from the projects and habits under them, and the capture bar files what
you type into the right place. The assistant also turns a one-sentence intent
("run a half-marathon in 6 months") into a goal → project → task plan.

<sub>PUMMA stands for Procrastination Ultimate Megasor Monster Annihilator. It
is not important.</sub>

Built with **Next.js 15** (App Router, React Server Components, Server Actions),
**TypeScript** (strict), **Tailwind CSS v4**, and **MongoDB**. Runs fully
in-memory with zero setup for local use, or against MongoDB Atlas with real
accounts for hosting.

- **Live:** [pumma.app](https://pumma.app)
- **License:** [PolyForm Noncommercial 1.0.0](LICENSE) — read it, run it, fork
  it, self-host it for free, forever, for anything that isn't commercial.
  See [License](#license).

## Features

- **Tasks & kanban** — quick-capture with `#tags`, priorities, subtasks, due
  dates (natural-language via chrono-node), and per-project boards.
- **Habits & streaks** — daily / weekly / monthly cadences with heatmaps.
- **Goals that compute** — progress rolls up automatically from linked projects
  and habit streaks.
- **Projects** — drag-and-drop kanban, per-project task detail.
- **Notes** — markdown, tags, pinning.
- **Agenda** — a live day timeline with routines, meetings, and honest "dead
  time" between them.
- **Life calendar** — every week of your life on one screen.
- **AI planner & assistant** — describe an ambition and review the generated
  plan graph before anything is created; ask questions about your own data.
  Bring your own key from any of nine providers — Anthropic, OpenAI, Google,
  OpenRouter, Groq, DeepSeek, Mistral, xAI, or a local Ollama (stored
  encrypted).
- **Auto Personal/Work switch** — the sidebar view follows your working hours.
- **MCP server** — connect PUMMA to an AI client (Claude and others) so it can
  work with your tasks, projects, goals, habits, notes and agenda. OAuth 2.1,
  with per-account switches for creating, editing and deleting that the server
  enforces on every request. See [MCP](#mcp-connecting-an-ai-client).

## Quick start (zero config)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In the default
`DATA_SOURCE=memory` mode the app boots with realistic sample data held in
process — **no database, no keys, no auth required.** Great for trying it or
developing UI.

## Running with MongoDB (real accounts)

For persistence and multi-user auth, point it at MongoDB (e.g. Atlas):

```bash
cp .env.example .env.local
# set DATA_SOURCE=mongodb, MONGODB_URI, MONGODB_DB, and BETTER_AUTH_SECRET
npm run db:setup      # create indexes + seed a demo user
npm run dev
```

- **Auth** is [Better Auth](https://better-auth.com) (email + password). It is
  only active in `mongodb` mode; `memory` mode stays authless for local dev.
- **Every record is scoped to a `userId`** — reads, writes and deletes all
  filter by the session user, so accounts are fully isolated.
- **AI features** are optional, and provider-agnostic. Each user picks a
  provider and model in Settings → Assistant and pastes their own key
  (encrypted at rest with AES-256-GCM); **Test connection** checks it in one
  call. For a self-hosted instance, `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY`
  set the default for everyone. Per-user daily quotas prevent runaway spend.

  Endpoints come from a fixed list in [`lib/ai/providers.ts`](lib/ai/providers.ts) —
  no user-supplied URLs, so the server can only reach hosts the repo names.
  Providers that can't be strictly held to a JSON schema get one automatic
  retry; small local models may still fail on the planner's larger schema.

See [`.env.example`](.env.example) for every variable, including the optional
hosted-mode settings — all off by default for self-hosted installs.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (Turbopack) on :3000 |
| `npm run build` | Production build (standalone output) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests (Vitest) |
| `npm run db:setup` | Indexes + seed (MongoDB mode) |
| `npm run db:repair-refs` | Report/unlink dangling references |
| `npm run db:migrate-auth-issuer` | One-off, required when upgrading past Better Auth 1.7 (see Deploy) |

## Architecture

- **Data layer** — a repository pattern behind `lib/db/<entity>.ts` that
  switches between `./memory/*` and `./mongo/*` on `DATA_SOURCE`. The rest of
  the app never knows which backend is live.
- **Server Actions** for every mutation, each validated with `zod` (`.strict()`)
  and scoped to the session user.
- **RSC-first** — pages fetch on the server; the client bundle stays small.
- **Security** — CSP/HSTS/frame headers, origin-checked server actions, and no
  secrets in the client bundle.

## Deploy

The repo ships a multi-stage [`Dockerfile`](Dockerfile) producing a small
Next.js standalone image, and a GitHub Actions workflow that runs the full
typecheck/lint/test/build gate before publishing to GHCR. Any reverse proxy
(Traefik, Caddy, nginx) can sit in front — set `BETTER_AUTH_URL` to your public
URL and `SERVER_ACTIONS_ALLOWED_ORIGINS` to your domain.

### Upgrading an install created before Better Auth 1.7

Run this once, against the same database, before the new image serves traffic:

```bash
npm run db:migrate-auth-issuer -- --check   # report
npm run db:migrate-auth-issuer              # write
```

1.7 rekeyed accounts on `(issuer, accountId)`. Rows written by 1.6 have no
`issuer`, so sign-in cannot find them and refuses a correct password with
"Invalid email or password". Existing sessions keep working, so an unmigrated
deploy looks completely healthy right up until people start signing in. The app
also checks at boot and prints the fix if it finds affected rows.

## MCP (connecting an AI client)

PUMMA speaks the [Model Context Protocol](https://modelcontextprotocol.io), so
an AI client can read and change your data through tools rather than by being
handed a database.

Turn it on in **Settings → Connections** (off by default), then give your
client the server URL shown there:

```
https://<your-domain>/api/mcp
```

The client opens PUMMA in your browser, you sign in, and a consent screen shows
which app is asking, what it wants, and where it will be sent back to. Nothing
is granted until you approve it, and you can disconnect any app from the same
panel.

### What it can do

Read your tasks, projects, goals, habits, notes and agenda; create and edit
them; complete tasks; log habits; and delete things if you allow it.

### What stops it

Two independent checks run on every single request, both server-side:

- **Scope** — what you granted that particular app when you connected it.
  Deleting is a separate scope from editing, so approving "create and edit"
  never implies removal.
- **Your settings** — what you currently allow any app, from the switches in
  Settings. These are enforced by PUMMA, not requested of the model, so a
  model that ignores its instructions still cannot delete anything while the
  delete switch is off. Changes take effect on the next request.

Deleting is off by default. Deleting a project (which takes its tasks with it)
always needs a second confirming call that names exactly what would be lost.

### Data from elsewhere

Meetings synced from a calendar you subscribe to are written by whoever
publishes that feed, not by you. They are labelled as untrusted when served,
their text is fenced so it reads as data rather than instructions, and the
only link surfaced is a conference URL that passed a host allowlist. You can
stop sharing them entirely from the same settings panel. They are read-only:
PUMMA will not edit or delete something it is only mirroring.

### Operator notes

- `MCP_ENABLED=0` turns the endpoint off for the whole instance regardless of
  any account's settings.
- `MCP_RATE_LIMIT_PER_MINUTE` (default 120) caps requests per user, per client.
- Requires `DATA_SOURCE=mongodb`. Run `npm run db:indexes` after upgrading, for
  the audit, rate-limit and confirmation collections.
- Every tool call is recorded (which tool, which client, what it touched, never
  the arguments or the content) and shown in Settings for 90 days.

## License

PUMMA is **source-available** under the
[PolyForm Noncommercial License 1.0.0](LICENSE). The source is public and the
license is permissive about everything except making money with it.

**Free, no permission needed** — personal use, self-hosting for yourself, your
family or your friends, study, research, hobby and amateur projects, forking and
modifying, and use by charities, schools, public research bodies and government.

**Needs a separate license** — anything commercial: using it inside a for-profit
company, selling it or a modified version, running it as a paid or ad-supported
hosted service, or bundling it into a product you charge for.

That line is the license's, not a summary you should rely on — the
[LICENSE](LICENSE) text governs. If you want to use PUMMA commercially, that's
genuinely fine and usually cheap: email
[sosa.panzardi@gmail.com](mailto:sosa.panzardi@gmail.com) and ask.

To be precise about a word people care about: this is *not* an OSI-approved
open-source license, because the noncommercial restriction fails the
[Open Source Definition](https://opensource.org/osd). Calling it
"source-available" is the honest label. Releases before 2026-08-01 were
published under the MIT license and stay MIT — this change applies going
forward.

## Contributing

Issues and PRs welcome. Run `npm run typecheck && npm run lint && npm run test`
before opening a PR. By opening a PR you agree your contribution is licensed to
the project under the same terms as [LICENSE](LICENSE), and that it may be
offered under the commercial license described above.
