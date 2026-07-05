import { emitCliResult, isMain, runTickCli } from "./cli.ts";

if (isMain(import.meta.url)) {
  await emitCliResult(runTickCli(process.argv.slice(2)));
}

export { runTickCli };
