import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FENWICK, FIXED_NOW, seedAccount, seedProperty } from '../../support/fixtures.js';
import {
  canCommitBusiness,
  createAccount,
  findAccount,
  isTaxExempt,
  listAccounts,
  requireAccount,
  setBillingEmail,
  setCreditStatus,
} from '../../../src/booking/accounts.js';
import { catalogCode } from '../../../src/core/ids.js';

describe('creating an account', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      const account = seedAccount(db);
      expect(account.code).toBe('FENWICK');
      expect(account.name).toBe('Fenwick Geological Society');
      expect(account.kind).toBe('ASSOCIATION');
      expect(account.billingEmail).toBe('ap@fenwick.example');
      expect(account.creditStatus).toBe('APPROVED');
      expect(account.taxExemptId).toBe('');
      expect(account.createdAt).toBe(FIXED_NOW);
    });
  });

  it('normalises the code and the kind', () => {
    withStore((db) => {
      seedProperty(db);
      const account = seedAccount(db, { code: ' fenwick ', kind: 'association' });
      expect(account.code).toBe('FENWICK');
      expect(account.kind).toBe('ASSOCIATION');
    });
  });

  it('defaults credit to approved and takes a given status', () => {
    withStore((db) => {
      seedProperty(db);
      expect(seedAccount(db, { creditStatus: 'PREPAY' }).creditStatus).toBe('PREPAY');
    });
  });

  it('refuses a blank name, an unknown kind and an unknown credit status', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedAccount(db, { name: '  ' })).toThrow(/needs a name/);
      expect(() => seedAccount(db, { kind: 'WEDDING' })).toThrow(/not an account kind/);
      expect(() => seedAccount(db, { creditStatus: 'BLOCKED' })).toThrow(/not a credit status/);
    });
  });

  it('refuses an address that is not one', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedAccount(db, { billingEmail: 'ap at fenwick' })).toThrow(
        /does not look like a billing address/,
      );
    });
  });

  it('allows a blank billing address', () => {
    withStore((db) => {
      seedProperty(db);
      expect(seedAccount(db, { billingEmail: '' }).billingEmail).toBe('');
    });
  });

  it('refuses a tax exemption on a social account', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedAccount(db, { kind: 'SOCIAL', taxExemptId: 'EX-99' })).toThrow(
        /cannot carry a tax exemption/,
      );
      expect(seedAccount(db, { kind: 'GOVERNMENT', taxExemptId: 'EX-99' }).taxExemptId).toBe(
        'EX-99',
      );
    });
  });

  it('refuses a duplicate code and an account on a property that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db);
      expect(() => seedAccount(db)).toThrow(/already has an account FENWICK/);
      expect(() =>
        createAccount(
          db,
          catalogCode('NOWHERE'),
          { code: 'X', name: 'X', kind: 'CORPORATE' },
          FIXED_NOW,
        ),
      ).toThrow(/is not on file/);
    });
  });
});

describe('reading accounts', () => {
  it('lists in code order and answers for one that is missing', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db, { code: 'ZENITH', name: 'Zenith Mining', kind: 'CORPORATE' });
      seedAccount(db);
      expect(listAccounts(db, CANYON).map((row) => row.code)).toEqual(['FENWICK', 'ZENITH']);
      expect(findAccount(db, CANYON, catalogCode('NOBODY'))).toBeUndefined();
      expect(() => requireAccount(db, CANYON, catalogCode('NOBODY'))).toThrow(/has no account/);
    });
  });
});

describe('changing an account', () => {
  it('moves the credit status', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db);
      expect(setCreditStatus(db, CANYON, FENWICK, 'hold').creditStatus).toBe('HOLD');
      expect(canCommitBusiness(requireAccount(db, CANYON, FENWICK))).toBe(false);
      expect(setCreditStatus(db, CANYON, FENWICK, 'APPROVED').creditStatus).toBe('APPROVED');
      expect(canCommitBusiness(requireAccount(db, CANYON, FENWICK))).toBe(true);
    });
  });

  it('refuses a credit status it does not know', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db);
      expect(() => setCreditStatus(db, CANYON, FENWICK, 'FROZEN')).toThrow(/not a credit status/);
    });
  });

  it('changes the billing address and refuses a bad one', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db);
      expect(setBillingEmail(db, CANYON, FENWICK, 'billing@fenwick.example').billingEmail).toBe(
        'billing@fenwick.example',
      );
      expect(setBillingEmail(db, CANYON, FENWICK, '  ').billingEmail).toBe('');
      expect(() => setBillingEmail(db, CANYON, FENWICK, 'nope')).toThrow(/billing address/);
    });
  });

  it('reports a tax exemption only when one is on file', () => {
    withStore((db) => {
      seedProperty(db);
      expect(isTaxExempt(seedAccount(db))).toBe(false);
      expect(
        isTaxExempt(seedAccount(db, { code: 'STATE', kind: 'GOVERNMENT', taxExemptId: 'E1' })),
      ).toBe(true);
    });
  });
});
