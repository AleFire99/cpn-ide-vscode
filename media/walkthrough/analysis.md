# Analysis

Press **Analyse** in the **Analysis** view of the CPN IDE sidebar. It runs three steps on the open `.cpn` or
`.petri.json`, with the results in one place:

| Step | What it does |
|---|---|
| Check Model | Validates the model and lists errors with their location. If there are errors, the run stops here |
| Structural Analysis | Boundedness, deadlocks and invariants, with no backend |
| Analyse State Space | Explores reachable markings on the backend: bounds, dead markings and dead transitions |

**Save Report** writes the results to a text file. **Run Replications** and **Export Event Log** are in the `...` menu.
The three steps are also separate commands in the Command Palette.

If the structural analysis finds a place that may be unbounded, Analyse State Space asks before exploring (**Explore
anyway (capped)**). The search stops with a witness, the place and the firing path, as soon as a reached marking covers
an earlier one on its path. "Unbounded" is proved only when every place has colour set `UNIT`; otherwise the result is
"Likely unbounded". A search cut short by `cpnIde.stateSpace.maxStates` or `cpnIde.stateSpace.timeoutSeconds` is
Inconclusive.

Open `05-dining-philosophers` to find a dead marking, or `06-unbounded-producer` to see an unbounded place.

Caveats: the state space is for untimed nets only, monitors are ignored, and the token-count abstraction makes
structural results approximate.
