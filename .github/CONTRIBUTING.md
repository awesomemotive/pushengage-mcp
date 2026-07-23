# Contributing

Thanks for your interest in improving `@pushengage/mcp`!

## How this repository works

Day-to-day development happens in an internal PushEngage repository; this public repository is a mirror that is synced after changes merge internally. That affects contributions in two ways:

- **Issues are the best way to contribute.** Bug reports and feature requests filed here reach the maintainers directly.
- **Pull requests are welcome but are not merged directly.** A maintainer reviews your PR, ports the accepted change into the internal repository, and it lands here on the next sync — credited to you in the changelog/release notes. Your PR will be closed with a pointer to the synced commit.

For anything non-trivial, please open an issue first so we can agree on the approach before you write code.

## Development setup

Requirements: Node.js 18+.

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm run dev` | Runs `src/index.ts` directly via `tsx` (no build step). |
| `npm run dev:watch` | Same, restarting on file changes. |
| `npm run build` | Type-checks and compiles `src/` to `dist/` via `tsconfig.build.json`. |
| `npm start` | Runs the compiled `dist/index.js`. |
| `npm test` / `npm run test:watch` | Runs the Jest suite. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | Biome linter (`./src`). |
| `npm run format` | Biome formatter, writes changes. |
| `npm run check` | Biome lint + format check, no writes — what CI runs. |

Linting and formatting use [Biome](https://biomejs.dev) (config in `biome.json`). A pre-commit hook (Husky + lint-staged) formats staged files automatically.

The version string in `src/version.ts` is read from `package.json` at runtime — nothing to regenerate when it changes.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(scope): ...`, where scope is the module under `src/` (e.g. `auth`, `notifications`, `campaigns`).
- **Tests are colocated** (`src/foo.ts` + `src/foo.test.ts`). New logic needs tests: schema mapping and validation exhaustively, API calls via mocked `fetch`, and each error code a tool can return.
- **Never write to stdout** in `src/` (`console.log`, `process.stdout.write`). Stdout carries the MCP JSON-RPC channel; stray output crashes the connection. Use `console.error` for diagnostics.
- New tools should follow the existing module pattern: each resource under `src/` has `api.ts` (HTTP call), `schema.ts` (Zod input schema + API body mapping) where needed, and `tools.ts` (tool registration). Every tool loads config, resolves the site, calls the API helper, and returns content or `errorResult(err)`.

## Security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](./SECURITY.md).
