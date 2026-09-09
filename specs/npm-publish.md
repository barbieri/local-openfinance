# npm Publish

## Build

`prepublishOnly` runs:

```sh
pnpm run build
```

The build emits minified CLI bundles under `dist/bundle/*.mjs` with shebangs.

## Shebangs

Bundled CLI shebangs come from the TypeScript entrypoint source.

Do not add an esbuild `banner` shebang.

Node only accepts `#!` at byte 0, and duplicated shebangs break direct
`node dist/bundle/*.mjs` execution.

## Published files

The package `files` field ships:

- CLI bundles under `dist/bundle/` including `dist/bundle/migrations/`
- Vite production client under `dist/client/` (required by `serve`)
- `src/db/migrations/`
- `schemas/`
- examples
- `.env.example`, `LICENSE`, `README.md`

## Prepare behavior

`prepare` skips Husky during `pnpm pack` and `pnpm publish` so packaging does
not try to mutate `.git/config`.

`prepare` runs Husky only in a git clone with dev dependencies, not on end-user
`npm install`.

## Binary

The package binary maps:

- `local-openfinance` to `dist/bundle/*.mjs`
