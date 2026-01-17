/**
 * Commands for setting a property up: the property itself, its rooms, the
 * capacities each room publishes, the combinations, and the two calendars.
 * This is the whole of what a new site has to be told before a booking can be
 * taken, and it is deliberately all here rather than spread across files.
 */

import type { Command } from 'commander';
import {
  challengeHold,
  holdsOn,
  lapsedHolds,
  placeHold,
  releaseHold,
} from '../../property/holds.js';
import { catalogCode } from '../../core/ids.js';
import { formatRate, ratePercent } from '../../core/rate.js';
import { formatTimeOfDay, parseTimeOfDay } from '../../core/clock.js';
import { invalidInput } from '../../core/errors.js';
import {
  addCalendarEntry,
  addSpace,
  createProperty,
  listCalendarEntries,
  listProperties,
  listSpaces,
  requireProperty,
  setSpaceActive,
  setSpaceCapacity,
  spaceCapacities,
} from '../../property/store.js';
import {
  clashingSpaces,
  combinationsContaining,
  defineCombination,
  physicalFootprint,
} from '../../property/combinations.js';
import { columns, render, renderRecord } from '../output.js';
import { blockMinute, codeArg, dateArg, entityArg, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

export function registerPropertyCommands(program: Command, makeContext: () => CliContext): void {
  const property = program.command('property').description('the property and its rooms');

  property
    .command('create')
    .description('put a property on file')
    .requiredOption('--code <code>', 'short code for the property')
    .requiredOption('--name <name>', 'the name it trades under')
    .requiredOption('--zone <zone>', 'IANA time zone the ballroom clock runs on')
    .option('--currency <code>', 'currency the property invoices in', 'USD')
    .option('--guarantee-lead <days>', 'business days before a function the count closes', '3')
    .option('--guarantee-due <time>', 'time of day the count closes, HH:MM', '12:00')
    .option('--overset <percent>', 'how far above the guarantee the room is set', '5')
    .option('--overset-cap <covers>', 'most covers the overset will ever add', '25')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const created = createProperty(
          db,
          {
            code: options.code ?? '',
            name: options.name ?? '',
            timeZone: options.zone ?? '',
            currency: options.currency ?? 'USD',
            guaranteeLeadDays: wholeNumber('guarantee lead', options.guaranteeLead ?? '3'),
            guaranteeDueMinute: parseTimeOfDay(options.guaranteeDue ?? '12:00'),
            oversetPpm: Math.round(Number(options.overset ?? '5') * 10_000),
            oversetCap: wholeNumber('overset cap', options.oversetCap ?? '25'),
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: created.code,
              name: created.name,
              zone: created.timeZone,
              currency: created.currency,
              guaranteeLead: created.guaranteeLeadDays,
              guaranteeDue: formatTimeOfDay(created.guaranteeDueTime),
              overset: formatRate(created.oversetRate),
              oversetCap: created.oversetCap,
            },
            { format: context.format },
          ),
        );
      });
    });

  property
    .command('list')
    .description('every property in this store')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listProperties(db).map((row) => ({
                code: row.code,
                name: row.name,
                zone: row.timeZone,
                currency: row.currency,
                lead: row.guaranteeLeadDays,
                overset: ratePercent(row.oversetRate),
              })),
              { format: context.format, empty: 'no properties are on file' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  property
    .command('show')
    .description('the settings a property books under')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const found = requireProperty(db, context.requireProperty());
          context.write(
            renderRecord(
              {
                code: found.code,
                name: found.name,
                zone: found.timeZone,
                currency: found.currency,
                guaranteeLead: found.guaranteeLeadDays,
                guaranteeDue: formatTimeOfDay(found.guaranteeDueTime),
                overset: formatRate(found.oversetRate),
                oversetCap: found.oversetCap,
                rooms: listSpaces(db, found.code).length,
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerSpaceCommands(program: Command, makeContext: () => CliContext): void {
  const space = program.command('space').description('the rooms in the property');

  space
    .command('add')
    .description('put a room on file')
    .requiredOption('--code <code>', 'short code for the room')
    .requiredOption('--name <name>', 'the name on the door')
    .requiredOption('--fire <covers>', 'the number on the fire certificate')
    .option('--floor <floor>', 'which floor it is on', '')
    .option('--area <sqft>', 'floor area in square feet', '0')
    .option('--setup <minutes>', 'minutes the crew needs in front of a function', '60')
    .option('--teardown <minutes>', 'minutes the crew needs behind it', '30')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const created = addSpace(db, context.requireProperty(), {
          code: options.code ?? '',
          name: options.name ?? '',
          floor: options.floor ?? '',
          areaSqFt: wholeNumber('area', options.area ?? '0'),
          fireCapacity: wholeNumber('fire capacity', options.fire ?? '0'),
          setupMinutes: wholeNumber('setup minutes', options.setup ?? '60'),
          teardownMinutes: wholeNumber('teardown minutes', options.teardown ?? '30'),
        });
        context.write(
          renderRecord(
            {
              code: created.code,
              name: created.name,
              floor: created.floor,
              area: created.areaSqFt,
              fire: created.fireCapacity,
              setup: created.setupMinutes,
              teardown: created.teardownMinutes,
            },
            { format: context.format },
          ),
        );
      });
    });

  space
    .command('list')
    .description('every room, with what it seats')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const propertyCode = context.requireProperty();
          context.write(
            render(
              listSpaces(db, propertyCode).map((row) => ({
                code: row.code,
                name: row.name,
                floor: row.floor,
                fire: row.fireCapacity,
                combination: row.isCombination,
                active: row.active,
                styles: spaceCapacities(db, propertyCode, row.code).length,
              })),
              {
                format: context.format,
                empty: 'no rooms are on file',
                columns: columns(
                  'code',
                  'name',
                  'floor',
                  'fire>',
                  'combination',
                  'active',
                  'styles>',
                ),
              },
            ),
          );
        },
        { readOnly: true },
      );
    });

  space
    .command('capacity')
    .description('publish what a room seats in one setup style')
    .requiredOption('--code <code>', 'the room')
    .requiredOption('--style <style>', 'the setup style')
    .requiredOption('--covers <covers>', 'how many it seats that way')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const propertyCode = context.requireProperty();
        const code = catalogCode(options.code ?? '');
        setSpaceCapacity(
          db,
          propertyCode,
          code,
          options.style ?? '',
          wholeNumber('covers', options.covers ?? '0'),
        );
        context.write(
          render(
            spaceCapacities(db, propertyCode, code).map((row) => ({
              style: row.setupStyle,
              covers: row.capacity,
            })),
            {
              format: context.format,
              columns: columns('style', 'covers>'),
            },
          ),
        );
      });
    });
}

