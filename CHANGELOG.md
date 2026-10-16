# Changelog

## Unreleased

- Text model format: `*.petri.json` (structure) + `*.sml` (declarations) compile to CPN Tools XML, with pages, subpages, fusion places, auto-layout and a JSON schema (`schema/petri.schema.json`).
- Example models are now generated from text sources by `node scripts/gen-examples.mjs` (no CPN IDE download needed); new `04-hierarchy` example with a subpage and a fusion place.
- **CPN IDE: Convert to Text Model** turns a `.cpn` into `.petri.json` + `.sml`, dropping graphics (monitors are dropped with a warning). Round-tripped models validate with the same initial marking. New `realtime` spec option for real-valued model time.
- `*.petri.json` opens in the CPN IDE canvas. Saving there updates the JSON and leaves the `.sml` alone unless declarations changed. **CPN IDE: Export .cpn** writes the compiled model.
- Text models reload when their `.petri.json` or `.sml` changes on disk. Compile errors appear as diagnostics; with the backend running and no CPN IDE panel open, the backend's type check is reported too.

## 0.2.0 — 2026-10-16

- ▶ button in the editor title bar of a `.cpn` file opens it in CPN IDE; a file icon in CPN IDE reopens it as XML text (`.CPN` works too).
- Three small example models in `examples/` (simple flow, producer/consumer, mutual exclusion) that validate cleanly; CI simulates them and checks their final markings.
- Fix: the UI no longer hangs on "validating". The extension now starts the simulator daemon itself before the backend, so Access/CPN's racy lazy start no longer runs.
- When the simulator can't start you get an error with **Retry**, **Stop stale simulator** and **Show Log**, plus a 60 s watchdog for hung validations.
- A stale simulator daemon on port 20001 is detected at startup, with an offer to stop it. After a crash the extension waits for the port to be released.

Known limitation: two validations sent within ~3 s of each other can still hang inside the upstream backend (the UI sends one at a time).

## 0.1.0 — 2026-10-16

First release.

- Bundles CPN IDE 1.24.1031 (backend + UI), downloaded from the official installer at build time.
- Downloads a portable Eclipse Temurin 17 JRE on first use when no Java 17+ is found.
- `.cpn` custom editor ("Open With… → CPN IDE") with save back to the workspace file; "CPN IDE: Open" / "New Net" standalone panel.
- `cpnIde.backendUrl` to use a remote backend, e.g. the Docker image `ghcr.io/alefire99/cpn-ide-backend` (macOS).
- Security: the simulator daemon binds to 127.0.0.1 only, simulator files live in per-window temp dirs, and no simulator processes outlive the backend.
- Platforms: Linux x64 (needs 32-bit glibc), Windows x64. macOS only via a remote backend.

Known limitations: no unsaved-changes indicator for edits made in the CPN IDE UI; external file changes are not reloaded into an open editor; the simulator daemon port (20001) is shared by all backends on a machine.
