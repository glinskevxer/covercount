/**
 * Commands for the banquet event order itself: drawing it, sending it out,
 * getting it signed, and raising a change order when it drifts.
 */

import type { Command } from 'commander';
import {
  acknowledge,
  addRecipient,
  deliveryStanding,
  listRecipients,
  retireRecipient,
  sendRevision,
} from '../../orders/delivery.js';
import { parseEntityId } from '../../core/ids.js';
import { formatMoney, parseMoney } from '../../core/money.js';
import { assembleOrder, renderOrder } from '../../orders/document.js';
import {
  distributeRevision,
  drawRevision,
  listRevisions,
  liveRevision,
  renderRevision,
  revisionDrift,
  revisionIsStale,
  signRevision,
} from '../../orders/revisions.js';
import {
  applyChangeOrder,
  changeOrderLines,
  declineChangeOrder,
  listChangeOrders,
  raiseChangeOrder,
} from '../../orders/changes.js';
import { requireProperty } from '../../property/store.js';
import { columns, render, renderJson, renderRecord } from '../output.js';
import { entityArg, wholeNumber } from '../args.js';
import { onReadStore, onStore, type CliContext } from '../context.js';

export function registerOrderCommands(program: Command, makeContext: () => CliContext): void {
  const order = program.command('order').description('the banquet event order');

  order
    .command('preview')
    .description('what the sheet would say if it were drawn now')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const assembled = assembleOrder(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(assembled, null, 2) : renderOrder(assembled),
        );
      }),
    );

  order
    .command('draw')
    .description('freeze a new revision')
    .requiredOption('--function <id>', 'the function')
    .option('--note <note>', 'why this one was drawn', '')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const drawn = drawRevision(
          db,
          entityArg('functionSlot', options.function ?? ''),
          context.now(),
          context.actor,
          options.note ?? '',
        );
        context.write(
          renderRecord(
            {
              id: drawn.id,
              revision: drawn.revision,
              status: drawn.status,
              drawnBy: drawn.drawnBy,
              note: drawn.note,
            },
            { format: context.format },
          ),
        );
      }),
    );

  order
    .command('show')
    .description('print a revision as it was frozen')
    .requiredOption('--id <id>', 'the revision')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(renderRevision(db, parseEntityId('beo', options.id ?? '')));
      }),
    );

  order
    .command('list')
    .description('every revision on a function')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listRevisions(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
              id: row.id,
              revision: row.revision,
              status: row.status,
              drawnAt: row.drawnAt,
              drawnBy: row.drawnBy,
              signedBy: row.signedBy ?? '',
            })),
            { format: context.format, empty: 'no sheet has been drawn yet' },
          ),
        );
      }),
    );

  order
    .command('distribute')
    .description('send the live revision out')
    .requiredOption('--id <id>', 'the revision')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const moved = distributeRevision(db, parseEntityId('beo', options.id ?? ''));
        context.write(
          renderRecord({ id: moved.id, status: moved.status }, { format: context.format }),
        );
      }),
    );

  order
    .command('sign')
    .description('record the client signature')
    .requiredOption('--id <id>', 'the revision')
    .requiredOption('--by <name>', 'who signed it')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const signed = signRevision(
          db,
          parseEntityId('beo', options.id ?? ''),
          options.by ?? '',
          context.now(),
        );
        context.write(
          renderRecord(
            { id: signed.id, status: signed.status, signedBy: signed.signedBy ?? '' },
            { format: context.format },
          ),
        );
      }),
    );

  order
    .command('drift')
    .description('what has moved since the live sheet was drawn')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const functionId = entityArg('functionSlot', options.function ?? '');
        const live = liveRevision(db, functionId);
        if (live === undefined) {
          context.write('no sheet has been drawn yet');
          return;
        }
        if (!revisionIsStale(db, functionId)) {
          context.write(`${live.id} is still current`);
          return;
        }
        context.write(
          render(
            revisionDrift(db, functionId).map((row) => ({
              field: row.field,
              was: row.was,
              becomes: row.becomes,
            })),
            { format: context.format, empty: `${live.id} is still current` },
          ),
        );
      }),
    );
}

