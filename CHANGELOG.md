# Changelog

## Unreleased

### New

- **Run Replications and Export Event Log** in the Analysis view. Run N replications with a progress notification and open the text replication report, or record a simulation and export it as an XES or CSV event log into `play_out` next to the model (settings under `cpnIde.eventLog.*`). (#105)

## 0.6.0 — 2026-10-19

CPN IDE now has its own place in the Activity Bar. The sidebar lists the nets in your workspace, shows the structure of the open model, and gives the backend controls and the examples a home, so the commands no longer have to be found in the Command Palette.

### New

- **CPN IDE in the Activity Bar.** A new icon opens the CPN IDE sidebar. **Models** shows one row per net: `NAME.cpn`, `NAME.petri.json` and `NAME.sml` in the same folder are grouped. Click a net to open it in the canvas (the text model if there is one, else the `.cpn`), or expand it for its files, whose buttons run a headless simulation, convert a `.cpn` to text or export a text model to `.cpn`. The net you are working on is selected as you switch tabs. With no models, it offers **New Net** and **Open an Example**. **Backend** shows the same state as the status bar item, with Start/Restart, Stop and Show Log. The Docker actions appear on macOS, when `cpnIde.backendUrl` is set, or after the backend failed, and the gear in its title opens the settings. **Get Started** (collapsed) opens a bundled example in one click and links to the walkthrough and the docs. (#95, #97)
- **Net view.** The **Net** section of the sidebar lists the pages of the open `.petri.json` with their places, transitions and arcs; substitution transitions show their subpage and places their colour set. It also follows the canvas, and an open `.cpn` or `.sml` that has a `.petri.json` next to it. Click an entry to select it in the JSON, beside the canvas if that is what you are looking at. (#98)
- **CPN IDE: Start Backend.** Starts the backend without opening a model. (#95)

## 0.5.0 — 2026-10-17

This release is about writing models as text and working in VS Code's own style. `.sml` files get CPN ML highlighting and snippets, `.petri.json` gets completion, hover, go-to-definition and a one-click Simulate lens, and more compile errors show up without the backend. The canvas follows a dark theme, `.cpn` files can open in the canvas by default, Linux tells you exactly how to install 32-bit glibc, and macOS users can start the Docker backend with one command.

### New

- **Dark canvas.** In a dark or high-contrast VS Code theme the CPN IDE editor no longer shows a bright white rectangle: panels, toolbar, tabs, trees, console, inputs and the diagram follow the theme colours, with black strokes and labels turned light. Token and enabled-transition highlights keep their colours. Set `cpnIde.theme` to `light` to keep the old look. (#71)
- **Simulate CodeLens on `.petri.json`.** The top of a text model now offers `▶ Simulate 100 steps`, `Open in CPN IDE` and `Export .cpn`. A simulation run shows each place's final marking after its line (`→ 1`1++1`2`, `→ empty`) until you edit the file or click `Clear results`. The lenses can be turned off with `cpnIde.codeLens.enabled`. (#72)
- **Completion, hover and go-to-definition in `.petri.json`.** Arc `from`/`to`, place `type` and `fusion`, `subpage.page` and `ports` now complete from the model itself (colour sets come from the `.sml` plus the standard ones). Hovering a place `type` shows its `colset` declaration, and Go to Definition jumps to it in the `.sml`. (#65)
- **CPN IDE: Start Docker Backend.** One command starts (or reuses) the `cpn-ide-backend` Docker container on a free local port, waits until it answers, sets `cpnIde.backendUrl` (workspace or user) and reconnects open tabs. On macOS it is offered the first time you open a model, and the walkthrough step runs it. It can stop the container when VS Code exits, and **CPN IDE: Stop Docker Backend** stops it any time. (#69)
- **Snippets for text models.** In a `.petri.json`, type `petri` for a whole model skeleton, or `page`, `place`, `transition`, `arc` or `subpage` for one element; Tab moves between the fields. In a `.sml` file (CPN ML), `colset`, `var`, `fun` and `block` insert declarations. (#67)
- **CPN ML syntax highlighting.** `.sml` declaration files now get their own *CPN ML* language: nested comments, `(*! Block *)` markers, SML and CPN ML keywords (`colset`, `var`, `globref`, `product`, `timed`, ...), strings, numbers, multiset operators and standard colour sets are coloured, with bracket matching and comment toggling. (#63)

### Improved

- **Open `.cpn` files in the canvas by default.** The first time a `.cpn` opens as XML text, CPN IDE asks *Always open .cpn files in CPN IDE?* (**Yes**, **Not now**, **Never**). **Yes** sets `"*.cpn": "cpnIde.editor"` in `workbench.editorAssociations` and reopens the file in the canvas. Diff views (for example the Git diff) stay text and no longer start the backend. (#70)
- **Missing 32-bit glibc is detected on Linux.** Before starting the simulator, the extension checks for the 32-bit loader and, if it is missing, shows the install command for your distribution (Debian/Ubuntu, Fedora, Fedora Atomic, openSUSE, Arch) with **Copy command** and **Use Docker backend** buttons, instead of a generic "the simulator could not start". The status bar turns red with the same hint. (#68)
- **Compile errors without the backend.** An undeclared colour set on a place (for example `"type": "UNITS"`) is now reported on the `type` value as soon as you edit the `.petri.json`, next to the structural errors, instead of only after the simulator ran. Commented-out `colset` declarations do not count. (#66)
- **Shorter extension description.** The Marketplace description drops "Nothing else to install". (#90)

### Fixed

- **Headless run no longer fails with "Could not parse declaration".** Starting **CPN IDE: Run Simulation (No UI)** while the canvas was still validating could make the backend reject `sim/init`. The proxy now queues `sim/init` behind in-flight net creations, and a headless run holds that queue from its validation to its last step, so the canvas cannot restart the shared simulator in the middle of it. (#75)

### Known issues

- The `.petri.json` snippets also show up in other JSON files: VS Code cannot limit snippets to a file name pattern.
- In the dark canvas, colours you picked yourself for arcs or nodes are not adjusted, so a dark colour can be hard to see.
- **CPN IDE: Start Docker Backend** is new and has not yet been tested on macOS. If it fails, the manual steps in the README still work.

## 0.4.0 — 2026-10-17

This release is about getting started. New users get a guided walkthrough and ready-made examples, **New Net** creates a real model file you can keep, headless runs print readable results, and the status bar shows what the backend is doing.

### New

- **Get Started walkthrough.** After installing, the Welcome page offers *Get Started with CPN IDE* (also under **Help → Welcome** or **Welcome: Open Walkthrough**). It takes you through opening an example, simulating it, writing your own net, the one-time platform setup (32-bit glibc on Linux, the Docker backend on macOS) and the main settings. Each step has a button that does the step for you. (#60)
- **CPN IDE: Open Example** copies one of the four bundled examples (simple flow, producer/consumer, mutual exclusion, hierarchy) into `cpn-examples/` in your workspace and opens it in the canvas. It never overwrites a copy you already edited; it just opens it again. The examples now ship inside the extension. (#60)
- **Backend status in the status bar.** A *CPN IDE* item shows the backend state: ○ not running, a spinner while it starts, ✓ ready (the tooltip names the backend URL and the Java in use), and red when the backend or the simulator failed. Click it for **Show Backend Log**, **Restart Backend** (or **Start Backend**), **Stop Backend** and **Settings**. It appears next to `.cpn`, `.petri.json` and `.sml` files and whenever the backend is running. (#64)
- **CPN IDE: Restart Backend** restarts the backend and simulator and reloads every open CPN IDE tab, without reloading the VS Code window. (#64)

### Improved

- **CPN IDE: New Net creates a model on disk.** It asks for a name and writes `NAME.petri.json` + `NAME.sml` with a small starter net (`Start → Go → End` with one token) into the workspace, or into the folder you right-clicked in the Explorer, then opens it in the canvas. It asks before overwriting existing files. Before, New Net opened CPN IDE's demo net in a panel that was not tied to any file; that panel is still available as **CPN IDE: Open Blank Panel**. (#61)
- **Readable headless results.** **CPN IDE: Run Simulation (No UI)** now writes to its own *CPN IDE: Simulation* output channel instead of the backend log. Places are named `Page/Place` instead of internal ids, the final marking is printed as an aligned table, empty places say `empty`, and transitions that are still enabled are listed:

  ```
  Simulated 100 step(s) in 1301 ms
  Final marking:
    MutualExclusion/Idle      1`1++ 1`2
    MutualExclusion/Lock      1`()
    MutualExclusion/Critical  empty
  Still enabled: MutualExclusion/Enter
  ```

  It also finds a model that is open in another tab, so it works when started from the walkthrough. (#62, #60)
- **Cleaner backend log.** The *CPN IDE* output channel no longer shows the backend's ANSI colour codes. (#62)
- **Better Marketplace page.** The README was rewritten with screenshots, a getting-started guide, simulation and text-model walkthroughs, tables of commands and settings, and a troubleshooting section. The extension description says more clearly what it does.
- The extension now activates in workspaces that contain `.cpn` or `.petri.json` files, so the status bar item and commands are there right away. Java still starts only when you open a model.

### Known issues

- A headless run started while the canvas is still validating the same model can fail with *"Could not parse declaration val P_HIGH"*. Wait until the canvas reports "Model is correct" and run it again. (#75)

## 0.3.0 — 2026-10-17

This release adds **text models**: you can write a Coloured Petri Net as plain JSON plus CPN ML, keep it in version control, and still edit and simulate it in the CPN IDE canvas. Simulation is also much faster.

### New

- **Text models.** A net can be written as two files: `NAME.petri.json` for pages, places, transitions and arcs, and `NAME.sml` for the CPN ML declarations (colour sets, variables, functions). They compile to CPN Tools XML and support subpages with port/socket assignments, fusion places, guards, time, priorities, code segments and real-valued time (`"realtime": true`). Positions are optional: nodes without one are laid out automatically. The standard declarations (`UNIT`, `BOOL`, `INT`, `STRING`, `P_HIGH`, ...) are added for you. A JSON schema (`schema/petri.schema.json`) gives completion and validation while you type.
- **Edit text models in the canvas.** Opening a `.petri.json` shows the net in CPN IDE. Saving there writes the changes back to the JSON and leaves the `.sml` untouched unless the declarations changed.
- **Live reload and diagnostics.** The canvas reloads when the `.petri.json` or `.sml` changes on disk. Compile errors (unknown nodes, bad references, ...) appear in the Problems panel at the right line. When the backend is running and no CPN IDE tab is open, saved models are also type-checked by the simulator.
- **CPN IDE: Convert to Text Model** turns an existing `.cpn` into `.petri.json` + `.sml`. Graphics and monitors are dropped, with a warning. A converted model validates with the same initial marking as the original.
- **CPN IDE: Export .cpn** writes the compiled `.cpn` of a text model, for use in CPN Tools or the standalone CPN IDE.
- **CPN IDE: Run Simulation (No UI)** simulates a `.cpn` or `.petri.json` for a number of steps directly on the backend and prints the step count, time and final markings.
- **New example** `04-hierarchy`: a *Worker* subpage behind a substitution transition, with a fusion place shared by both pages. All examples are now generated from text sources.
- **Marketplace listing** with an extension icon. Releases can be published to the VS Code Marketplace and Open VSX.

### Improved

- **Faster simulation.** The bundled UI waited a fixed 500 ms between the steps of a multi-step run. The delay is now a setting, `cpnIde.simulation.stepDelayMs` (default 100 ms, 0 for full speed), and the token animation can be turned off with `cpnIde.simulation.animate`. (#46)
- **Quieter UI.** CPN IDE's verbose console output (full request and response payloads) is silenced unless `cpnIde.debug` is on.

### Fixed

- Validating two nets at the same time, for example from two CPN IDE tabs, could hang the backend. Net creation now goes through a small local proxy that runs one at a time.
- After a backend stop, a new simulator could fail to start because the old connections on its port were still closing. The extension now waits for every closing connection, not only TIME-WAIT.
- Simulator processes could outlive VS Code or a test run. Stopping the backend now kills Java, the simulator daemon and every simulator process right away.

## 0.2.0 — 2026-10-16

This release makes `.cpn` files quicker to open and the simulator much more reliable.

### New

- **▶ in the editor title bar.** A `.cpn` file (also `.CPN`) opened as text has a ▶ button that opens it in CPN IDE. In CPN IDE, a file icon reopens it as XML text.
- **Example models** in `examples/`: simple flow, producer/consumer and mutual exclusion. They validate cleanly, and CI simulates them and checks their final markings.

### Fixed

- **The UI no longer hangs on "Validating...".** The upstream backend started the simulator lazily and could race with the first validation. The extension now starts the simulator daemon itself before the backend.
- **Clear errors when the simulator cannot start**, with **Retry**, **Stop stale simulator** and **Show Log** buttons. A validation that hangs for 60 s is reported the same way instead of spinning forever.
- **Stale simulators.** A simulator daemon left on port 20001 (for example by a crashed VS Code) is detected at startup, with an offer to stop it. After a crash, the extension waits for the port to be released before starting a new one.

### Known issues

- Two validations sent within about 3 seconds of each other can hang inside the upstream backend (fixed in 0.3.0).

## 0.1.0 — 2026-10-16

First release: [CPN IDE](https://cpnide.org/), the editor and simulator for Coloured Petri Nets, running inside VS Code with nothing to install beforehand.

### New

- **CPN IDE in VS Code.** Bundles CPN IDE 1.24.1031 (Java backend and UI), taken from the official installer at build time. Open a `.cpn` file with **Open With... → CPN IDE** to edit and simulate it; saving writes back to the workspace file. **CPN IDE: Open** and **CPN IDE: New Net** open CPN IDE in a standalone panel.
- **Java is set up for you.** If no Java 17+ is found (`cpnIde.javaPath`, `JAVA_HOME` or `java` on the PATH), a portable Eclipse Temurin 17 runtime is downloaded on first use.
- **Remote backend.** `cpnIde.backendUrl` points the extension at an external backend, such as the Docker image `ghcr.io/alefire99/cpn-ide-backend`. This is how to use the extension on macOS.
- **Security.** The simulator daemon listens on 127.0.0.1 only, its files live in a private temp directory per VS Code window, and no simulator process outlives the backend.
- **Platforms:** Linux x64 (needs 32-bit glibc) and Windows x64. macOS only through a remote backend.

### Known issues

- Edits made inside CPN IDE do not mark the editor as having unsaved changes.
- Changes made to a `.cpn` file outside VS Code are not reloaded into an open editor.
- The simulator port (20001) is fixed, so all backends on a machine share one simulator daemon.
