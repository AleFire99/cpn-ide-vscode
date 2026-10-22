# Analysis

The **Analysis** view in the CPN IDE sidebar:

| Action | What it does |
|---|---|
| Check Model | Validates the model and lists errors with their location |
| Structural Analysis | Boundedness, deadlocks and invariants, with no backend |
| Analyse State Space | Explores reachable markings on the backend, dead markings and dead transitions |
| Run Replications / Export Event Log | Replication report and XES or CSV event log |

Open `05-dining-philosophers` to find a dead marking, or `06-unbounded-producer` to see an unbounded place.

Caveats: the state space is for untimed nets only, monitors are ignored, a partial search is a lower bound, and the token-count abstraction makes structural results approximate.
