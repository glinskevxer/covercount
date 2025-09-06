/**
 * Starting the read service.
 *
 * The command blocks, which is the point: it is meant to be the thing a
 * service manager runs. Everything else in this build returns and exits.
 */

import type { Command } from 'commander';
import { invalidInput } from '../../core/errors.js';
import { buildRouter } from '../../http/routes.js';
import { answer, createService, listen, SERVICE_VERSION } from '../../http/service.js';
import { render } from '../output.js';
import type { CliContext } from '../context.js';

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw invalidInput('cli.port', `${value} is not a port number`);
  }
  return parsed;
}

export function registerServeCommands(program: Command, makeContext: () => CliContext): void {
  const serve = program.command('serve').description('the read only http service');

  serve
    .command('start')
    .description('bind a port and answer read requests until stopped')
    .option('--port <port>', 'the port to bind', '8377')
    .option('--host <host>', 'the interface to bind', '127.0.0.1')
    .action(async (options: Record<string, string>) => {
      const context = makeContext();
      const service = createService({ storePath: context.storePath });
      const bound = await listen(
        service,
        port(options.port ?? '8377'),
        options.host ?? '127.0.0.1',
      );
      context.write(`covercount ${SERVICE_VERSION} reading ${context.storePath} on port ${bound}`);
      const stop = (): void => {
        void service.close();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });

  serve
    .command('routes')
    .description('every route the service answers')
    .action(() => {
      const context = makeContext();
      context.write(
        render(
          buildRouter()
            .list()
            .map((row) => ({
              method: row.method,
              pattern: row.pattern,
              description: row.description,
            })),
          { format: context.format },
        ),
      );
    });

  serve
    .command('get')
    .description('answer one request against the store without binding a port')
    .requiredOption('--path <path>', 'the path to fetch')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const db = context.openStore({ readOnly: true });
      try {
        const result = answer(
          buildRouter(),
          { db, version: SERVICE_VERSION },
          'GET',
          options.path ?? '/',
        );
        if (result.status >= 400) {
          context.writeError(result.body.trimEnd());
          process.exitCode = 1;
          return;
        }
        context.write(result.body.trimEnd());
      } finally {
        db.close();
      }
    });
}
