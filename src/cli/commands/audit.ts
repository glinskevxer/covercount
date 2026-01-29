/**
 * The sweep, on the command line. It exits non zero when it finds an error,
 * so it can be the last thing a nightly job runs.
 */

import type { Command } from 'commander';
import { countByLevel, renderFindings, sweepAll } from '../../audit/sweep.js';
import { columns, render } from '../output.js';
import { dateArg } from '../args.js';
import { onReadStore, type CliContext } from '../context.js';

export function registerAuditCommands(program: Command, makeContext: () => CliContext): void {
  const audit = program.command('audit').description('look for what has quietly stopped adding up');

  audit
    .command('sweep')
    .description('every finding across the property')
    .requiredOption('--today <date>', 'the date the office believes it is')
    .option('--from <date>', 'only look at functions on or after this date')
    .option('--errors-only', 'leave the warnings out')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const all = sweepAll(db, context.requireProperty(), {
          today: dateArg(String(options.today ?? '')),
          ...(options.from === undefined ? {} : { from: dateArg(String(options.from)) }),
        });
        const findings =
          options.errorsOnly === true ? all.filter((row) => row.level === 'error') : all;

        context.write(
          context.format === 'json' ? JSON.stringify(findings, null, 2) : renderFindings(findings),
        );
        if (countByLevel(findings).error > 0) {
          process.exitCode = 1;
        }
      }),
    );

  audit
    .command('counts')
    .description('how many findings there are, by level')
    .requiredOption('--today <date>', 'the date the office believes it is')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const counts = countByLevel(
          sweepAll(db, context.requireProperty(), { today: dateArg(options.today ?? '') }),
        );
        context.write(
          render(
            [
              { level: 'error', count: counts.error },
              { level: 'warning', count: counts.warning },
            ],
            {
              format: context.format,
              columns: columns('level', 'count>'),
            },
          ),
        );
      }),
    );
}