export function registerCombinationCommands(program: Command, makeContext: () => CliContext): void {
  const room = program.command('room').description('combined rooms and what they block');

  room
    .command('combine')
    .description('define a room made of other rooms')
    .requiredOption('--code <code>', 'code for the combined room')
    .requiredOption('--name <name>', 'the name it is sold under')
    .requiredOption('--parts <codes>', 'comma separated room codes')
    .option('--fire <covers>', 'fire capacity, if it is not the sum of the parts')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const parts = (options.parts ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        const created = defineCombination(db, context.requireProperty(), {
          code: options.code ?? '',
          name: options.name ?? '',
          components: parts,
          ...(options.fire === undefined
            ? {}
            : { fireCapacity: wholeNumber('fire capacity', options.fire) }),
        });
        context.write(
          renderRecord(
            {
              code: created.code,
              name: created.name,
              area: created.areaSqFt,
              fire: created.fireCapacity,
              setup: created.setupMinutes,
              teardown: created.teardownMinutes,
            },
            { format: context.format },
          ),
        );
      });
    });

  room
    .command('footprint')
    .description('what a room takes out of the diary, and what it clashes with')
    .requiredOption('--code <code>', 'the room')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const propertyCode = context.requireProperty();
          const code = catalogCode(options.code ?? '');
          context.write(
            renderRecord(
              {
                code,
                occupies: physicalFootprint(db, propertyCode, code).join(', '),
                clashesWith: clashingSpaces(db, propertyCode, code).join(', '),
                partOf: combinationsContaining(db, propertyCode, code).join(', '),
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });

  room
    .command('service')
    .description('take a room out of service or put it back')
    .requiredOption('--code <code>', 'the room')
    .requiredOption('--state <state>', 'in or out')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const state = (options.state ?? '').trim().toLowerCase();
        if (state !== 'in' && state !== 'out') {
          throw invalidInput(
            'cli.service',
            `a room goes in or out of service, got ${options.state ?? ''}`,
          );
        }
        const updated = setSpaceActive(
          db,
          context.requireProperty(),
          catalogCode(options.code ?? ''),
          state === 'in',
        );
        context.write(
          renderRecord({ code: updated.code, active: updated.active }, { format: context.format }),
        );
      });
    });
}

