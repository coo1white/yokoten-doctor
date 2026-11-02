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
  headline: string;
  score: { done: number; total: number; text: string };
  next: SummaryNext | null;
  others: (SummaryStep & { label: string })[];
  installOnly: SummaryStep[];
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

export type StepKey = "files" | "install" | "hand";

export type FilesBlock = "hidden" | "waiting" | "lost" | "list" | "nothing";

export interface HandItem {
  id: string;
  title: string;
  wrong: string;
  list: string[];
  command: string;
  after: string;
}

export interface PlanAction {
  label: string;
  href: string;
  opensChart: boolean;
  isQuiet: boolean;
}

export interface ResultPlan {
  done: number;
  total: number;
  isAfterKnown: boolean;
  afterDone: number;
  gain: number;
  installSteps: SummaryStep[];
  movedToInstall: SummaryStep[];
  handCount: number;
  handItems: HandItem[];
  isHandListShort: boolean;
  segments: string[];
  legend: { swatch: string; text: string }[];
  action: PlanAction | null;
  filesBlock: FilesBlock;
  filesTitle: string;
  filesAreStep: boolean;
  stepOrder: StepKey[];
  installStepNumber: number;
  handTitle: string;
}
