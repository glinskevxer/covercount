/**
 * Commands for the run of show: the template a property works to, and the
 * timeline on one function.
 */

import type { Command } from 'commander';
import { parseEntityId } from '../../core/ids.js';
import { invalidInput } from '../../core/errors.js';
import { isServiceStyle } from '../../property/types.js';
import {
  anchorsFor,
  computeRunOfShow,
  listRunOfShow,
  listTemplate,
  pinStep,
  renderRunOfShow,
  saveRunOfShow,
  setTemplateStep,
  unpinStep,
} from '../../timeline/runofshow.js';
import { render, renderRecord } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

function slotId(value: string) {
  return parseEntityId('functionSlot', value);
}

function wholeNumber(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw invalidInput('cli.number', `${label} takes a whole number, got ${value}`);
  }
  return parsed;
}

function serviceStyle(value: string) {
  const style = value.trim().toUpperCase();
  if (!isServiceStyle(style)) {
    throw invalidInput('cli.style', `${value} is not a service style`);
  }
  return style;
}

export function registerTemplateCommands(program: Command, makeContext: () => CliContext): void {
  const template = program.command('runsheet').description('the run of show template');

  template
    .command('step')
    .description('put a step on the template for a service style')
    .requiredOption('--style <style>', 'the service style')
    .requiredOption('--sequence <n>', 'where it sits in the template')
    .requiredOption('--label <label>', 'what happens')
    .requiredOption('--anchor <anchor>', 'setup, doors, service, close or teardown')
    .option('--offset <minutes>', 'minutes from the anchor, negative for before', '0')
    .option('--per-cover <seconds>', 'seconds a cover adds, pulling the step earlier', '0')
    .option('--owner <role>', 'whose job it is', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const step = setTemplateStep(db, context.requireProperty(), {
          serviceStyle: options.style ?? '',
          sequence: wholeNumber('sequence', options.sequence ?? ''),
          label: options.label ?? '',
          anchor: options.anchor ?? '',
          offsetMinutes: wholeNumber('offset', options.offset ?? '0'),
          perCoverSeconds: wholeNumber('per cover', options.perCover ?? '0'),
          owner: options.owner ?? '',
        });
        context.write(
          renderRecord(
            {
              style: step.serviceStyle,
              sequence: step.sequence,
              label: step.label,
              anchor: step.anchor,
              offset: step.offsetMinutes,
              perCover: step.perCoverSeconds,
              owner: step.owner,
            },
            { format: context.format },
          ),
        );
      });
    });

  template
    .command('show')
    .description('the template for one service style')
    .requiredOption('--style <style>', 'the service style')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listTemplate(db, context.requireProperty(), serviceStyle(options.style ?? '')).map(
                (row) => ({
                  sequence: row.sequence,
                  label: row.label,
                  anchor: row.anchor,
                  offset: row.offsetMinutes,
                  perCover: row.perCoverSeconds,
                  owner: row.owner,
                }),
              ),
              { format: context.format, empty: 'that style carries no template' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerTimelineCommands(program: Command, makeContext: () => CliContext): void {
  const timeline = program.command('timeline').description('the run of show on a function');

  timeline
    .command('anchors')
    .description('the five fixed points on a function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            renderRecord(
              { ...anchorsFor(db, slotId(options.function ?? '')) },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });

  timeline
    .command('preview')
    .description('what the run of show would be without saving it')
    .requiredOption('--function <id>', 'the function')
    .option('--covers <count>', 'work it out against this count instead')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const steps = computeRunOfShow(db, slotId(options.function ?? ''), {
            ...(options.covers === undefined
              ? {}
              : { covers: wholeNumber('covers', options.covers) }),
          });
          context.write(
            context.format === 'json'
              ? JSON.stringify(steps, null, 2)
              : renderRunOfShow([...steps].sort((left, right) => left.minute - right.minute)),
          );
        },
        { readOnly: true },
      );
    });

  timeline
    .command('save')
    .description('freeze the run of show, keeping anything pinned')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const steps = saveRunOfShow(db, slotId(options.function ?? ''));
        context.write(
          context.format === 'json' ? JSON.stringify(steps, null, 2) : renderRunOfShow(steps),
        );
      });
    });

  timeline
    .command('show')
    .description('the saved run of show')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const steps = listRunOfShow(db, slotId(options.function ?? ''));
          context.write(
            context.format === 'json' ? JSON.stringify(steps, null, 2) : renderRunOfShow(steps),
          );
        },
        { readOnly: true },
      );
    });

  timeline
    .command('pin')
    .description('fix one step at a time somebody has decided on')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--sequence <n>', 'which step')
    .requiredOption('--minute <minute>', 'the minute of the day it lands on')
    .option('--note <note>', 'why', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const steps = pinStep(
          db,
          slotId(options.function ?? ''),
          wholeNumber('sequence', options.sequence ?? ''),
          wholeNumber('minute', options.minute ?? ''),
          options.note ?? '',
        );
        context.write(
          context.format === 'json' ? JSON.stringify(steps, null, 2) : renderRunOfShow(steps),
        );
      });
    });

  timeline
    .command('unpin')
    .description('let a step follow the count again')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--sequence <n>', 'which step')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const steps = unpinStep(
          db,
          slotId(options.function ?? ''),
          wholeNumber('sequence', options.sequence ?? ''),
        );
        context.write(
          context.format === 'json' ? JSON.stringify(steps, null, 2) : renderRunOfShow(steps),
        );
      });
    });
}
