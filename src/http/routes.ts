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
import { findRevenueMinimum, minimumStanding } from '../billing/minimum.js';
import { findDistribution } from '../labour/distribution.js';
import { belowPar, listStockLevels } from '../production/stock.js';
import { draftPurchaseOrder } from '../production/purchasing.js';
import { listProductionFactors } from '../production/factors.js';
import { cancellationBands } from '../booking/damages.js';
import { formatQuantity } from '../core/quantity.js';
import { formatRate } from '../core/rate.js';
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

  router.get(
    '/properties/:property/stock',
    'the shelf, and what sits under its par',
    (match, context) => {
      const property = propertyOf(match);
      const short = new Set(belowPar(context.db, property).map((level) => level.ingredientCode));
      return listStockLevels(context.db, property).map((level) => ({
        item: level.ingredientCode,
        onHand: formatQuantity(level.onHand),
        par: formatQuantity(level.par),
        under: short.has(level.ingredientCode),
        countedAt: level.countedAt,
      }));
    },
  );

  router.get(
    '/properties/:property/factors',
    'how much more than the plate count each style makes',
    (match, context) =>
      listProductionFactors(context.db, propertyOf(match)).map((row) => ({
        style: row.serviceStyle,
        factor: formatRate(row.factor),
        note: row.note,
      })),
  );

  router.get(
    '/properties/:property/cancellation',
    'the published cancellation scale',
    (match, context) =>
      cancellationBands(context.db, propertyOf(match)).map((band) => ({
        days: band.daysBefore,
        charge: formatRate(band.charge),
        note: band.note,
      })),
  );

  router.get(
    '/functions/:function/minimum',
    'where the function stands against its minimum',
    (match, context) => {
      const id = slotOf(match);
      if (findRevenueMinimum(context.db, id) === undefined) {
        return { sold: false };
      }
      const standing = minimumStanding(context.db, id);
      return {
        sold: true,
        minimum: formatMoney(standing.minimum),
        achieved: formatMoney(standing.achieved),
        shortfall: formatMoney(standing.shortfall),
        counts: standing.categories,
        met: standing.met,
      };
    },
  );

  router.get(
    '/functions/:function/purchase',
    'what this function needs bought in',
    (match, context) => {
      const order = draftPurchaseOrder(context.db, [slotOf(match)]);
      return {
        packs: order.packs,
        covered: order.linesDropped,
        sections: order.sections.map((section) => ({
          store: section.store,
          packs: section.packs,
          lines: section.lines.map((line) => ({
            item: line.ingredientCode,
            need: formatQuantity(line.needed),
            have: formatQuantity(line.onHand),
            packs: line.packs,
          })),
        })),
      };
    },
  );

  router.get(
    '/invoices/:invoice/pool',
    'how the service charge was handed out',
    (match, context) => {
      const id = parseEntityId('invoice', requireParam(match, 'invoice'));
      const split = findDistribution(context.db, id);
      if (split === undefined) {
        return { split: false };
      }
      return {
        split: true,
        pool: formatMoney(split.pool),
        runAt: split.runAt,
        lines: split.lines.map((line) => ({
          role: line.role,
          hours: line.headHoursThousandths / 1000,
          points: line.points,
          share: formatMoney(line.share),
        })),
      };
    },
  );

  return router;
}
