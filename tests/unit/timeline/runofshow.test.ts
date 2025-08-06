import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedTimelineTemplate } from '../../support/labour.js';
import {
  ANCHORS,
  anchorsFor,
  computeRunOfShow,
  isAnchor,
  listRunOfShow,
  listTemplate,
  pinStep,
  renderRunOfShow,
  requireTemplateStep,
  saveRunOfShow,
  setTemplateStep,
  unpinStep,
} from '../../../src/timeline/runofshow.js';
import { setGuarantee } from '../../../src/covers/guarantee.js';
import type { Database } from '../../../src/store/database.js';

function timed(db: Database, guarantee = 180) {
  const slot = readyFunction(db, { guarantee, room: 'GRAND' });
  seedTimelineTemplate(db);
  return slot;
}

describe('the template', () => {
  it('recognises its anchors', () => {
    for (const anchor of ANCHORS) {
      expect(isAnchor(anchor)).toBe(true);
    }
    expect(isAnchor('CURTAIN')).toBe(false);
  });

  it('reads a step back', () => {
    withStore((db) => {
      seedProperty(db);
      const step = setTemplateStep(db, CANYON, {
        serviceStyle: 'plated',
        sequence: 1,
        label: '  crew in  ',
        anchor: 'setup',
        offsetMinutes: -15,
        perCoverSeconds: 5,
        owner: 'HOUSEMAN',
      });
      expect(step.serviceStyle).toBe('PLATED');
      expect(step.anchor).toBe('SETUP');
      expect(step.label).toBe('crew in');
      expect(step.offsetMinutes).toBe(-15);
      expect(step.perCoverSeconds).toBe(5);
    });
  });

  it('replaces a step set twice', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { serviceStyle: 'PLATED', sequence: 1, label: 'x', anchor: 'DOORS' };
      setTemplateStep(db, CANYON, base);
      setTemplateStep(db, CANYON, { ...base, label: 'y' });
      expect(requireTemplateStep(db, CANYON, 'PLATED', 1).label).toBe('y');
      expect(listTemplate(db, CANYON, 'PLATED')).toHaveLength(1);
    });
  });

  it('refuses an unknown style, anchor, sequence, label or allowance', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { serviceStyle: 'PLATED', sequence: 1, label: 'x', anchor: 'DOORS' };
      expect(() => setTemplateStep(db, CANYON, { ...base, serviceStyle: 'TAPAS' })).toThrow(
        /not a service style/,
      );
      expect(() => setTemplateStep(db, CANYON, { ...base, anchor: 'CURTAIN' })).toThrow(
        /not an anchor a step hangs off/,
      );
      expect(() => setTemplateStep(db, CANYON, { ...base, sequence: 0 })).toThrow(
        /whole number of one or more/,
      );
      expect(() => setTemplateStep(db, CANYON, { ...base, label: '  ' })).toThrow(/needs a label/);
      expect(() => setTemplateStep(db, CANYON, { ...base, perCoverSeconds: -1 })).toThrow(
        /whole seconds, zero or more/,
      );
    });
  });

  it('answers for a step that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => requireTemplateStep(db, CANYON, 'PLATED', 1)).toThrow(/has no PLATED step 1/);
      expect(listTemplate(db, CANYON, 'PLATED')).toEqual([]);
    });
  });
});

describe('the anchors on a function', () => {
  it('takes setup and teardown off the room', () => {
    withStore((db) => {
      const slot = timed(db);
      const anchors = anchorsFor(db, slot.id);
      expect(anchors.DOORS).toBe(1080);
      expect(anchors.SETUP).toBe(960);
      expect(anchors.SERVICE).toBe(1110);
      expect(anchors.CLOSE).toBe(1380);
      expect(anchors.TEARDOWN).toBe(1440);
    });
  });
});

