import { parseHeadlessArgs } from '../src/headless/args';
import { runHeadless } from '../src/headless/run';

async function main(): Promise<void> {
  const options = parseHeadlessArgs(process.argv.slice(2));
  await runHeadless(options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
