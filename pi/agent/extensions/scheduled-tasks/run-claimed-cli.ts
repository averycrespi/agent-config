import { emitCliResult, isMain, runClaimedCli } from "./cli.ts";

if (isMain(import.meta.url)) {
  await emitCliResult(runClaimedCli(process.argv.slice(2)));
}

export { runClaimedCli };
