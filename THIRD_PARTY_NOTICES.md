# Third-party notices

This extension builds on the following third-party software.

## CPN IDE

- Components: frontend (editor and simulator UI) and Spring Boot backend
- Copyright: © CPN IDE authors (Eindhoven University of Technology / cpn-io)
- License: GNU Affero General Public License v3.0 (AGPL-3.0)
- Source: https://github.com/cpn-io/cpn-js
- Project: https://cpnide.org

The bundled UI ships its own `3rdpartylicenses.txt` with the licenses of its dependencies.

## Access/CPN

- License: GNU Lesser General Public License v2.1 (LGPL-2.1)
- Project: https://cpntools.org/access-cpn/

## CPN Tools simulator

- Based on Standard ML of New Jersey (SML/NJ). Bundled inside the Access/CPN engine jar.
- License: GNU General Public License v2.0 (GPL-2.0)
- Project: https://cpntools.org

### Modification: simulator daemon binds loopback only

The upstream `cpnmld` daemon (`cpnmld.x86-linux`, `cpnmld.x86-cygwin`) binds `INADDR_ANY`, exposing the simulator
to the network. `scripts/patch-cpnmld.mjs` (run by `scripts/fetch-cpn.sh`) changes that single `bind()` address
immediate to `127.0.0.1` inside the redistributed engine jar, after verifying the SHA-256 of the original
binaries. No other bytes change. The macOS daemon is not patched (the local simulator is unsupported there).

## Eclipse Temurin JRE

- Java runtime downloaded on first use. It is not bundled with this extension.
- License: GNU General Public License v2.0 with the Classpath Exception (GPL-2.0 with Classpath Exception)
- Project: https://adoptium.net

## Binaries are not stored in this repository

The CPN IDE binaries are downloaded from the official CPN IDE installer by `scripts/fetch-cpn.sh` and placed in `resources/`. They are not stored in this repository.

## javascript-lp-solver

- Use: linear and mixed-integer programming for structural analysis (state equation), bundled into the extension.
- License: MIT
- Project: https://github.com/JWally/jsLPSolver
