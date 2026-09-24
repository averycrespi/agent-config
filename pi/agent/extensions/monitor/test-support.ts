import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
export const pause = (ms = 20) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export function temporaryRoot() {
  const root = mkdtempSync(join(realpathSync("/tmp"), "bg-test-"));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}
export const theme: any = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  bg: (_color: string, text: string) => text,
};
export function value(result: any) {
  const text = result.content[0].text as string;
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}
