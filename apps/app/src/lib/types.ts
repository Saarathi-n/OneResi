import type * as C from '@oneresi/contracts';

/**
 * What the API actually puts on the wire, as this app receives it. The domain's view types
 * (packages/domain/src/ports.ts) declare `Date` fields; JSON carries those as ISO strings, so
 * these are the same shapes with the dates stated honestly. Paise stay integers end to end —
 * the rupees happen in a component, never here.
 */

export interface HomeWire {
  readonly unitId: number;
  readonly blockName: string;
  readonly label: string;
  readonly type: C.UnitType;
  readonly monthlyChargePaise: C.Paise;
}

export interface PersonWire {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly role: C.Role;
  readonly status: C.UserStatus;
  readonly home: HomeWire | null;
}

/** What POST /api/auth/sign-in and /api/auth/refresh return. */
export interface SessionWire {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly person: PersonWire;
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
}

export interface ApplicationWire {
  readonly userId: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly appliedAt: string;
  readonly claim: {
    readonly blockName: string;
    readonly unitLabel: string;
    readonly unitType: C.UnitType;
    readonly note: string | null;
  } | null;
}

export interface PassWire {
  readonly id: number;
  readonly visitorName: string;
  readonly purpose: string;
  readonly code: string;
  readonly validOn: string;
  readonly status: C.PassStatus;
  readonly arrivedAt: string | null;
}

export interface InvoiceWire {
  readonly id: number;
  readonly period: string;
  readonly amountPaise: C.Paise;
  readonly dueOn: string;
  readonly status: C.InvoiceStatus;
  readonly receiptNo: string | null;
  readonly paidAt: string | null;
}

export interface SocietyInvoiceWire extends InvoiceWire {
  readonly home: HomeWire;
}

export interface ComplaintWire {
  readonly id: number;
  readonly category: C.ComplaintCategory;
  readonly priority: C.ComplaintPriority;
  readonly description: string;
  readonly status: C.ComplaintStatus;
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly reopenableUntil: string | null;
  readonly updates: readonly {
    readonly at: string;
    readonly by: string;
    readonly statusAfter: C.ComplaintStatus;
    readonly note: string;
  }[];
}

export interface BookingWire {
  readonly id: number;
  readonly facilityName: string;
  readonly bookingDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: C.BookingStatus;
  readonly amountPaise: C.Paise;
}

export interface SocietyBookingWire extends BookingWire {
  readonly home: HomeWire;
}

export interface NoticeWire {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly category: C.AnnouncementCategory;
  readonly pinned: boolean;
  readonly publishedAt: string;
  readonly authorName: string;
}

export interface WaitingVisitorWire {
  readonly logId: number;
  readonly name: string;
  readonly phone: string | null;
  readonly purpose: string;
  readonly since: string;
  /**
   * Only the society-wide read sets it (`Emerald · B-304`): the gate's feed names the flat a
   * visitor waits on; a resident already knows which home is theirs.
   */
  readonly homeLabel?: string | undefined;
}

export interface EntryLogWire {
  readonly logId: number;
  readonly kind: 'PASS' | 'WALK_IN';
  readonly visitorName: string;
  readonly purpose: string;
  readonly approvalStatus: C.ApprovalStatus;
  readonly decidedByName: string | null;
  readonly overrideReason: string | null;
  readonly enteredAt: string | null;
  readonly exitedAt: string | null;
  readonly at: string;
}

export interface FacilityWire {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly hourlyRatePaise: C.Paise;
}

export interface SlotWire {
  readonly startTime: string;
  readonly endTime: string;
  readonly available: boolean;
  readonly reason?: 'HELD' | 'OUTSIDE_HOURS' | 'PAST';
}

export interface NotificationItemWire {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly at: string;
  readonly read: boolean;
}

export interface NotificationsWire {
  readonly count: number;
  readonly items: readonly NotificationItemWire[];
}

/** The only public property surface: labels, no charges, no occupants. */
export interface RegistrationOptionsWire {
  readonly blockId: number;
  readonly blockName: string;
  readonly units: readonly { readonly unitId: number; readonly label: string }[];
}

export interface BlockWire {
  readonly id: number;
  readonly name: string;
  readonly floors: number;
  readonly active: boolean;
  readonly unitCount: number;
}

/**
 * What POST /api/gate/verify answers with. The kiosk renders a decision, never a row (D-40): a
 * refusal carries only its reason, so there is nothing to misread on the spot.
 */
export type GateDecisionWire =
  | {
      readonly verdict: 'ADMIT';
      readonly passId: number;
      readonly visitorName: string;
      readonly purpose: string;
      readonly destination: string;
      readonly hostName: string;
    }
  | {
      readonly verdict: 'REFUSE';
      readonly reason: C.GateRefusalReason;
    };
