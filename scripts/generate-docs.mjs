/**
 * Write the command reference out of the program itself.
 *
 * A reference typed by hand goes stale the first time somebody adds an option
 * and does not think of it. This walks the real commander tree, so the only
 * way for the reference to be wrong is for the program to be wrong.
 *
 * Run with --check in CI to fail when the committed file is behind.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { buildProgram, VERSION } from '../dist/src/cli/program.js';

const GENERATED = 'docs/commands.md';

function optionLine(option) {
  const flags = option.flags;
  // commander sets 'required' when the flag takes a value and 'mandatory'
  // when the flag itself has to be given. It is the second one people mean.
  const required = option.mandatory ? ' (required)' : '';
  const fallback =
    option.defaultValue === undefined ? '' : ` [default: ${String(option.defaultValue)}]`;
  return `| \`${flags}\` | ${option.description}${required}${fallback} |`;
}

function walk(command, path, lines) {
  const name = [...path, command.name()].filter((part) => part.length > 0).join(' ');
  const children = command.commands ?? [];

  if (path.length > 0 || children.length === 0) {
    lines.push(`### \`${name}\``);
    lines.push('');
    if (command.description().length > 0) {
      lines.push(command.description());
      lines.push('');
    }
    const options = (command.options ?? []).filter((option) => !option.hidden);
    if (options.length > 0) {
      lines.push('| option | what it is |');
      lines.push('| --- | --- |');
      for (const option of options) {
        lines.push(optionLine(option));
      }
      lines.push('');
    }
  }

  for (const child of children) {
    walk(child, [...path, command.name()], lines);
  }
}

const program = buildProgram(() => {
  throw new Error('the reference never runs a command');
});

const lines = [];
lines.push('# covercount command reference');
lines.push('');
lines.push(`Generated from the program itself at version ${VERSION}. Do not edit by hand.`);
lines.push('');
lines.push('Run `npm run docs` after changing a command.');
lines.push('');
lines.push('## Global options');
lines.push('');
lines.push('| option | what it is |');
lines.push('| --- | --- |');
for (const option of program.options) {
  lines.push(optionLine(option));
}
lines.push('');

for (const group of program.commands) {
  lines.push(`## \`${group.name()}\``);
  lines.push('');
  if (group.description().length > 0) {
    lines.push(group.description());
    lines.push('');
  }
  walk(group, [], lines);
}

const body = `${lines
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trimEnd()}\n`;

if (process.argv.includes('--check')) {
  const existing = readFileSync(GENERATED, 'utf8');
  if (existing !== body) {
    console.error(`${GENERATED} is behind the program, run npm run docs`);
    process.exit(1);
  }
  console.log(`${GENERATED} is current`);
} else {
  writeFileSync(GENERATED, body, 'utf8');
  console.log(`${GENERATED} written, ${body.split('\n').length} lines`);
}
