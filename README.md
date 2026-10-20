# Curio

A browser extension that sparks curiosity while you read, without getting in the way.

While you read an article, a paper or watch a video, Curio occasionally offers **one short, optional idea** about what's in front of you: a surprising fact, an open question, an analogy, a real-world use. You can ignore it, rate it, save it, or ask for more. Over time it learns which kinds of ideas help *you*, and when it's better to stay quiet.

It is not a chatbot and not a notification machine. Silence is a valid outcome: the goal is more of your own questions, not more screen time.

## How it works

- **Ask for an idea:** select text and click the **Curio** button next to it, press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>, or use the side panel. The idea appears in a small card in the corner of the page.
- **Go deeper:** from the card, choose **Tell me more** or **Ask** a question about it.
- **Videos and PDFs:** on YouTube, ideas are about what is being said around the current moment (from the captions). PDFs open in your usual viewer; Curio reads the file itself and each idea draws on a different part of it (its chapters, or sections of a few pages). PDF ideas appear in the side panel. For local files, enable **Allow access to file URLs** for Curio in the extensions page.
- **Automatic suggestions (opt-in):** when you stay on a page for about 45 seconds or select a long passage, Curio decides whether an idea is worth offering. At most one every few minutes, once per page, and never on mail, chats, social feeds, account or banking pages.
- **Learning:** each answer (*Helpful*, *Not interested*, *Distracting*) updates a Thompson Sampling bandit per idea type. Ignoring a card is not counted as failure.
- **Insights:** the side panel shows what it learned, how often it stayed silent, latency, and a comparison of sessions with and without suggestions.

Every decision goes through the same pipeline, and every outcome is logged, including `none`:

```
rules (cooldown, per-session cap, control arm, too little content)
  → assessor: Jev → small LLM → conservative rule     (good moment? distraction risk? fitting idea types)
  → bandit: Thompson Sampling over the fitting types, with `none` as an arm
  → LLM writes one short idea → rule-based verifier (length, links, relevance) → one retry or `none`
```

## Quick start

Requirements: Node.js 22+, a Chromium-based browser (Chrome, Brave, Edge, Arc…) and an OpenAI API key.

```bash
git clone https://github.com/antoniolorenz01/curio.git && cd curio
npm install
cp .env.example .env        # set OPENAI_API_KEY
npm run dev                 # starts the API and builds the extension in watch mode
```

Then load the extension once:

1. Open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode** and click **Load unpacked**.
2. Pick `apps/extension/.output/chrome-mv3-dev`. The folder starts with a dot; in the file picker press <kbd>Ctrl</kbd>+<kbd>L</kbd> and paste the path, or <kbd>Ctrl</kbd>+<kbd>H</kbd> to show hidden folders.
3. Pin Curio from the extensions menu.

While `npm run dev` runs, changes reload the extension automatically. If you restart it, click reload on Curio in the extensions page.

By default `npm run dev` doesn't open a browser. To have WXT launch a separate browser profile instead, create `apps/extension/web-ext.config.ts` (gitignored) with `export default defineWebExtConfig({ binaries: { chrome: '/path/to/browser' } })`.

### Keeping your data

Without a database the API keeps everything in memory and loses it on restart. To persist it:

1. Create a [Supabase](https://supabase.com) project.
2. Run `supabase/migrations/*.sql` in its SQL editor (or `supabase db push`).
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the project's **secret** key) in `.env`.

Row level security is enabled with no policies, so only the API's secret key can read or write.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | required | Writes and evaluates ideas |
| `OPENAI_MODEL` / `OPENAI_MODEL_FAST` | `gpt-5.4-mini` / `gpt-5.4-nano` | Writing model / condensing and assessing model |
| `OPENAI_REASONING_EFFORT` / `_FAST` | `medium` / `none` | Reasoning effort per model tier; `medium` writes noticeably better ideas, `low` is faster |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | empty | Persistence; in-memory when empty |
| `TYPESAFE_API_KEY` | empty | Enables [Jev](https://docs.typesafe.ai) as the assessor; `JEV_ENABLED=false` turns it off |
| `LANGSMITH_API_KEY` | empty | Enables LangSmith tracing; `LANGSMITH_TRACING=false` turns it off |
| `HOST`, `PORT` | `127.0.0.1`, `8787` | Where the API listens |
| `CURIO_DEV` | `false` | Development mode: automatic suggestions skip cooldowns and silence, and appear after ~5 s on a page |
| `API_TOKEN` | empty | Required when `HOST` isn't local |

Jev, LangSmith and Supabase are optional and independent. Removing a key falls back cleanly: no Jev → small LLM assessor; no LangSmith → no tracing; no Supabase → memory. On startup the API prints what's active, e.g. `store=supabase assessor=jev>llm>conservative langsmith=off`.

In the extension, **Settings** holds your interests, which idea types to allow, the cooldown, the per-session cap, the share of control sessions, and the language ideas are written in.

## Privacy and security

- The API runs on your machine by default (`127.0.0.1`), needs no account, and only accepts requests from the extension: requests from web pages are rejected by origin and bodies must be JSON.
- Only a condensed summary of what you read is stored, never full page text. Sensitive sites (mail, chats, accounts, banking) are never read.
- Page content is treated as untrusted data in every prompt; instructions embedded in pages are not followed.
- To run the API on a server, set `HOST=0.0.0.0` and an `API_TOKEN` (e.g. `openssl rand -hex 24`), then enter the server URL and token in the extension under **Settings → Advanced**.

## Project structure

```
apps/extension/     WXT + React side panel, content script (selection button and in-page card), background worker
apps/api/           Hono API on Node: rules, assessors, bandit, generator, verifier, follow-ups, insights
packages/contracts/ Shared Zod schemas and types, including the list of endpoints
supabase/           SQL migrations
```

## Development

```bash
npm run dev          # API + extension in watch mode
npm run dev:api      # API only
npm run dev:ext      # extension only
npm test             # API tests (engine units and the full flow with a fake LLM)
npm run typecheck    # all workspaces
npm run build:ext    # production build in apps/extension/.output/chrome-mv3
npm run icons -w @curio/extension   # regenerate PNG icons from assets/icon.svg
```

## License

[MIT](LICENSE)