describe('computing the run of show', () => {
  it('lands every step off its anchor and offset', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      const steps = computeRunOfShow(db, slot.id);
      const at = (label: string) => steps.find((step) => step.label === label)?.minute;
      expect(at('crew in, room set')).toBe(960);
      expect(at('mise en place')).toBe(900);
      expect(at('doors open')).toBe(1080);
      expect(at('guests seated')).toBe(1110);
      expect(at('main fired')).toBe(1155);
      expect(at('bar closes')).toBe(1350);
      expect(at('room struck')).toBe(1440);
    });
  });

  it('starts the plate up earlier the more covers there are', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      const at180 = computeRunOfShow(db, slot.id).find(
        (step) => step.label === 'plate up starts',
      )?.minute;
      expect(at180).toBe(1110 - 63);

      setGuarantee(db, slot.id, 300, KITCHEN_NOW);
      const at300 = computeRunOfShow(db, slot.id).find(
        (step) => step.label === 'plate up starts',
      )?.minute;
      expect(at300).toBe(1110 - 105);
    });
  });

  it('takes an override cover count', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      const steps = computeRunOfShow(db, slot.id, { covers: 60 });
      expect(steps.find((step) => step.label === 'plate up starts')?.minute).toBe(1110 - 20);
    });
  });

  it('is empty for a style with no template on file', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(computeRunOfShow(db, slot.id)).toEqual([]);
    });
  });
});

describe('saving and pinning', () => {
  it('freezes the computed steps in time order', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      const saved = saveRunOfShow(db, slot.id);
      expect(saved).toHaveLength(9);
      expect(saved[0]?.label).toBe('mise en place');
      expect(saved.map((step) => step.minute)).toEqual(
        [...saved.map((step) => step.minute)].sort((left, right) => left - right),
      );
    });
  });

  it('redraws every unpinned step when the count moves', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      saveRunOfShow(db, slot.id);
      setGuarantee(db, slot.id, 300, KITCHEN_NOW);
      const redrawn = saveRunOfShow(db, slot.id);
      expect(redrawn.find((step) => step.label === 'plate up starts')?.minute).toBe(1110 - 105);
    });
  });

  it('leaves a pinned step exactly where it was put', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      saveRunOfShow(db, slot.id);
      const pinned = pinStep(db, slot.id, 3, 1000, 'chef wants the extra hour');
      expect(pinned.find((step) => step.sequence === 3)?.minute).toBe(1000);
      expect(pinned.find((step) => step.sequence === 3)?.pinned).toBe(true);

      setGuarantee(db, slot.id, 300, KITCHEN_NOW);
      const redrawn = saveRunOfShow(db, slot.id);
      expect(redrawn.find((step) => step.sequence === 3)?.minute).toBe(1000);
      expect(redrawn.find((step) => step.sequence === 3)?.note).toBe('chef wants the extra hour');
    });
  });

  it('lets a pin be released', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      saveRunOfShow(db, slot.id);
      pinStep(db, slot.id, 3, 1000);
      unpinStep(db, slot.id, 3);
      const redrawn = saveRunOfShow(db, slot.id);
      expect(redrawn.find((step) => step.sequence === 3)?.minute).toBe(1110 - 63);
    });
  });

  it('refuses to pin a step that is not there or a minute that is not one', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      saveRunOfShow(db, slot.id);
      expect(() => pinStep(db, slot.id, 99, 1000)).toThrow(/has no step 99 to pin/);
      expect(() => pinStep(db, slot.id, 3, 1000.5)).toThrow(/whole minute/);
    });
  });

  it('is empty before anything is saved', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      expect(listRunOfShow(db, slot.id)).toEqual([]);
    });
  });
});

describe('printing the run of show', () => {
  it('prints one line a step with the clock on the left', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      const text = renderRunOfShow(saveRunOfShow(db, slot.id));
      expect(text).toContain('mise en place');
      expect(text).toContain('6pm');
      expect(text).toContain('CHEF');
      expect(text.split('\n')).toHaveLength(9);
    });
  });

  it('marks a step somebody pinned', () => {
    withStore((db) => {
      const slot = timed(db, 180);
      saveRunOfShow(db, slot.id);
      const text = renderRunOfShow(pinStep(db, slot.id, 3, 1000));
      expect(text).toContain('*');
    });
  });

  it('says so when there is nothing to print', () => {
    expect(renderRunOfShow([])).toBe('no run of show');
  });
});
