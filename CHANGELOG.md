# Changelog

## 0.1.0 — 2026-10-16

First release.

- Bundles CPN IDE 1.24.1031 (backend + UI), downloaded from the official installer at build time.
- Downloads a portable Eclipse Temurin 17 JRE on first use when no Java 17+ is found.
- `.cpn` custom editor ("Open With… → CPN IDE") with save back to the workspace file; "CPN IDE: Open" / "New Net" standalone panel.
- `cpnIde.backendUrl` to use a remote backend, e.g. the Docker image `ghcr.io/alefire99/cpn-ide-backend` (macOS).
- Security: the simulator daemon binds to 127.0.0.1 only, simulator files live in per-window temp dirs, and no simulator processes outlive the backend.
- Platforms: Linux x64 (needs 32-bit glibc), Windows x64. macOS only via a remote backend.

Known limitations: no unsaved-changes indicator for edits made in the CPN IDE UI; external file changes are not reloaded into an open editor; the simulator daemon port (20001) is shared by all backends on a machine.
