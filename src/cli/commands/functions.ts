/**
 * Commands for the functions inside a booking, and for the diary they sit in.
 */

import type { Command } from 'commander';
import { catalogCode, parseEntityId } from '../../core/ids.js';
import { calendarDate } from '../../core/calendar.js';
import { invalidInput } from '../../core/errors.js';
import {
  addFunction,
  editFunction,
  listFunctions,
  requireFunction,
  setFunctionStatus,
} from '../../booking/functions.js';
import { findClashes, functionsOnDate } from '../../booking/diary.js';
import { isFunctionStatus } from '../../booking/types.js';
import { render, renderRecord } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

function wholeNumber(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidInput('cli.number', `${label} takes a whole number, got ${value}`);
  }
  return parsed;
}

/** A time on the clock, or one past midnight written as 25:30. */
export function blockMinute(label: string, value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw invalidInput('cli.time', `${label} takes a time in HH:MM form, got ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) {
    throw invalidInput('cli.time', `${value} names minute ${minutes}`);
  }
  if (hours > 35) {
    throw invalidInput('cli.time', `${value} is too far into the following day`);
  }
  return hours * 60 + minutes;
}

export function registerFunctionCommands(program: Command, makeContext: () => CliContext): void {
  const fn = program.command('function').description('the functions inside a booking');

  fn.command('add')
    .description('put a function in a room')
    .requiredOption('--booking <id>', 'the booking it belongs to')
    .requiredOption('--room <code>', 'the room')
    .requiredOption('--name <name>', 'what it is called on the order')
    .requiredOption('--date <date>', 'the service date')
    .requiredOption('--start <time>', 'when guests arrive, HH:MM')
    .requiredOption('--end <time>', 'when it finishes, past 24:00 if it runs late')
    .requiredOption('--setup <style>', 'the setup style')
    .requiredOption('--service <style>', 'the service style')
    .option('--covers <covers>', 'covers the salesperson expects', '0')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const created = addFunction(
          db,
          parseEntityId('booking', options.booking ?? ''),
          {
            spaceCode: options.room ?? '',
            name: options.name ?? '',
            serviceDate: options.date ?? '',
            startMinute: blockMinute('start', options.start ?? ''),
            endMinute: blockMinute('end', options.end ?? ''),
            setupStyle: options.setup ?? '',
            serviceStyle: options.service ?? '',
            expectedCovers: wholeNumber('covers', options.covers ?? '0'),
          },
          context.now(),
          context.actor,
        );
        context.write(
          renderRecord(
            {
              id: created.id,
              booking: created.bookingId,
              room: created.spaceCode,
              name: created.name,
              date: created.serviceDate,
              start: created.startMinute,
              end: created.endMinute,
              setup: created.setupStyle,
              service: created.serviceStyle,
              covers: created.expectedCovers,
              status: created.status,
            },
            { format: context.format },
          ),
        );
      });
    });

  fn.command('list')
    .description('the functions on a booking')
    .requiredOption('--booking <id>', 'the booking')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listFunctions(db, parseEntityId('booking', options.booking ?? '')).map((row) => ({
                id: row.id,
                name: row.name,
                room: row.spaceCode,
                date: row.serviceDate,
                start: row.startMinute,
                end: row.endMinute,
                setup: row.setupStyle,
                service: row.serviceStyle,
                covers: row.expectedCovers,
                status: row.status,
              })),
              { format: context.format, empty: 'that booking carries no functions' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerFunctionChangeCommands(
  program: Command,
  makeContext: () => CliContext,
): void {
  const slot = program.command('slot').description('moving a function once it exists');

  slot
    .command('move')
    .description('change a function that is still live')
    .requiredOption('--id <id>', 'the function')
    .option('--room <code>', 'a new room')
    .option('--date <date>', 'a new service date')
    .option('--start <time>', 'a new start')
    .option('--end <time>', 'a new end')
    .option('--setup <style>', 'a new setup style')
    .option('--covers <covers>', 'a new expected cover count')
    .option('--name <name>', 'a new name')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const updated = editFunction(
          db,
          parseEntityId('functionSlot', options.id ?? ''),
          {
            ...(options.room === undefined ? {} : { spaceCode: options.room }),
            ...(options.date === undefined ? {} : { serviceDate: options.date }),
            ...(options.start === undefined
              ? {}
              : { startMinute: blockMinute('start', options.start) }),
            ...(options.end === undefined ? {} : { endMinute: blockMinute('end', options.end) }),
            ...(options.setup === undefined ? {} : { setupStyle: options.setup }),
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.covers === undefined
              ? {}
              : { expectedCovers: wholeNumber('covers', options.covers) }),
          },
          context.now(),
          context.actor,
        );
        context.write(
          renderRecord(
            {
              id: updated.id,
              room: updated.spaceCode,
              date: updated.serviceDate,
              start: updated.startMinute,
              end: updated.endMinute,
              covers: updated.expectedCovers,
            },
            { format: context.format },
          ),
        );
      });
    });

  slot
    .command('status')
    .description('hold, confirm, release or cancel a function')
    .requiredOption('--id <id>', 'the function')
    .requiredOption('--to <status>', 'held, definite, released or cancelled')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const to = (options.to ?? '').trim().toUpperCase();
        if (!isFunctionStatus(to)) {
          throw invalidInput('cli.status', `${options.to ?? ''} is not a function status`);
        }
        const updated = setFunctionStatus(
          db,
          parseEntityId('functionSlot', options.id ?? ''),
          to,
          context.now(),
          context.actor,
        );
        context.write(
          renderRecord({ id: updated.id, status: updated.status }, { format: context.format }),
        );
      });
    });

  slot
    .command('show')
    .description('one function')
    .requiredOption('--id <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const found = requireFunction(db, parseEntityId('functionSlot', options.id ?? ''));
          context.write(
            renderRecord(
              {
                id: found.id,
                booking: found.bookingId,
                name: found.name,
                room: found.spaceCode,
                date: found.serviceDate,
                start: found.startMinute,
                end: found.endMinute,
                setup: found.setupStyle,
                service: found.serviceStyle,
                covers: found.expectedCovers,
                status: found.status,
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerDiaryCommands(program: Command, makeContext: () => CliContext): void {
  const diary = program.command('diary').description('what is in the rooms on a date');

  diary
    .command('day')
    .description('the function board for one date')
    .requiredOption('--date <date>', 'the date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              functionsOnDate(db, context.requireProperty(), calendarDate(options.date ?? '')).map(
                (row) => ({
                  id: row.id,
                  start: row.startMinute,
                  end: row.endMinute,
                  room: row.spaceCode,
                  name: row.name,
                  setup: row.setupStyle,
                  covers: row.expectedCovers,
                  status: row.status,
                }),
              ),
              { format: context.format, empty: 'nothing is in the diary that day' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  diary
    .command('check')
    .description('what a proposed function would collide with')
    .requiredOption('--room <code>', 'the room')
    .requiredOption('--date <date>', 'the service date')
    .requiredOption('--start <time>', 'when it would start')
    .requiredOption('--end <time>', 'when it would end')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const clashes = findClashes(db, {
            propertyCode: context.requireProperty(),
            spaceCode: catalogCode(options.room ?? ''),
            serviceDate: calendarDate(options.date ?? ''),
            startMinute: blockMinute('start', options.start ?? ''),
            endMinute: blockMinute('end', options.end ?? ''),
          });
          context.write(
            render(
              clashes.map((row) => ({
                id: row.slotId,
                booking: row.bookingId,
                room: row.spaceCode,
                shares: row.sharedSpaces.join(', '),
                name: row.name,
              })),
              { format: context.format, empty: 'that room is free' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}
