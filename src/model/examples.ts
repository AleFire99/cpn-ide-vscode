// The example models shipped in examples/ (offered by "CPN IDE: Open Example" and the walkthrough). vscode-free.

/** Bundled examples (examples/<id>.petri.json + .sml + .cpn). */
export const EXAMPLES = [
  { id: '01-simple-flow', label: 'Simple flow', detail: 'Three UNIT tokens move from Start to Done; the net stops after 3 steps' },
  { id: '02-producer-consumer', label: 'Producer / consumer', detail: 'A guarded counter produces items 1..5 into a buffer; a consumer takes them out' },
  { id: '03-mutual-exclusion', label: 'Mutual exclusion', detail: 'Two processes share one lock, so at most one is ever in Critical' },
  { id: '04-hierarchy', label: 'Hierarchy', detail: 'A Worker subpage behind a substitution transition, with a fusion place' },
] as const;
