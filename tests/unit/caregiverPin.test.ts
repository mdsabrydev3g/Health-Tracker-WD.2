import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasCaregiverPin,
  hashPin,
  setCaregiverPin,
  verifyCaregiverPin,
} from '@/modes/mother/CaregiverPinDialog';

/**
 * The caregiver PIN guards the exit from Mother Mode. These tests exist because
 * of a real lockout: `verifyCaregiverPin` returns false when nothing is stored,
 * so a user who reached Mother Mode without ever setting a PIN could never get
 * out — no PIN would ever be accepted. The dialog now short-circuits that case,
 * and `hasCaregiverPin` is what it branches on.
 */
describe('caregiver PIN', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports no PIN on a fresh device', () => {
    expect(hasCaregiverPin()).toBe(false);
  });

  it('never accepts a PIN when none has been set (the lockout trap)', () => {
    // Whatever the user types, there is nothing to match against. This is the
    // exact condition the exit dialog must detect rather than showing a form.
    expect(verifyCaregiverPin('1234')).toBe(false);
    expect(verifyCaregiverPin('')).toBe(false);
    expect(verifyCaregiverPin('0000')).toBe(false);
  });

  it('accepts the correct PIN and rejects a wrong one once set', () => {
    setCaregiverPin('4321');
    expect(hasCaregiverPin()).toBe(true);
    expect(verifyCaregiverPin('4321')).toBe(true);
    expect(verifyCaregiverPin('4322')).toBe(false);
    expect(verifyCaregiverPin('43210')).toBe(false);
  });

  it('overwrites the previous PIN rather than keeping both', () => {
    setCaregiverPin('1111');
    setCaregiverPin('2222');
    expect(verifyCaregiverPin('1111')).toBe(false);
    expect(verifyCaregiverPin('2222')).toBe(true);
  });

  it('stores a hash, never the PIN itself', () => {
    setCaregiverPin('9876');
    const raw = localStorage.getItem('health-tracker:caregiver-pin-hash');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('9876');
    expect(raw).toBe(hashPin('9876'));
  });

  it('is case/format stable for the same digits', () => {
    setCaregiverPin('1234');
    expect(hashPin('1234')).toBe(hashPin('1234'));
    expect(hashPin('1234')).not.toBe(hashPin('12345'));
  });
});
