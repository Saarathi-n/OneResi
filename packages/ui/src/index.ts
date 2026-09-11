/**
 * Everything the two apps import from the design system. One barrel, re-exported as-is, so a
 * component's import never reaches past the package boundary into internals.
 */

// Tokens
export {
  typeScale,
  type TypeStep,
  typeClass,
  duration,
  type DurationName,
  spring,
  type SpringWeight,
  travel,
  type TravelName,
  stagger,
  seconds,
  radius,
  space,
  elevation,
  type ElevationLevel,
  type ToneLayer,
  toneVar,
} from './tokens.js';
export { cn } from './internal/cn.js';

// Brand
export { Logo, type LogoProps } from './brand/Logo.js';

// Controls
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './components/Button.js';
export { buttonClass } from './components/buttonStyles.js';
export { IconButton, type IconButtonProps } from './components/IconButton.js';
export { Field, type FieldProps, useFieldControl, type FieldControl } from './components/Field.js';
export { Input, type InputProps } from './components/Input.js';
export { NumericInput, type NumericInputProps } from './components/NumericInput.js';
export { OtpInput, type OtpInputProps } from './components/OtpInput.js';
export { Select, type SelectOption, type SelectProps } from './components/Select.js';
export { Textarea, type TextareaProps } from './components/Textarea.js';
export { Stepper, type Step, type StepperProps } from './components/Stepper.js';

// Containers
export {
  Card,
  type CardProps,
  CardHeader,
  type CardHeaderProps,
  CardBody,
  CardFooter,
} from './components/Card.js';
export { Dialog, type DialogProps } from './components/Dialog.js';
export { Sheet, type SheetProps } from './components/Sheet.js';
export { Tabs, type TabItem, type TabsProps } from './components/Tabs.js';

// Presentation
export { Badge, type BadgeProps } from './components/Badge.js';
export { StatusPill, type StatusPillProps } from './components/StatusPill.js';
export { PriorityPill, type PriorityPillProps } from './components/PriorityPill.js';
export { ProgressRing, type ProgressRingProps } from './components/ProgressRing.js';
export { Money, type MoneyProps } from './components/Money.js';
export { RelativeTime, type RelativeTimeProps } from './components/RelativeTime.js';
export { CodeDisplay, type CodeDisplayProps } from './components/CodeDisplay.js';
export { Table, type Column, type SortDirection, type SortState, type TableProps } from './components/Table.js';
export { Skeleton, type SkeletonProps } from './components/Skeleton.js';
export { EmptyState, type EmptyStateProps } from './components/EmptyState.js';
export { ErrorState, type ErrorStateProps } from './components/ErrorState.js';
export { ToastProvider, type ToastOptions, type ToastApi, useToast } from './components/Toast.js';

// Motion
export { useMotion, type Motion, createMotion } from './motion/useMotion.js';
export {
  type NavDirection,
  pageVariants,
  pageForward,
  pageBack,
  backdropVariants,
  sheetVariants,
  dialogVariants,
  listContainerVariants,
  listItemVariants,
  rowMutationVariants,
  rowFlashVariants,
  shakeVariants,
  tabPanelVariants,
  tabUnderlineTransition,
  toastVariants,
  gateVerdictVariants,
  verdictWashVariants,
  controlVariants,
  codeRevealVariants,
} from './motion/transitions.js';
