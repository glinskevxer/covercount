/**
 * What the read service answers.
 *
 * Every route hands back the same shape the command line does, because they
 * both read the same functions. Nothing here computes anything; if a screen
 * and a printed sheet ever disagree it is because one of them was fetched
 * earlier, not because two things worked the answer out twice.
 */

import { calendarDate } from '../core/calendar.js';
import { catalogCode, parseEntityId } from '../core/ids.js';
import { formatMoney } from '../core/money.js';
import { functionsOnDate } from '../booking/diary.js';
import { listFunctions, requireFunction } from '../booking/functions.js';
import { listBookings, requireBooking } from '../booking/store.js';
import { requireCovers } from '../covers/guarantee.js';
import { coverBreakdown, listSpecialMeals } from '../covers/special.js';
import { listSelections, splitProblems } from '../covers/selections.js';
import { assembleOrder } from '../orders/document.js';
import { listRevisions, liveRevision, revisionBody } from '../orders/revisions.js';
import { listRunOfShow } from '../timeline/runofshow.js';
import { functionBoard, readerBoard, staffingSheet } from '../reports/house.js';
import { pickList, productionSheet } from '../reports/kitchen.js';
import { listProperties, requireProperty } from '../property/store.js';
import { invoiceTotals, listInvoices } from '../billing/invoice.js';
import type { Database } from '../store/database.js';
import { Router, requireParam, requireQuery, type RouteMatch } from './router.js';

export interface ServiceContext {
  readonly db: Database;
  readonly version: string;
}

function propertyOf(match: RouteMatch) {
  return catalogCode(requireParam(match, 'property'));
}

export function buildRouter(): Router<ServiceContext> {
  const router = new Router<ServiceContext>();

  router.get('/', 'this index', (_match, context) => ({
    service: 'covercount',
    version: context.version,
    routes: router.list(),
  }));

  router.get('/health', 'whether the store is readable', (_match, context) => ({
    ok: true,
    properties: listProperties(context.db).length,
  }));

  router.get('/properties', 'every property in the store', (_match, context) =>
    listProperties(context.db).map((row) => ({
      code: row.code,
      name: row.name,
      zone: row.timeZone,
      currency: row.currency,
    })),
  );

  router.get('/properties/:property', 'one property', (match, context) => {
    const property = requireProperty(context.db, propertyOf(match));
    return {
      code: property.code,
      name: property.name,
      zone: property.timeZone,
      currency: property.currency,
      guaranteeLeadDays: property.guaranteeLeadDays,
      oversetCap: property.oversetCap,
    };
  });

  router.get('/properties/:property/board', 'the function board for a date', (match, context) =>
    functionBoard(context.db, propertyOf(match), calendarDate(requireQuery(match, 'date'))),
  );

  router.get('/properties/:property/reader', 'the lobby screen for a date', (match, context) =>
    readerBoard(context.db, propertyOf(match), calendarDate(requireQuery(match, 'date'))),
  );

  router.get('/properties/:property/staffing', 'who is called in on a date', (match, context) =>
    staffingSheet(context.db, propertyOf(match), calendarDate(requireQuery(match, 'date'))),
  );

  router.get('/properties/:property/pick', 'the pick list for a date', (match, context) =>
    pickList(context.db, propertyOf(match), calendarDate(requireQuery(match, 'date'))),
  );

  router.get('/properties/:property/bookings', 'bookings, filtered', (match, context) => {
    const status = match.query.get('status');
    const from = match.query.get('from');
    const to = match.query.get('to');
    return listBookings(context.db, propertyOf(match), {
      ...(status === null ? {} : { status }),
      ...(from === null ? {} : { from }),
      ...(to === null ? {} : { to }),
    }).map((row) => ({
      id: row.id,
      postAs: row.postAs,
      status: row.status,
      arrival: row.arrivalDate,
      departure: row.departureDate,
    }));
  });

  router.get('/bookings/:booking', 'one booking with its functions', (match, context) => {
    const id = parseEntityId('booking', requireParam(match, 'booking'));
    const booking = requireBooking(context.db, id);
    return {
      id: booking.id,
      postAs: booking.postAs,
      status: booking.status,
      account: booking.accountCode ?? null,
      arrival: booking.arrivalDate,
      departure: booking.departureDate,
      functions: listFunctions(context.db, id).map((slot) => ({
        id: slot.id,
        name: slot.name,
        room: slot.spaceCode,
        date: slot.serviceDate,
        status: slot.status,
      })),
    };
  });

  router.get('/bookings/:booking/invoices', 'invoices on a booking', (match, context) => {
    const id = parseEntityId('booking', requireParam(match, 'booking'));
    const booking = requireBooking(context.db, id);
    return listInvoices(context.db, booking.propertyCode, { bookingId: id }).map((invoice) => {
      const totals = invoiceTotals(context.db, invoice.id);
      return {
        id: invoice.id,
        status: invoice.status,
        gross: formatMoney(totals.gross),
        paid: formatMoney(totals.paid),
        balance: formatMoney(totals.balance),
      };
    });
  });

  return withFunctionRoutes(router);
}

