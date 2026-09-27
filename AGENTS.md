# Repository Guidelines

## Project Structure & Module Organization

`src/extension/` contains the Chrome extension: its manifest, popup, content script, and background script. `src/server/` contains the local HTTP service, session logic, retrieval code, SQLite helper, and reading-page assets in `public/`. Shared TypeScript contracts live in `src/shared/types.ts`; the macOS Vision OCR helper is `src/ocr/Ocr.m`. `tests/*.test.mjs` contains automated tests. `scripts/copy.mjs` copies runtime assets into `dist/`, which is generated and ignored. Local state lives in the ignored `data/` directory.

## Build, Test, and Development Commands

- `npm install` installs the TypeScript toolchain.
- `npm run build` compiles TypeScript, copies assets, and builds the native OCR executable. It requires macOS, Clang, and Apple frameworks.
- `npm start` runs the built local service at `127.0.0.1:47831`.
- `npm test` builds first, then runs all `tests/*.test.mjs` with Node's test runner.

After rebuilding, reload `dist/extension/` in `chrome://extensions` and restart the service to test extension changes. Use Node.js 20 or newer.

## Coding Style & Naming Conventions

TypeScript uses strict mode, ES modules, two-space indentation, single quotes, and semicolons. Match the surrounding style in Objective-C, Python, HTML, and CSS. Use `camelCase` for variables and functions, `PascalCase` for types, and descriptive lowercase file names such as `followups.ts`. Imports of local TypeScript modules use `.js` extensions for NodeNext output. No formatter or linter is configured; keep diffs focused and follow existing patterns.

## Testing Guidelines

Add behavior tests as `tests/<feature>.test.mjs` using `node:test` and `node:assert/strict`. Tests import compiled files from `dist/`, so run `npm test` rather than invoking the test runner before a build. Cover changes to session limits, API behavior, extension output, and database handling where relevant. Verify X page interactions manually in a signed-in Chrome session; offline tests cannot reproduce its live DOM or account state.

## Configuration & Security

Copy `.env.example` to `.env` and set `TYPESAFE_API_KEY`; never commit credentials or `data/`. Edit `PREFERENCE.md` and `search-seeds.json` to change session preferences and search terms. The service is intended to listen only on localhost.

## Commits & Pull Requests

This directory has no Git history to establish a commit convention. Use short, imperative subjects that name the changed area, such as `server: cap follow-up visits`. In pull requests, explain the behavior change, list `npm test` results, link any related issue, and include screenshots for popup or reading-page changes.
