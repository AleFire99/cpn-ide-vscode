# Changelog

## Unreleased

- **CPN IDE: New Net** creates `NAME.petri.json` + `NAME.sml` with a starter net in the workspace (or the Explorer folder it was run on) and opens it in the canvas, instead of an unsaved demo net (#61). The old panel is still there as **CPN IDE: Open Blank Panel**.
- **Run Simulation (No UI)** writes to its own "CPN IDE: Simulation" output channel, names places and transitions as `Page/Name` instead of internal ids, aligns the marking table and lists transitions still enabled. ANSI colour codes are stripped from the backend log (#62).
- Status bar item with the backend state (not running, starting, ready, failed, simulator down); click it to show the log, restart, stop or start the backend. New command **CPN IDE: Restart Backend**. The extension now also activates in workspaces that contain `.cpn` or `.petri.json` files, without starting Java (#64).
- Marketplace listing: rewritten README with screenshots, a getting-started guide, simulation and text-model walkthroughs, command and settings tables, and troubleshooting; clearer extension description.

## 0.3.0 — 2026-10-17

### Features

- Text models: `*.petri.json` (structure) + `*.sml` (declarations) compile to CPN Tools XML, with pages, subpages, fusion places, auto-layout, a `realtime` option and a JSON schema (`schema/petri.schema.json`).
- `*.petri.json` opens in the CPN IDE canvas. Saving there updates the JSON and leaves the `.sml` alone unless declarations changed.
- **CPN IDE: Convert to Text Model** turns a `.cpn` into `.petri.json` + `.sml` (graphics are dropped, monitors too, with a warning). Round-tripped models validate with the same initial marking.
- **CPN IDE: Export .cpn** writes the compiled model of a `.petri.json`.
- Live diagnostics: text models reload when their `.petri.json` or `.sml` changes on disk. Compile errors appear as diagnostics; with the backend running and no CPN IDE panel open, the backend's type check is reported too.
- Faster simulation (#46): the UI no longer waits a fixed 500 ms between multi-step steps. New settings `cpnIde.simulation.stepDelayMs` (default 100) and `cpnIde.simulation.animate`; the UI's verbose `console.log` output is silenced unless `cpnIde.debug` is on. The bundled UI is patched at build time (`scripts/patch-ui.mjs`); re-run `scripts/fetch-cpn.sh` to apply it to existing resources.
- **CPN IDE: Run Simulation (No UI)** simulates a `.cpn` or `.petri.json` straight on the backend and prints step count, time and final markings to the "CPN IDE" output channel.
- Examples are generated from text sources by `node scripts/gen-examples.mjs` (no CPN IDE download needed); new `04-hierarchy` example with a subpage and a fusion place.

- Extension icon and Marketplace listing; the release workflow can publish to the VS Code Marketplace and Open VSX.

### Fixes

- Two nets validated at the same time (e.g. from two CPN IDE panels) no longer hang the backend: requests go through a small local proxy that runs net creation (`POST /api/v2/cpn/init`) one at a time.
- After a backend stop, the extension waits for every closing connection on the simulator port (not only TIME-WAIT) before starting a new simulator.
- Stopping the backend kills java, the simulator daemon and every per-session simulator process synchronously, so none outlive the extension host or a test run.

## 0.2.0 — 2026-10-16

- ▶ button in the editor title bar of a `.cpn` file opens it in CPN IDE; a file icon in CPN IDE reopens it as XML text (`.CPN` works too).
- Three small example models in `examples/` (simple flow, producer/consumer, mutual exclusion) that validate cleanly; CI simulates them and checks their final markings.
- Fix: the UI no longer hangs on "validating". The extension now starts the simulator daemon itself before the backend, so Access/CPN's racy lazy start no longer runs.
- When the simulator can't start you get an error with **Retry**, **Stop stale simulator** and **Show Log**, plus a 60 s watchdog for hung validations.
- A stale simulator daemon on port 20001 is detected at startup, with an offer to stop it. After a crash the extension waits for the port to be released.

Known limitation (fixed in 0.3.0): two validations sent within ~3 s of each other can hang inside the upstream backend.

## 0.1.0 — 2026-10-16

First release.

- Bundles CPN IDE 1.24.1031 (backend + UI), downloaded from the official installer at build time.
- Downloads a portable Eclipse Temurin 17 JRE on first use when no Java 17+ is found.
- `.cpn` custom editor ("Open With… → CPN IDE") with save back to the workspace file; "CPN IDE: Open" / "New Net" standalone panel.
- `cpnIde.backendUrl` to use a remote backend, e.g. the Docker image `ghcr.io/alefire99/cpn-ide-backend` (macOS).
- Security: the simulator daemon binds to 127.0.0.1 only, simulator files live in per-window temp dirs, and no simulator processes outlive the backend.
- Platforms: Linux x64 (needs 32-bit glibc), Windows x64. macOS only via a remote backend.

Known limitations: no unsaved-changes indicator for edits made in the CPN IDE UI; external file changes are not reloaded into an open editor; the simulator daemon port (20001) is shared by all backends on a machine.