function withFunctionRoutes(router: Router<ServiceContext>): Router<ServiceContext> {
  const slotOf = (match: RouteMatch) =>
    parseEntityId('functionSlot', requireParam(match, 'function'));

  router.get('/functions/:function', 'one function', (match, context) => {
    const slot = requireFunction(context.db, slotOf(match));
    return {
      id: slot.id,
      booking: slot.bookingId,
      name: slot.name,
      room: slot.spaceCode,
      date: slot.serviceDate,
      start: slot.startMinute,
      end: slot.endMinute,
      setupStyle: slot.setupStyle,
      serviceStyle: slot.serviceStyle,
      status: slot.status,
      expectedCovers: slot.expectedCovers,
    };
  });

  router.get('/functions/:function/covers', 'the cover count on a function', (match, context) => {
    const id = slotOf(match);
    const covers = requireCovers(context.db, id);
    return {
      guaranteeDue: covers.guaranteeDue,
      contractDate: covers.contractDate,
      package: covers.packageCode ?? null,
      served: covers.servedCovers ?? null,
      ...coverBreakdown(context.db, id),
    };
  });

  router.get('/functions/:function/menu', 'the split and the special meals', (match, context) => {
    const id = slotOf(match);
    return {
      selections: listSelections(context.db, id),
      specials: listSpecialMeals(context.db, id),
      problems: splitProblems(context.db, id),
    };
  });

  router.get('/functions/:function/order', 'the sheet as it would be drawn now', (match, context) =>
    assembleOrder(context.db, slotOf(match)),
  );

  router.get('/functions/:function/revisions', 'every revision drawn', (match, context) => {
    const id = slotOf(match);
    const live = liveRevision(context.db, id);
    return {
      live: live?.id ?? null,
      revisions: listRevisions(context.db, id).map((row) => ({
        id: row.id,
        revision: row.revision,
        status: row.status,
        drawnAt: row.drawnAt,
        drawnBy: row.drawnBy,
        signedBy: row.signedBy ?? null,
      })),
    };
  });

  router.get('/revisions/:revision', 'one frozen revision', (match, context) =>
    revisionBody(context.db, parseEntityId('beo', requireParam(match, 'revision'))),
  );

  router.get('/functions/:function/timeline', 'the saved run of show', (match, context) =>
    listRunOfShow(context.db, slotOf(match)),
  );

  router.get('/functions/:function/production', 'the production sheet', (match, context) =>
    productionSheet(context.db, slotOf(match)),
  );

  router.get(
    '/functions/:function/diary',
    'what else is in the room that day',
    (match, context) => {
      const slot = requireFunction(context.db, slotOf(match));
      return functionsOnDate(context.db, slot.propertyCode, slot.serviceDate)
        .filter((each) => each.id !== slot.id)
        .map((each) => ({
          id: each.id,
          room: each.spaceCode,
          name: each.name,
          start: each.startMinute,
          end: each.endMinute,
          status: each.status,
        }));
    },
  );

  return router;
}