export function registerCalendarCommands(program: Command, makeContext: () => CliContext): void {
  const calendar = program.command('calendar').description('the office and kitchen calendars');

  calendar
    .command('close')
    .description('mark a date closed or open on one of the calendars')
    .requiredOption('--calendar <which>', 'office or kitchen')
    .requiredOption('--date <date>', 'the date, YYYY-MM-DD')
    .option('--state <state>', 'closed or open', 'closed')
    .option('--note <note>', 'why', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const entry = addCalendarEntry(db, context.requireProperty(), {
          calendar: options.calendar ?? '',
          date: options.date ?? '',
          kind: options.state ?? 'closed',
          note: options.note ?? '',
        });
        context.write(
          renderRecord(
            { calendar: entry.calendar, date: entry.date, state: entry.kind, note: entry.note },
            { format: context.format },
          ),
        );
      });
    });

  calendar
    .command('list')
    .description('the dates one calendar carries')
    .requiredOption('--calendar <which>', 'office or kitchen')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listCalendarEntries(db, context.requireProperty(), options.calendar ?? '').map(
                (row) => ({ date: row.date, state: row.kind, note: row.note }),
              ),
              { format: context.format, empty: 'that calendar carries no dates' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerHoldCommands(program: Command, makeContext: () => CliContext): void {
  const hold = program.command('hold').description('tentative space, ranked first and second');

  hold
    .command('take')
    .description('put a hold on a room for a booking')
    .requiredOption('--booking <id>', 'the booking')
    .requiredOption('--room <code>', 'the room')
    .requiredOption('--date <date>', 'the date held')
    .requiredOption('--start <time>', 'start time as HH:MM')
    .requiredOption('--end <time>', 'end time as HH:MM')
    .requiredOption('--until <date>', 'the date the hold runs out')
    .option('--note <text>', 'anything the sales office wants remembered')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const taken = placeHold(
          db,
          context.requireProperty(),
          {
            spaceCode: codeArg(options.room ?? ''),
            bookingId: entityArg('booking', options.booking ?? ''),
            serviceDate: dateArg(options.date ?? ''),
            startMinute: blockMinute('start', options.start ?? ''),
            endMinute: blockMinute('end', options.end ?? ''),
            holdsUntil: dateArg(options.until ?? ''),
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: taken.id,
              room: taken.spaceCode,
              date: taken.serviceDate,
              rank: taken.rank,
              until: taken.holdsUntil,
            },
            { format: context.format },
          ),
        );
      });
    });

  hold
    .command('list')
    .description('every live hold on a date')
    .requiredOption('--date <date>', 'the date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            holdsOn(db, context.requireProperty(), dateArg(options.date ?? '')).map((each) => ({
              id: each.id,
              room: each.spaceCode,
              booking: each.bookingId,
              rank: each.rank,
              until: each.holdsUntil,
            })),
            {
              format: context.format,
              empty: 'nothing is held that day',
              columns: columns('id>', 'room', 'booking', 'rank>', 'until'),
            },
          ),
        );
      });
    });

  hold
    .command('release')
    .description('let a hold go and move everybody behind it up')
    .requiredOption('--id <id>', 'the hold')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const result = releaseHold(db, wholeNumber('hold', options.id ?? ''), context.now());
        context.write(
          renderRecord(
            { released: result.released.id, promoted: result.promoted.length },
            { format: context.format },
          ),
        );
      });
    });

  hold
    .command('challenge')
    .description('tell the hold in front that somebody else wants the room')
    .requiredOption('--id <id>', 'the challenging hold')
    .requiredOption('--by <date>', 'the date the incumbent has to decide by')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const challenge = challengeHold(
          db,
          wholeNumber('hold', options.id ?? ''),
          dateArg(options.by ?? ''),
        );
        context.write(
          renderRecord(
            {
              challenger: challenge.challenger.id,
              incumbent: challenge.incumbent?.id ?? 'none',
              booking: challenge.incumbent?.bookingId ?? '',
              decideBy: challenge.decideBy,
            },
            { format: context.format },
          ),
        );
      });
    });

  hold
    .command('lapsed')
    .description('holds whose own date has run out')
    .requiredOption('--on <date>', 'the date to sweep at')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            lapsedHolds(db, context.requireProperty(), dateArg(options.on ?? '')).map((each) => ({
              id: each.id,
              room: each.spaceCode,
              booking: each.bookingId,
              date: each.serviceDate,
              until: each.holdsUntil,
            })),
            {
              format: context.format,
              empty: 'nothing has lapsed',
              columns: columns('id>', 'room', 'booking', 'date', 'until'),
            },
          ),
        );
      });
    });
}
