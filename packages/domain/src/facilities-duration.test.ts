import { describe, it, expect } from 'vitest';
import { MAX_BOOKING_HOURS } from '@oneresi/contracts';

interface FacilityRule {
  hourlyRatePaise: number;
  opensAtMinutes: number; // e.g. 9 * 60 = 540
  closesAtMinutes: number; // e.g. 23 * 60 = 1380
}

function calculateCharge(ratePaise: number, hours: number): number {
  if (hours < 1 || hours > MAX_BOOKING_HOURS) {
    throw new Error(`Booking duration must be between 1 and ${MAX_BOOKING_HOURS} hours.`);
  }
  return ratePaise * hours;
}

function isWithinOperatingHours(
  facility: FacilityRule,
  startHour: number,
  durationHours: number,
): boolean {
  const startMin = startHour * 60;
  const endMin = startMin + durationHours * 60;
  return startMin >= facility.opensAtMinutes && endMin <= facility.closesAtMinutes;
}

function generateTimeSlots(
  facility: FacilityRule,
  durationHours: number,
  bookedHours: ReadonlySet<number>,
): { startHour: number; endHour: number; available: boolean }[] {
  const slots: { startHour: number; endHour: number; available: boolean }[] = [];
  const startH = Math.floor(facility.opensAtMinutes / 60);
  const endH = Math.floor(facility.closesAtMinutes / 60);

  for (let h = startH; h + durationHours <= endH; h += 1) {
    // Check if any hour in the consecutive duration block is already booked
    let conflict = false;
    for (let offset = 0; offset < durationHours; offset += 1) {
      if (bookedHours.has(h + offset)) {
        conflict = true;
        break;
      }
    }
    slots.push({
      startHour: h,
      endHour: h + durationHours,
      available: !conflict,
    });
  }
  return slots;
}

describe('Facilities Duration & Dynamic Charge Calculations', () => {
  const clubhouse: FacilityRule = {
    hourlyRatePaise: 75000, // ₹750/hr
    opensAtMinutes: 9 * 60,  // 09:00
    closesAtMinutes: 23 * 60, // 23:00
  };

  it('calculates 1 hour base rate correctly', () => {
    expect(calculateCharge(clubhouse.hourlyRatePaise, 1)).toBe(75000);
  });

  it('calculates multi-hour duration charges correctly up to max hours', () => {
    expect(calculateCharge(clubhouse.hourlyRatePaise, 2)).toBe(150000);
    expect(calculateCharge(clubhouse.hourlyRatePaise, 3)).toBe(225000);
    expect(calculateCharge(clubhouse.hourlyRatePaise, 4)).toBe(300000);
    expect(calculateCharge(clubhouse.hourlyRatePaise, 5)).toBe(375000);
    expect(calculateCharge(clubhouse.hourlyRatePaise, 6)).toBe(450000);
  });

  it('enforces maximum duration limit', () => {
    expect(() => calculateCharge(clubhouse.hourlyRatePaise, 7)).toThrow(
      `Booking duration must be between 1 and ${MAX_BOOKING_HOURS} hours.`,
    );
  });

  it('refuses duration below 1 hour', () => {
    expect(() => calculateCharge(clubhouse.hourlyRatePaise, 0)).toThrow(
      `Booking duration must be between 1 and ${MAX_BOOKING_HOURS} hours.`,
    );
    expect(() => calculateCharge(clubhouse.hourlyRatePaise, -2)).toThrow(
      `Booking duration must be between 1 and ${MAX_BOOKING_HOURS} hours.`,
    );
  });

  it('handles free/complimentary facility (0 paise per hour)', () => {
    expect(calculateCharge(0, 3)).toBe(0);
  });

  it('verifies slot is within operating hours for valid window', () => {
    // 14:00 to 18:00 (4 hours)
    expect(isWithinOperatingHours(clubhouse, 14, 4)).toBe(true);
  });

  it('refuses booking starting before opening time', () => {
    // 08:00 to 10:00 (opens at 09:00)
    expect(isWithinOperatingHours(clubhouse, 8, 2)).toBe(false);
  });

  it('refuses booking that extends past closing time', () => {
    // 21:00 to 01:00 (4 hours, closes at 23:00)
    expect(isWithinOperatingHours(clubhouse, 21, 4)).toBe(false);
  });

  it('generates correct slot sequence and flags conflicts across multi-hour blocks', () => {
    // 14:00 is booked
    const booked = new Set([14]);
    // 2-hour duration booking
    const slots = generateTimeSlots(clubhouse, 2, booked);

    // 13:00-15:00 covers 13 and 14 -> should be UNAVAILABLE
    const slot13 = slots.find((s) => s.startHour === 13);
    expect(slot13?.available).toBe(false);

    // 14:00-16:00 covers 14 and 15 -> should be UNAVAILABLE
    const slot14 = slots.find((s) => s.startHour === 14);
    expect(slot14?.available).toBe(false);

    // 15:00-17:00 covers 15 and 16 -> should be AVAILABLE
    const slot15 = slots.find((s) => s.startHour === 15);
    expect(slot15?.available).toBe(true);
  });
});
