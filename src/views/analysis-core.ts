// vscode-free logic of the "Analysis" sidebar view: findings -> tree rows.

import type { Finding } from '../model/diagnostics';
import type { SourceRef } from '../model/types';

export interface AnalysisRow {
  kind: 'summary' | 'finding';
  label: string;
  /** Codicon id. */
  icon: string;
  /** Where the finding is, e.g. "line 12" or "/pages/0/places/1"; absent for the summary. */
  description?: string;
  source?: SourceRef;
}

/** Short text for a source reference. */
export function locationLabel(source: SourceRef | undefined): string | undefined {
  if (!source) return undefined;
  return source.file === 'sml' ? (source.line >= 1 ? `line ${source.line}` : undefined) : source.path || undefined;
}

export function summaryText(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return 'No errors';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : plural(errors, 'error');
}

/** The summary row, then one row per finding. */
export function findingsToRows(findings: Finding[]): AnalysisRow[] {
  const clean = findings.length === 0;
  const rows: AnalysisRow[] = [
    { kind: 'summary', label: summaryText(findings), icon: clean ? 'pass' : findings.some((f) => f.severity === 'error') ? 'error' : 'warning' },
  ];
  for (const f of findings) {
    rows.push({
      kind: 'finding',
      label: f.message,
      icon: f.severity === 'error' ? 'error' : 'warning',
      description: locationLabel(f.source),
      source: f.source,
    });
  }
  return rows;
}
