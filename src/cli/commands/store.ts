/**
 * Commands about the store file itself: bringing it up to date and saying
 * what is in it. These are the commands somebody runs before anything else
 * works, so they open the store directly rather than needing a property.
 */

import type { Command } from 'commander';
import { analyse, compact, health } from '../../store/maintenance.js';
import { HOT_QUERIES, planProblems, renderPlan } from '../../store/plans.js';
import { catalogue, collectCodes } from '../../core/catalogue.js';
import { renderRoll, rollSeason } from '../../workflow/season.js';
import { rate } from '../../core/rate.js';
import { importLarder, importPrices, renderImportReport } from '../../workflow/import.js';
import { ruleViolation } from '../../core/errors.js';
import { tableNames } from '../../store/database.js';
import { appliedMigrations } from '../../store/migrate.js';
import {
  MIGRATIONS,
  TARGET_SCHEMA_VERSION,
  migrateToLatest,
  storeVersion,
} from '../../store/schema.js';
import { columns, render, renderJson, renderRecord } from '../output.js';
import { onReadStore, onStore, type CliContext } from '../context.js';
import {
  backupIsCurrent,
  backupTo,
  checkRestore,
  readBackup,
  restoreFrom,
} from '../../store/backup.js';
import { seedDemoProperty } from '../../demo/property.js';
import { countRows, exportSetup, importSetup, type SetupExport } from '../../store/transfer.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { codeArg, dateArg, listArg, percentToPpm } from '../args.js';

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

export function registerImportCommands(program: Command, makeContext: () => CliContext): void {
  const load = program.command('load').description('read a spreadsheet somebody sent over');

  load
    .command('prices')
    .description('load a price book from a comma separated file')
    .requiredOption('--book <code>', 'the price book to load into')
    .requiredOption('--file <path>', 'the file to read')
    .option('--dry-run', 'check the file and write nothing')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const report = importPrices(
          db,
          context.requireProperty(),
          codeArg(String(options.book ?? '')),
          readFileSync(String(options.file ?? ''), 'utf8'),
          { dryRun: options.dryRun === true },
        );
        context.write(context.format === 'json' ? renderJson(report) : renderImportReport(report));
        if (report.problems.length > 0) {
          throw ruleViolation(
            'import.problems',
            `${report.problems.length} row(s) would not load, so nothing was written`,
          );
        }
      }),
    );

  load
    .command('larder')
    .description('load ingredients from a comma separated file')
    .requiredOption('--file <path>', 'the file to read')
    .option('--dry-run', 'check the file and write nothing')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const report = importLarder(
          db,
          context.requireProperty(),
          readFileSync(String(options.file ?? ''), 'utf8'),
          context.now(),
          { dryRun: options.dryRun === true },
        );
        context.write(context.format === 'json' ? renderJson(report) : renderImportReport(report));
        if (report.problems.length > 0) {
          throw ruleViolation(
            'import.problems',
            `${report.problems.length} row(s) would not load, so nothing was written`,
          );
        }
      }),
    );
}

export function registerPlanCommands(program: Command, makeContext: () => CliContext): void {
  const store = program.commands.find((command) => command.name() === 'store');
  if (store === undefined) {
    throw new Error('the store command has to be registered before its plan commands');
  }

  store
    .command('plans')
    .description('whether the reads that run on every screen still seek')
    .action(
      onReadStore(makeContext, (db, context) => {
        const problems = planProblems(db);
        if (context.format === 'json') {
          context.write(renderJson(problems));
          return;
        }
        if (problems.length === 0) {
          context.write(`${HOT_QUERIES.length} hot read(s), none of them scanning`);
          return;
        }
        context.write(
          problems
            .map(
              (problem) =>
                `${problem.name} scans ${problem.scanned.join(', ')}\n${renderPlan(problem.plan)}`,
            )
            .join('\n\n'),
        );
      }),
    );
}

export function registerCatalogueCommands(program: Command, makeContext: () => CliContext): void {
  program
    .command('codes')
    .description('every refusal the domain can raise, and what kind it is')
    .option('--area <area>', 'narrow to one area, like covers or billing')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const listed = catalogue(collectCodes('src')).filter(
        (entry) => options.area === undefined || entry.area === options.area.trim().toLowerCase(),
      );
      context.write(
        render(
          listed.map((entry) => ({
            code: entry.code,
            kind: entry.kind,
            raisedIn: entry.raisedIn,
          })),
          {
            format: context.format,
            empty: 'nothing raises a code in that area',
            columns: columns('code', 'kind', 'raisedIn'),
          },
        ),
      );
    });
}

export function registerSeasonCommands(program: Command, makeContext: () => CliContext): void {
  program
    .command('season')
    .description('roll a whole property onto next season s numbers')
    .requiredOption('--from <date>', 'the date the current numbers are read on')
    .requiredOption('--to <date>', 'the date the new ones take effect')
    .requiredOption('--uplift <percent>', 'how far the numbers move, negative to cut')
    .option('--skip <books>', 'comma separated books to leave alone')
    .option('--dry-run', 'work it out and write nothing')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const roll = rollSeason(
          db,
          context.requireProperty(),
          dateArg(String(options.from ?? '')),
          dateArg(String(options.to ?? '')),
          rate(percentToPpm('uplift', String(options.uplift ?? ''))),
          {
            dryRun: options.dryRun === true,
            ...(typeof options.skip === 'string' ? { skipBooks: listArg(options.skip) } : {}),
          },
        );
        if (context.format === 'table') {
          context.write(renderRoll(roll));
          return;
        }
        context.write(
          render(
            roll.lines.map((line) => ({
              what: line.what,
              subject: line.subject,
              from: line.from.amount,
              to: line.to.amount,
            })),
            {
              format: context.format,
              empty: 'there is nothing in force on that date to roll',
              columns: columns('what', 'subject', 'from>', 'to>'),
            },
          ),
        );
      }),
    );
}

export function registerRestoreCommands(program: Command, makeContext: () => CliContext): void {
  const backup = program.commands.find((command) => command.name() === 'backup');
  if (backup === undefined) {
    throw new Error('the backup command has to be registered before its restore');
  }

  backup
    .command('check')
    .description('whether a backup is fit to put back')
    .requiredOption('--file <path>', 'the backup')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const check = checkRestore(options.file ?? '');
      context.write(
        renderRecord(
          {
            version: check.version,
            behindBy: check.behindBy,
            integrity: check.integrity,
            references: check.referenceProblems.length,
            rows: check.rows,
            properties: check.properties.join(' '),
            ok: check.ok,
          },
          { format: context.format },
        ),
      );
    });

  backup
    .command('restore')
    .description('put a backup back')
    .requiredOption('--file <path>', 'the backup')
    .requiredOption('--to <path>', 'where the store should end up')
    .option('--migrate', 'bring it up to this build on the way in')
    .option('--overwrite', 'write over a store that is already there')
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      const result = restoreFrom(
        String(options.file ?? ''),
        String(options.to ?? ''),
        (db) => migrateToLatest(db),
        { migrate: options.migrate === true, overwrite: options.overwrite === true },
      );
      context.write(
        renderRecord(
          {
            from: result.from,
            to: result.to,
            bytes: result.bytes,
            version: result.version,
            migrated: result.migrated,
          },
          { format: context.format },
        ),
      );
    });
}
