/**
 * Commands for the run of show: the template a property works to, and the
 * timeline on one function.
 */

import type { Command } from 'commander';
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
import { entityArg, serviceStyleArg, wholeSigned } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

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
          sequence: wholeSigned('sequence', options.sequence ?? ''),
          label: options.label ?? '',
          anchor: options.anchor ?? '',
          offsetMinutes: wholeSigned('offset', options.offset ?? '0'),
          perCoverSeconds: wholeSigned('per cover', options.perCover ?? '0'),
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
              listTemplate(db, context.requireProperty(), serviceStyleArg(options.style ?? '')).map(
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
              { ...anchorsFor(db, entityArg('functionSlot', options.function ?? '')) },
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
          const steps = computeRunOfShow(db, entityArg('functionSlot', options.function ?? ''), {
            ...(options.covers === undefined
              ? {}
              : { covers: wholeSigned('covers', options.covers) }),
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
        const steps = saveRunOfShow(db, entityArg('functionSlot', options.function ?? ''));
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
          const steps = listRunOfShow(db, entityArg('functionSlot', options.function ?? ''));
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
          entityArg('functionSlot', options.function ?? ''),
          wholeSigned('sequence', options.sequence ?? ''),
          wholeSigned('minute', options.minute ?? ''),
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
          entityArg('functionSlot', options.function ?? ''),
          wholeSigned('sequence', options.sequence ?? ''),
        );
        context.write(
          context.format === 'json' ? JSON.stringify(steps, null, 2) : renderRunOfShow(steps),
        );
      });
    });
}
