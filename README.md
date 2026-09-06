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

### Desktop artifacts

Build installable desktop artifacts after compiling the workspace packages:

```bash
pnpm run build:desktop        # compile all workspace packages
pnpm run dist:desktop:linux   # AppImage (x64)  -> release/
pnpm run dist:desktop:dmg     # macOS dmg
pnpm run dist:desktop:win     # Windows NSIS installer
```

Artifacts land in `release/`. The Linux and macOS builds also compile the
resource monitor, so a Rust toolchain must be on your `PATH`.

To try a desktop build without installing it, extract it and run in place:

```bash
./release/AVA-Code-<version>-x86_64.AppImage --appimage-extract
./squashfs-root/t3code
```

To run a local desktop build alongside an installed AVA Code or T3 Code, give
it its own state, port, and window identity — desktop builds otherwise share
state and a fixed backend port with the installed app:

```bash
export T3CODE_HOME=~/.t3-ava                        # isolated state
export T3CODE_PORT=3775                             # isolated backend port
export T3CODE_DESKTOP_ENTRY_NAME=ava-code.desktop   # taskbar icon + grouping
```

## Documentation

Full docs live in [docs/](./docs). Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).
