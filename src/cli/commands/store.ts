/**
 * Commands about the store file itself: bringing it up to date and saying
 * what is in it. These are the commands somebody runs before anything else
 * works, so they open the store directly rather than needing a property.
 */

import type { Command } from 'commander';
import { analyse, compact, health } from '../../store/maintenance.js';
import { tableNames } from '../../store/database.js';
import { appliedMigrations } from '../../store/migrate.js';
import { MIGRATIONS, TARGET_SCHEMA_VERSION, storeVersion } from '../../store/schema.js';
import { columns, render, renderJson, renderRecord } from '../output.js';
import { onReadStore, onStore, type CliContext } from '../context.js';
import { backupIsCurrent, backupTo, readBackup } from '../../store/backup.js';
import { seedDemoProperty } from '../../demo/property.js';
import { countRows, exportSetup, importSetup, type SetupExport } from '../../store/transfer.js';
import { readFileSync, writeFileSync } from 'node:fs';

export function registerStoreCommands(program: Command, makeContext: () => CliContext): void {
  const store = program.command('store').description('the property store file');

  store
    .command('init')
    .description('create the store and bring it up to the schema this build carries')
    .action(
      onStore(makeContext, (db, context) => {
        context.write(
          renderRecord(
            {
              store: context.storePath,
              version: storeVersion(db),
              tables: tableNames(db).length,
            },
            { format: context.format },
          ),
        );
      }),
    );

  store
    .command('status')
    .description('report the schema version and the migrations applied')
    .action(
      onReadStore(makeContext, (db, context) => {
        const applied = appliedMigrations(db);
        context.write(
          render(
            applied.map((row) => ({
              id: row.id,
              name: row.name,
              checksum: row.checksum,
              applied: row.appliedAt,
            })),
            {
              format: context.format,
              empty: 'no migrations have been applied',
              columns: columns('id>', 'name', 'checksum', 'applied'),
            },
          ),
        );
      }),
    );

  store
    .command('migrations')
    .description('list the migrations this build carries')
    .action(() => {
      const context = makeContext();
      context.write(
        render(
          MIGRATIONS.map((migration) => ({
            id: migration.id,
            name: migration.name,
            statements: migration.statements.length,
            target: migration.id === TARGET_SCHEMA_VERSION,
          })),
          {
            format: context.format,
            columns: columns('id>', 'name', 'statements>', 'target'),
          },
        ),
      );
    });
}

export function registerBackupCommands(program: Command, makeContext: () => CliContext): void {
  const backup = program.command('backup').description('copies of the store');

  backup
    .command('take')
    .description('copy the store consistently, without stopping the office')
    .requiredOption('--to <path>', 'where to write it')
    .action(async (options: Record<string, string>) => {
      const context = makeContext();
      const db = context.openStore();
      try {
        const result = await backupTo(db, options.to ?? '');
        context.write(
          renderRecord(
            {
              path: result.path,
              bytes: result.bytes,
              version: result.version,
              tables: result.tables,
            },
            { format: context.format },
          ),
        );
      } finally {
        db.close();
      }
    });

  backup
    .command('read')
    .description('look inside a backup without migrating it')
    .requiredOption('--path <path>', 'the backup')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const summary = readBackup(options.path ?? '');
      context.write(
        renderRecord(
          {
            path: summary.path,
            bytes: summary.bytes,
            version: summary.version,
            behindBy: summary.behindBy,
            tables: summary.tables.length,
            current: backupIsCurrent(summary.path),
          },
          { format: context.format },
        ),
      );
    });

  backup
    .command('migrations')
    .description('the migrations a backup carries')
    .requiredOption('--path <path>', 'the backup')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      context.write(
        render(
          readBackup(options.path ?? '').migrations.map((row) => ({
            id: row.id,
            name: row.name,
            applied: row.appliedAt,
          })),
          {
            format: context.format,
            empty: 'that backup carries no migrations',
            columns: columns('id>', 'name', 'applied'),
          },
        ),
      );
    });
}

export function registerDemoCommands(program: Command, makeContext: () => CliContext): void {
  const demo = program.command('demo').description('a property to look at');

  demo
    .command('seed')
    .description('build a whole property, rooms, menu, kitchen, crew and rates')
    .action(
      onStore(makeContext, (db, context) => {
        const result = seedDemoProperty(db, context.now());
        context.write(
          renderRecord(
            {
              property: result.propertyCode,
              rooms: result.rooms,
              items: result.items,
              packages: result.packages,
              recipes: result.recipes,
              equipment: result.equipment,
            },
            { format: context.format },
          ),
        );
      }),
    );
}

export function registerTransferCommands(program: Command, makeContext: () => CliContext): void {
  const setup = program.command('setup').description('moving a property between stores');

  setup
    .command('export')
    .description('write the property setup out as JSON')
    .option('--to <path>', 'write to a file instead of standard output')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const payload = exportSetup(db, context.requireProperty(), context.now());
        const json = JSON.stringify(payload, null, 2);
        if (options.to === undefined) {
          context.write(json);
          return;
        }
        writeFileSync(options.to, `${json}\n`, 'utf8');
        context.write(
          renderRecord(
            { path: options.to, property: payload.propertyCode, rows: countRows(payload) },
            { format: context.format },
          ),
        );
      }),
    );

  setup
    .command('import')
    .description('read a property setup in, optionally under a new code')
    .requiredOption('--from <path>', 'the export to read')
    .option('--as <code>', 'bring it in under a different property code')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const payload = JSON.parse(readFileSync(options.from ?? '', 'utf8')) as SetupExport;
        const result = importSetup(db, payload, {
          ...(options.as === undefined ? {} : { asPropertyCode: options.as }),
        });
        context.write(
          renderRecord(
            { property: result.propertyCode, tables: result.tables, rows: result.rows },
            { format: context.format },
          ),
        );
      }),
    );
}

export function registerMaintenanceCommands(program: Command, makeContext: () => CliContext): void {
  const store = program.commands.find((command) => command.name() === 'store');
  if (store === undefined) {
    throw new Error('the store command has to be registered before its maintenance commands');
  }

  store
    .command('health')
    .description('whether the file is intact and what is in it')
    .action(
      onReadStore(makeContext, (db, context) => {
        const report = health(db);
        if (context.format === 'json') {
          context.write(renderJson(report));
          return;
        }
        context.write(
          [
            renderRecord(
              {
                schema: report.schemaVersion,
                integrity: report.integrity,
                references: report.referenceProblems.length,
                tables: report.tables,
                rows: report.rows,
                bytes: report.pages.bytes,
                reclaimable: report.pages.reclaimable,
              },
              { format: context.format },
            ),
            '',
            render(
              report.biggest.map((size) => ({ table: size.table, rows: size.rows })),
              {
                format: context.format,
                empty: 'nothing in the store',
                columns: columns('table', 'rows>'),
              },
            ),
          ].join('\n'),
        );
      }),
    );

  store
    .command('compact')
    .description('hand the free pages back to the filesystem')
    .action(
      onStore(makeContext, (db, context) => {
        const result = compact(db);
        context.write(
          renderRecord(
            {
              before: result.before.bytes,
              after: result.after.bytes,
              freed: result.bytesFreed,
              pagesReclaimed: result.before.freePages,
            },
            { format: context.format },
          ),
        );
      }),
    );

  store
    .command('analyse')
    .description('refresh the statistics the query planner reads')
    .action(
      onStore(makeContext, (db, context) => {
        context.write(renderRecord({ statistics: analyse(db) }, { format: context.format }));
      }),
    );
}
