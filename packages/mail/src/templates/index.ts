import { seal, TEMPLATE_IDS, type SealedTemplate, type TemplateId } from '../types.js';

import { template as announcementPublished } from './announcement-published.js';
import { template as bookingDecided } from './booking-decided.js';
import { template as bookingRequested } from './booking-requested.js';
import { template as complaintStatusChanged } from './complaint-status-changed.js';
import { template as invoiceOverdue } from './invoice-overdue.js';
import { template as invoiceRaised } from './invoice-raised.js';
import { template as passwordReset } from './password-reset.js';
import { template as paymentReceived } from './payment-received.js';
import { template as registrationApproved } from './registration-approved.js';
import { template as registrationDeclined } from './registration-declined.js';
import { template as residentRegistered } from './resident-registered.js';
import { template as visitorDecided } from './visitor-decided.js';
import { template as visitorWaiting } from './visitor-waiting.js';

/**
 * The thirteen mails, by the event that causes them.
 *
 * `Record<TemplateId, ...>` is the point: a template id in `types.ts` with no module here does not
 * compile, and a module whose `id` does not match its key does not compile either.
 */
export const TEMPLATES: Readonly<Record<TemplateId, SealedTemplate>> = {
  'resident.registered': seal(residentRegistered),
  'resident.approved': seal(registrationApproved),
  'resident.declined': seal(registrationDeclined),
  'password.reset_requested': seal(passwordReset),
  'walkin.awaiting_decision': seal(visitorWaiting),
  'walkin.decided': seal(visitorDecided),
  'complaint.updated': seal(complaintStatusChanged),
  'invoice.raised': seal(invoiceRaised),
  'invoice.overdue': seal(invoiceOverdue),
  'payment.received': seal(paymentReceived),
  'booking.requested': seal(bookingRequested),
  'booking.decided': seal(bookingDecided),
  'announcement.published': seal(announcementPublished),
};

/** Undefined rather than a throw, so the worker can record a reason instead of crashing. */
export function findTemplate(id: string): SealedTemplate | undefined {
  return (TEMPLATES as Readonly<Record<string, SealedTemplate | undefined>>)[id];
}

/** In the declared order, for a suite that walks every template. */
export const ALL_TEMPLATES: readonly SealedTemplate[] = TEMPLATE_IDS.map((id) => TEMPLATES[id]);

export {
  announcementPublished,
  bookingDecided,
  bookingRequested,
  complaintStatusChanged,
  invoiceOverdue,
  invoiceRaised,
  passwordReset,
  paymentReceived,
  registrationApproved,
  registrationDeclined,
  residentRegistered,
  visitorDecided,
  visitorWaiting,
};

export type { AnnouncementPublishedPayload, AnnouncementPublishedVars } from './announcement-published.js';
export type { BookingDecidedPayload, BookingDecidedVars } from './booking-decided.js';
export type { BookingRequestedPayload, BookingRequestedVars } from './booking-requested.js';
export type {
  ComplaintStatusChangedPayload,
  ComplaintStatusChangedVars,
} from './complaint-status-changed.js';
export type { InvoiceOverduePayload, InvoiceOverdueVars } from './invoice-overdue.js';
export type { InvoiceRaisedPayload, InvoiceRaisedVars } from './invoice-raised.js';
export type { PasswordResetPayload, PasswordResetVars } from './password-reset.js';
export type { PaymentReceivedPayload, PaymentReceivedVars } from './payment-received.js';
export type {
  RegistrationApprovedPayload,
  RegistrationApprovedVars,
} from './registration-approved.js';
export type {
  RegistrationDeclinedPayload,
  RegistrationDeclinedVars,
} from './registration-declined.js';
export type { ResidentRegisteredPayload, ResidentRegisteredVars } from './resident-registered.js';
export type { VisitorDecidedPayload, VisitorDecidedVars } from './visitor-decided.js';
export type { VisitorWaitingPayload, VisitorWaitingVars } from './visitor-waiting.js';