export function registerChangeCommands(program: Command, makeContext: () => CliContext): void {
  const change = program.command('change').description('change orders against a signed sheet');

  change
    .command('raise')
    .description('raise a change order off whatever has drifted')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--reason <reason>', 'why the change was asked for')
    .option('--fee <amount>', 'a late fee, only allowed after the guarantee closed')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const raised = raiseChangeOrder(
          db,
          entityArg('functionSlot', options.function ?? ''),
          {
            reason: options.reason ?? '',
            raisedBy: context.actor,
            ...(options.fee === undefined
              ? {}
              : { feeMinor: parseMoney(options.fee, 'USD').amount }),
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: raised.id,
              status: raised.status,
              afterCutoff: raised.afterCutoff,
              fee: formatMoney(raised.fee),
              reason: raised.reason,
            },
            { format: context.format },
          ),
        );
      }),
    );

  change
    .command('show')
    .description('what one change order carries')
    .requiredOption('--id <id>', 'the change order')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            changeOrderLines(db, parseEntityId('changeOrder', options.id ?? '')).map((row) => ({
              field: row.field,
              was: row.was,
              becomes: row.becomes,
            })),
            { format: context.format, empty: 'that change order carries no lines' },
          ),
        );
      }),
    );

  change
    .command('list')
    .description('every change order on a function')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listChangeOrders(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
              id: row.id,
              status: row.status,
              afterCutoff: row.afterCutoff,
              fee: formatMoney(row.fee),
              raisedBy: row.raisedBy,
              reason: row.reason,
            })),
            { format: context.format, empty: 'nothing has been changed on that function' },
          ),
        );
      }),
    );

  change
    .command('apply')
    .description('apply a change order and draw a fresh revision')
    .requiredOption('--id <id>', 'the change order')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const applied = applyChangeOrder(
          db,
          parseEntityId('changeOrder', options.id ?? ''),
          context.now(),
          context.actor,
        );
        context.write(
          renderRecord(
            { id: applied.id, status: applied.status, fee: formatMoney(applied.fee) },
            { format: context.format },
          ),
        );
      }),
    );

  change
    .command('decline')
    .description('turn a change order down')
    .requiredOption('--id <id>', 'the change order')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const property = requireProperty(db, context.requireProperty());
        const declined = declineChangeOrder(
          db,
          parseEntityId('changeOrder', options.id ?? ''),
          property.currency,
        );
        context.write(
          renderRecord({ id: declined.id, status: declined.status }, { format: context.format }),
        );
      }),
    );
}

export function registerDeliveryCommands(program: Command, makeContext: () => CliContext): void {
  const send = program.command('send').description('who gets the order, and who has said so');

  send
    .command('add')
    .description('put somebody on the standing distribution list')
    .requiredOption('--to <name>', 'the recipient')
    .requiredOption('--role <role>', 'why they get it')
    .requiredOption('--channel <channel>', 'email, print, board or hand')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const person = addRecipient(db, context.requireProperty(), {
          recipient: options.to ?? '',
          role: options.role ?? '',
          channel: options.channel ?? '',
        });
        context.write(
          renderRecord(
            { recipient: person.recipient, role: person.role, channel: person.channel },
            { format: context.format },
          ),
        );
      }),
    );

  send
    .command('list')
    .description('the standing distribution list')
    .option('--all', 'include the ones who have been retired')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        context.write(
          render(
            listRecipients(db, context.requireProperty(), {
              activeOnly: options.all !== true,
            }).map((person) => ({
              recipient: person.recipient,
              role: person.role,
              channel: person.channel,
              active: person.active,
            })),
            {
              format: context.format,
              empty: 'nobody is on the list',
              columns: columns('recipient', 'role', 'channel', 'active'),
            },
          ),
        );
      }),
    );

  send
    .command('retire')
    .description('take somebody off the list without losing what they were sent')
    .requiredOption('--to <name>', 'the recipient')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const removed = retireRecipient(db, context.requireProperty(), options.to ?? '');
        context.write(renderRecord({ retired: removed }, { format: context.format }));
      }),
    );

  send
    .command('out')
    .description('send one revision to the whole list')
    .requiredOption('--revision <id>', 'the revision')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const sent = sendRevision(db, entityArg('beo', options.revision ?? ''), context.now());
        context.write(
          render(
            sent.map((row) => ({
              id: row.id,
              recipient: row.recipient,
              role: row.role,
              channel: row.channel,
            })),
            {
              format: context.format,
              empty: 'nothing was sent',
              columns: columns('id>', 'recipient', 'role', 'channel'),
            },
          ),
        );
      }),
    );

  send
    .command('ack')
    .description('record that somebody acknowledged a delivery')
    .requiredOption('--id <id>', 'the delivery')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const row = acknowledge(db, wholeNumber('delivery', options.id ?? ''), context.now());
        context.write(
          renderRecord(
            { id: row.id, recipient: row.recipient, at: row.acknowledgedAt ?? '' },
            { format: context.format },
          ),
        );
      }),
    );

  send
    .command('standing')
    .description('who has still not said they got it')
    .requiredOption('--revision <id>', 'the revision')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const standing = deliveryStanding(db, entityArg('beo', options.revision ?? ''));
        if (context.format === 'json') {
          context.write(renderJson(standing));
          return;
        }
        context.write(
          [
            `${standing.acknowledged} of ${standing.sent} acknowledged`,
            '',
            render(
              standing.waiting.map((row) => ({
                id: row.id,
                recipient: row.recipient,
                role: row.role,
                sent: row.sentAt,
              })),
              {
                format: context.format,
                empty: standing.sent === 0 ? 'nothing has been sent' : 'everybody has acknowledged',
                columns: columns('id>', 'recipient', 'role', 'sent'),
              },
            ),
          ].join('\n'),
        );
      }),
    );
}
