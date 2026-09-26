export interface Index {
  id: string;
  path: string;
  text: string | null;
  values: Record<string, string> | null;
  digest: string | null;
}
export function digest(text: string): string;
export function readIndex(cwd: string, id: string): Promise<Index>;
export function persistIndex(request: {
  cwd: string;
  id: string;
  expected: string | null;
  values: Record<string, string>;
  attemptId: string;
}): Promise<unknown>;
export function updateIndex(request: {
  cwd: string;
  id: string;
  expected: string | null;
  changes: Record<string, string | null>;
  attemptId: string;
}): Promise<unknown>;
