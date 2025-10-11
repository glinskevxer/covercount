/**
 * The sweep, on the command line. It exits non zero when it finds an error,
 * so it can be the last thing a nightly job runs.
 */

import type { Command } from 'commander';
import { countByLevel, renderFindings, sweep } from '../../audit/sweep.js';
import { render } from '../output.js';
import { dateArg } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

export function registerAuditCommands(program: Command, makeContext: () => CliContext): void {
  const audit = program.command('audit').description('look for what has quietly stopped adding up');

  audit
    .command('sweep')
    .description('every finding across the property')
    .requiredOption('--today <date>', 'the date the office believes it is')
    .option('--from <date>', 'only look at functions on or after this date')
    .option('--errors-only', 'leave the warnings out')
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const all = sweep(db, context.requireProperty(), {
            today: dateArg(String(options.today ?? '')),
            ...(options.from === undefined ? {} : { from: dateArg(String(options.from)) }),
          });
          const findings =
            options.errorsOnly === true ? all.filter((row) => row.level === 'error') : all;

          context.write(
            context.format === 'json'
              ? JSON.stringify(findings, null, 2)
              : renderFindings(findings),
          );
          if (countByLevel(findings).error > 0) {
            process.exitCode = 1;
          }
        },
        { readOnly: true },
      );
    });

  audit
    .command('counts')
    .description('how many findings there are, by level')
    .requiredOption('--today <date>', 'the date the office believes it is')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const counts = countByLevel(
            sweep(db, context.requireProperty(), { today: dateArg(options.today ?? '') }),
          );
          context.write(
            render(
              [
                { level: 'error', count: counts.error },
                { level: 'warning', count: counts.warning },
              ],
              {
                format: context.format,
                columns: [{ key: 'level' }, { key: 'count', align: 'right' }],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });
}
