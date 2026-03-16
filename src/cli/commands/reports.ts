/**
 * The sheets people print. Every one of them takes a date or a function and
 * writes either the rendered sheet or the underlying rows as JSON, so the same
 * command feeds a printer and a spreadsheet.
 */

import type { Command } from 'commander';
import { busyDays, forecast, renderForecast } from '../../reports/forecast.js';
import { daySheet, renderDaySheet } from '../../reports/daysheet.js';
import { formatMoney } from '../../core/money.js';
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
import { columns, render, renderJson, renderRecord } from '../output.js';
import { dateArg, entityArg } from '../args.js';
import { onReadStore, type CliContext } from '../context.js';

export function registerReportCommands(program: Command, makeContext: () => CliContext): void {
  const report = program.command('sheet').description('the sheets people print');

  report
    .command('production')
    .description('the production sheet for one function, by station')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const sheet = productionSheet(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(sheet, null, 2) : renderProductionSheet(sheet),
        );
      }),
    );

  report
    .command('pick')
    .description('the pick list for one date, by store')
    .requiredOption('--date <date>', 'the service date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const list = pickList(db, context.requireProperty(), calendarDate(options.date ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(list, null, 2) : renderPickList(list),
        );
      }),
    );

  report
    .command('trips')
    .description('how many packs come out of each store on a date')
    .requiredOption('--date <date>', 'the service date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );

  report
    .command('board')
    .description('the function board for one date')
    .requiredOption('--date <date>', 'the date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const board = functionBoard(
          db,
          context.requireProperty(),
          calendarDate(options.date ?? ''),
        );
        context.write(
          context.format === 'json' ? JSON.stringify(board, null, 2) : renderFunctionBoard(board),
        );
      }),
    );

  report
    .command('reader')
    .description('what goes on the lobby screen')
    .requiredOption('--date <date>', 'the date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const rows = readerBoard(db, context.requireProperty(), calendarDate(options.date ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(rows, null, 2) : renderReaderBoard(rows),
        );
      }),
    );

  report
    .command('staffing')
    .description('who is called in on one date')
    .requiredOption('--date <date>', 'the date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const sheet = staffingSheet(
          db,
          context.requireProperty(),
          calendarDate(options.date ?? ''),
        );
        context.write(
          context.format === 'json' ? JSON.stringify(sheet, null, 2) : renderStaffingSheet(sheet),
        );
      }),
    );
}

export function registerResumeCommands(program: Command, makeContext: () => CliContext): void {
  const resume = program.command('resume').description('one booking on one page');

  resume
    .command('show')
    .description('every function on a booking with the covers and the money')
    .requiredOption('--booking <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const built = conferenceResume(db, entityArg('booking', options.booking ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(built, null, 2) : renderResume(built),
        );
      }),
    );

  resume
    .command('open')
    .description('only what is still open on a booking')
    .requiredOption('--booking <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );
}

export function registerForecastCommands(program: Command, makeContext: () => CliContext): void {
  const pace = program.command('pace').description('what is coming, day by day');

  pace
    .command('range')
    .description('covers and revenue across a date range')
    .requiredOption('--from <date>', 'the first date')
    .requiredOption('--to <date>', 'the last date')
    .option('--all-days', 'include the days with nothing on them')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const found = forecast(
          db,
          context.requireProperty(),
          dateArg(String(options.from ?? '')),
          dateArg(String(options.to ?? '')),
        );
        if (context.format === 'table' && options.allDays !== true) {
          context.write(renderForecast(found));
          return;
        }
        const days = options.allDays === true ? found.days : busyDays(found);
        context.write(
          render(
            days.map((day) => ({
              date: day.serviceDate,
              functions: day.functions,
              definite: day.definiteCovers,
              held: day.heldCovers,
              revenue: formatMoney(day.definiteRevenue),
              tentative: formatMoney(day.heldRevenue),
              labour: formatMoney(day.labour),
            })),
            {
              format: context.format,
              empty: 'nothing on the books',
              columns: columns(
                'date',
                'functions>',
                'definite>',
                'held>',
                'revenue>',
                'tentative>',
                'labour>',
              ),
            },
          ),
        );
      }),
    );

  pace
    .command('summary')
    .description('the totals across a range, without the daily detail')
    .requiredOption('--from <date>', 'the first date')
    .requiredOption('--to <date>', 'the last date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const found = forecast(
          db,
          context.requireProperty(),
          dateArg(options.from ?? ''),
          dateArg(options.to ?? ''),
        );
        context.write(
          renderRecord(
            {
              from: found.from,
              to: found.to,
              days: busyDays(found).length,
              definite: found.definiteCovers,
              held: found.heldCovers,
              revenue: formatMoney(found.definiteRevenue),
              tentative: formatMoney(found.heldRevenue),
              labour: formatMoney(found.labour),
              unpriced: found.unpriced,
            },
            { format: context.format },
          ),
        );
      }),
    );
}

export function registerDaySheetCommands(program: Command, makeContext: () => CliContext): void {
  program
    .command('today')
    .description('the one page somebody reads at seven in the morning')
    .requiredOption('--date <date>', 'the date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const sheet = daySheet(db, context.requireProperty(), dateArg(options.date ?? ''));
        if (context.format === 'json') {
          context.write(renderJson(sheet));
          return;
        }
        if (context.format === 'csv') {
          context.write(
            render(
              sheet.functions.map((row) => ({
                function: row.functionId,
                name: row.name,
                room: row.room,
                covers: row.covers,
                guaranteed: row.guaranteed,
                crew: row.heads,
              })),
              {
                format: context.format,
                empty: 'nothing on the books',
                columns: columns('function', 'name', 'room', 'covers>', 'guaranteed', 'crew>'),
              },
            ),
          );
          return;
        }
        context.write(renderDaySheet(sheet));
      }),
    );
}
