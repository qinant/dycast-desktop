# AGENTS.md — dycast-desktop

## Commands

```sh
npm run dev          # Vite dev server only (UI debugging, no Tauri)
npm run tauri-dev    # Full Tauri desktop dev mode
npm run type-check   # vue-tsc type-check only
npm run build        # type-check + frontend build
npm run tauri-build  # Build desktop installer (uses src-tauri/tauri.local-build.conf.json)
npm run tauri <cmd>  # Tauri CLI passthrough
npm run version      # Sync version via scripts/sync-version.mjs
npm run changelog    # Generate full CHANGELOG.md via git-cliff (requires git-cliff installed)
npm run changelog:unreleased # Preview unreleased changes only
```

No tests, no linter, no formatter configured.

## Quick Reference

- **Stack**: Tauri 2 + Vue 3 (`<script setup lang="ts">`) + TypeScript + Vite 6 + SCSS
- **Alias**: `@/` → `src/`
- **Proxy**: `/dylive` → `https://live.douyin.com`, `/socket` → Douyin WS (Vite dev only)
- **State**: No Pinia/Vuex — reactive proxy in `src/hooks/useSettings.ts` with localStorage under key `dycast-settings`
- **Theme**: Set via `document.documentElement.dataset.theme`, persisted in settings
- **Rust min**: 1.77.2 (Cargo.toml)
- **CI**: GitHub Actions on `v*` tags, builds windows/ubuntu-22.04/macos-aarch64, signs with `TAURI_SIGNING_PRIVATE_KEY`
- **Updater**: tauri-plugin-updater, endpoints from GitHub releases, pubkey in `tauri.conf.json`
- **Comments**: All in Chinese

## Architecture

### Platform Abstraction (`src/platform/`)
`runtime.ts` detects Tauri prod (`__TAURI_INTERNALS__`) vs browser. HTTP/WS modules are loaded via dynamic `import()`:

| Layer | Tauri prod | Browser/dev |
|-------|-----------|-------------|
| HTTP  | `invoke` → Rust reqwest (shared cookie jar with webview) | `fetch` via Vite proxy to `live.douyin.com` |
| WebSocket | `TauriWebSocket` class (Rust tokio-tungstenite relay, binary as base64 events) | native `WebSocket` via proxy |
| API base | `https://live.douyin.com` | `/dylive` |

### Data Flow
Room number → `DyCast.connect()` → `fetchLiveHtml()` (parse `self.__pace_f.push(...)` state snapshot) → `fetchUser()` (seed cookies) → `getImInfo()` (cursor + internalExt) → WebSocket wss → gzip frames → `pako`/native gunzip → protobuf decode → emit

### Protobuf Decoders (`src/core/model/`)
Hand-written (no protobuf.js). Barrel via `model/index.ts`. Sub-directory:

- `core.ts` — PushFrame/Response decode/encode
- `base.ts` — ~15K lines shared types
- `messages/` — one file per message type (chat, gift, like, member, social, control, room_user_seq, room_rank, room_stats, rest)

### Lazy Message Decoders
`dycast.ts` dynamically imports decoder files on first message. First import loads `base.ts` + the specific message file; subsequent imports are cheap. Resets on disconnect.

### Key Classes
- `DyCast` (`src/core/dycast.ts:384`) — Connection lifecycle, heartbeat (10s ping), ACK, auto-reconnect (max 3)
- `RelayCast` (`src/core/relay.ts:14`) — Forwards parsed messages to external WS server
- `JsonlRecorder` (`src/utils/jsonlRecorder.ts:22`) — Records to .jsonl file (Tauri: Rust BufWriter; browser: File System Access API)
- `Emitter` (`src/core/emitter.ts:3`) — Typed event emitter used everywhere

### Rust Modules (`src-tauri/src/`)
- `lib.rs` — Tauri builder + invoke handler registration (HTTP fetch, WS relay, record, replay)
- `ws_relay.rs` — Rust-side WebSocket relay (tokio-tungstenite, base64 binary frames)
- `cast_record.rs` — JSONL file write via BufWriter
- `cast_replay.rs` — JSONL file read + timed replay
- `live_info.rs` — reqwest HTTP client (shared cookie jar with webview)
- `main.rs` — Entry point

## Important Conventions

- No external state library — use `settings` from `useSettings.ts` for persistent prefs
- All Vue components use `<script setup lang="ts">`
- Styles are SCSS
- Don't edit protobuf decoder files by hand (auto-generated)
- Vite dev server proxy handles cookie Domain rewriting (`vite.config.ts:48-58`)
- `CLAUDE.md` is gitignored (`.gitignore` line 33) but `AGENTS.md` is committed
- `docs/superpowers/specs/` — auto-generated design specs from Superpowers, tracked in git
- `tauri-build` uses a separate config that disables updater artifacts locally
- Build order: `type-check` runs before `build-only` via `npm-run-all2`
- Rust logging in debug mode via `tauri-plugin-log` (LevelFilter::Info), plus auto-opens devtools
- `update-key` / `update-key.pub` are gitignored but present on disk — never commit signing keys
- `public/mssdk.js` — ByteDance anti-bot SDK loaded in `index.html:10`, required for API requests
- `server.py` — WebSocket echo test server (port 8765) for relay debugging

## Commit Messages
Use Conventional Commits because release notes are generated from git history.
Allowed types:
- `feat:` user-facing feature
- `fix:` bug fix
- `perf:` performance improvement
- `docs:` documentation only
- `chore:` tooling, CI, dependency, maintenance

Examples:
- `feat: add WebSocket message type filters`
- `fix: handle updater download failure`
- `perf: reduce message rendering overhead`
- `docs: update release instructions`
- `chore: update release workflow`

Avoid vague messages like `update`, `fix bug`, `misc`, `wip`.
