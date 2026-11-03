export interface SummaryStep {
  id: string;
  title: string;
  mark: string;
  reason?: string;
  what?: string;
  why?: string;
  fix?: string;
  how?: string;
  docs?: string;
}

export interface SummaryNext {
  id: string;
  title: string;
  what?: string;
  why?: string;
  fix?: string;
  how?: string;
  docs?: string;
}

export interface Summary {
  done?: number;
  total?: number;
  next?: SummaryNext | null;
  steps?: SummaryStep[];
  install_only?: SummaryStep[];
  installOnly?: SummaryStep[];
}

export interface SecretEntry {
  id: string;
  file?: string;
  line?: string | number;
  what?: string;
  why?: string;
  fix?: string;
}

export interface Rerun {
  doctor?: string;
  check?: string;
}

export interface CheckResult {
  owner?: string;
  repo?: string;
  branch?: string;
  default_branch?: string | null;
  summary?: Summary;
  secrets?: SecretEntry[];
  yokoten_version?: string;
  version?: string;
  commit?: string;
  rerun?: Rerun;
  about?: string;
  [key: string]: unknown;
}

export interface FixFile {
  path: string;
  content: string;
  source?: string;
}

export interface FixesPayload {
  files: FixFile[];
  summary?: string;
  muse: string;
  claude_import?: { file: string; line: string } | null;
  after?: { done: number; total: number } | null;
  [key: string]: unknown;
}

export interface RecordPayload {
  sha256: string;
  recorded_at: string;
  document: string;
  rekor?: { url: string } | null;
  solana?: { url: string } | null;
  [key: string]: unknown;
}

export interface ViewModel {
  secretGroups: { what?: string; why?: string; fix?: string; places: string[] }[];
  secretCount: number;
  evidence: { version: string; commit: string; shortCommit: string; doctorCommand: string; checkCommand: string };
}

export type ProgressStep = "reading" | "copying" | "checking";

export interface ProgressEventData {
  step?: string;
}

export interface ErrorEventData {
  message?: string;
}

export type ResultScreen = "waiting" | "understood" | "already has" | "one more line" | "too big" | "failed" | "saved" | "not found";
export type SaveStepKey = "copy" | "paste" | "save" | "check";
export interface UnderstoodSection { title: string; lines: string[]; }
