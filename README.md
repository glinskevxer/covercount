# covercount

Banquet event order and catering production control for a hotel food and
beverage department.

A function is sold as a menu at a price per person, but almost nothing that
follows is driven by that price. The kitchen cooks to a guaranteed cover count
that the client sets before a deadline and can raise afterwards but not lower.
The dining room is set above the guarantee by a house overset. Special meals
come out of the guarantee rather than sitting on top of it. The invoice bills
the greater of the guarantee and the covers actually served. `covercount`
holds those rules in one place so the banquet event order, the kitchen
production sheet, the staffing sheet and the invoice all agree.

## Running it

    npm install
    npm run build
    node dist/src/cli/main.js --help

## Layout

    src/core        units, money and the venue clock
    tests           every test, mirroring src

## Development

    npm run typecheck
    npm run lint
    npm test
