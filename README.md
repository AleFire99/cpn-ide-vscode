# CPN IDE for VS Code

[![ci](https://github.com/AleFire99/cpn-ide-vscode/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/AleFire99/cpn-ide-vscode/actions/workflows/ci.yml)

Run [CPN IDE](https://cpnide.org/) — the editor and simulator for Coloured Petri Nets — inside VS Code, with nothing to install
beforehand. The extension ships the CPN IDE backend and UI, downloads a portable Java 17 runtime on first use, and opens
`.cpn` models in an editor tab.

> Status: early development. See the [v0.1.0 milestone](../../milestone/1).

## Platform support

| Platform | Local simulator | Notes |
|---|---|---|
| Linux x64 | yes | needs 32-bit glibc (`libc6:i386` on Debian/Ubuntu, `glibc.i686` on Fedora) |
| Windows x64 | yes | |
| macOS | no | the CPN simulator is a 32-bit binary; point `cpnIde.backendUrl` at the Docker backend |

## Simulator daemon and security

The CPN simulator runs as a separate daemon (`cpnmld`, fixed port 20001) that executes the SML code of a model. The
extension patches the bundled daemon to listen on `127.0.0.1` only, starts it in a private per-user temp directory
(`<globalStorage>/tmp/<pid>`), and stops it, with its workers, when the backend stops or exits. Because the port is
fixed, only one daemon can run per machine: a second VS Code window (or another local user) reuses the daemon already
listening on 20001, and the "CPN IDE" output channel warns when that happens. Daemons left by a crashed VS Code are
cleaned up on the next start.

## Docker backend

```sh
docker run -p 8080:8080 ghcr.io/alefire99/cpn-ide-backend:latest
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We use Git Flow: work on `feature/*` branches, open PRs into `develop`.

## License

AGPL-3.0, same as upstream [CPN IDE](https://github.com/cpn-io/cpn-js). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
