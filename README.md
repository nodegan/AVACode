<p align="center">
  <img src="apps/web/public/logo.svg" width="160" alt="AVA Code logo">
</p>

# AVA Code

AVA Code is a fork of [t3code](https://github.com/pingdotgg/t3code) with tasks integration — an "agent harness control surface" for controlling coding agents on your machine from the web or desktop.

## Requirements

AVA Code requires [OpenCode](https://opencode.ai). Install it and run `opencode auth login` before use.

## Run

Requires Node.js 22.16+, 23.11+, or 24.10+:

```bash
npx t3@latest
```

This launches the backend on your machine plus the local web app to control your agents. Use `npx t3@latest --help` for the full CLI reference.

## Build from source

AVA Code uses Vite+, so install the global `vp` CLI first:

```bash
curl -fsSL https://vite.plus | bash
```

Then install dependencies and start dev:

```bash
vp i
vp run dev
```

## Documentation

Full docs live in [docs/](./docs). Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).
