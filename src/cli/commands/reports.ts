/**
 * The sheets people print. Every one of them takes a date or a function and
 * writes either the rendered sheet or the underlying rows as JSON, so the same
 * command feeds a printer and a spreadsheet.
 */

import type { Command } from 'commander';
import { calendarDate } from '../../core/calendar.js';
import { parseEntityId } from '../../core/ids.js';
import {
  packsByStore,
  pickList,
  productionSheet,
  renderPickList,
  renderProductionSheet,
} from '../../reports/kitchen.js';
import {
  functionBoard,
  readerBoard,
  renderFunctionBoard,
  renderReaderBoard,
  renderStaffingSheet,
  staffingSheet,
} from '../../reports/house.js';
import { render } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

function slotId(value: string) {
  return parseEntityId('functionSlot', value);
}

export function registerReportCommands(program: Command, makeContext: () => CliContext): void {
  const report = program.command('sheet').description('the sheets people print');

  report
    .command('production')
    .description('the production sheet for one function, by station')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const sheet = productionSheet(db, slotId(options.function ?? ''));
          context.write(
            context.format === 'json'
              ? JSON.stringify(sheet, null, 2)
              : renderProductionSheet(sheet),
          );
        },
        { readOnly: true },
      );
    });

  report
    .command('pick')
    .description('the pick list for one date, by store')
    .requiredOption('--date <date>', 'the service date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const list = pickList(db, context.requireProperty(), calendarDate(options.date ?? ''));
          context.write(
            context.format === 'json' ? JSON.stringify(list, null, 2) : renderPickList(list),
          );
        },
        { readOnly: true },
      );
    });

  report
    .command('trips')
    .description('how many packs come out of each store on a date')
    .requiredOption('--date <date>', 'the service date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const list = pickList(db, context.requireProperty(), calendarDate(options.date ?? ''));
          context.write(
            render(
              packsByStore(list).map((row) => ({ store: row.store, packs: row.packs })),
              {
                format: context.format,
                empty: 'nothing to pick',
                columns: [{ key: 'store' }, { key: 'packs', align: 'right' }],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });

  report
    .command('board')
    .description('the function board for one date')
    .requiredOption('--date <date>', 'the date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const board = functionBoard(
            db,
            context.requireProperty(),
            calendarDate(options.date ?? ''),
          );
          context.write(
            context.format === 'json' ? JSON.stringify(board, null, 2) : renderFunctionBoard(board),
          );
        },
        { readOnly: true },
      );
    });

  report
    .command('reader')
    .description('what goes on the lobby screen')
    .requiredOption('--date <date>', 'the date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const rows = readerBoard(db, context.requireProperty(), calendarDate(options.date ?? ''));
          context.write(
            context.format === 'json' ? JSON.stringify(rows, null, 2) : renderReaderBoard(rows),
          );
        },
        { readOnly: true },
      );
    });

  report
    .command('staffing')
    .description('who is called in on one date')
    .requiredOption('--date <date>', 'the date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const sheet = staffingSheet(
            db,
            context.requireProperty(),
            calendarDate(options.date ?? ''),
          );
          context.write(
            context.format === 'json' ? JSON.stringify(sheet, null, 2) : renderStaffingSheet(sheet),
          );
        },
        { readOnly: true },
      );
    });
}
