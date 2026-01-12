/**
 * The sheets people print. Every one of them takes a date or a function and
 * writes either the rendered sheet or the underlying rows as JSON, so the same
 * command feeds a printer and a spreadsheet.
 */

import type { Command } from 'commander';
import { calendarDate } from '../../core/calendar.js';
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
import { conferenceResume, renderResume } from '../../reports/resume.js';
import { columns, render } from '../output.js';
import { entityArg } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

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
          const sheet = productionSheet(db, entityArg('functionSlot', options.function ?? ''));
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
                columns: columns('store', 'packs>'),
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

export function registerResumeCommands(program: Command, makeContext: () => CliContext): void {
  const resume = program.command('resume').description('one booking on one page');

  resume
    .command('show')
    .description('every function on a booking with the covers and the money')
    .requiredOption('--booking <id>', 'the booking')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const built = conferenceResume(db, entityArg('booking', options.booking ?? ''));
          context.write(
            context.format === 'json' ? JSON.stringify(built, null, 2) : renderResume(built),
          );
        },
        { readOnly: true },
      );
    });

  resume
    .command('open')
    .description('only what is still open on a booking')
    .requiredOption('--booking <id>', 'the booking')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const built = conferenceResume(db, entityArg('booking', options.booking ?? ''));
          const rows = built.rows.flatMap((row) =>
            row.open.map((item) => ({
              function: row.functionId,
              date: row.serviceDate,
              name: row.name,
              open: item,
            })),
          );
          context.write(
            render(rows, { format: context.format, empty: 'nothing is open on that booking' }),
          );
        },
        { readOnly: true },
      );
    });
}
