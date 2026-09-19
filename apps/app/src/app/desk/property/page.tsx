'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Card, Field, Input, NumericInput, Select, Sheet, useToast } from '@grihaone/ui';
import * as C from '@grihaone/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { BlockWire, RegistrationOptionsWire } from '@/lib/types';

/**
 * The property register: the blocks and units the society is made of. Creating either is the
 * committee's alone, and the register speaks in natural keys — a duplicate block name or flat
 * number is a sentence from the API, not a constraint error. Retiring a home is refused while
 * anybody still lives on it, because that would strand a person on a bill forever.
 */
export default function PropertyPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [addingBlock, setAddingBlock] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [editingUnit, setEditingUnit] = useState(false);

  const blocks = useAsync(() => simple<readonly BlockWire[]>('/api/property/blocks'), []);

  const refresh = useCallback(async () => {
    blocks.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [blocks]);

  return (
    <Shell
      title="Property"
      subtitle="Blocks, homes, and their charges"
      backHref="/desk/more"
      tabs={COMMITTEE_TABS}
      activeTab="/desk/more"
      onRefresh={refresh}
      headerRight={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAddingUnit(true);
            }}
          >
            <Icon name="plus" size={16} />
            Unit
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setAddingBlock(true);
            }}
          >
            <Icon name="plus" size={16} />
            Block
          </Button>
        </div>
      }
    >
      <AsyncView
        state={blocks.state}
        skeleton={<CardListSkeleton rows={3} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">No blocks yet</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              Start with the first block — A Wing, Tower 1, whatever the society calls it — then add
              its homes one by one.
            </p>
          </div>
        }
        onRetry={blocks.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            {list.map((block, index) => (
              <div key={block.id} className="row-in" style={rowStyle(index, reduced)}>
                <Card tone={block.active ? undefined : 'neutral'}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate type-body font-medium">{block.name}</p>
                      <p className="type-label text-content-subtle">
                        {block.unitCount} {block.unitCount === 1 ? 'home' : 'homes'}
                        {block.active ? ` · ${block.floors} ${block.floors === 1 ? 'floor' : 'floors'}` : ''}
                      </p>
                    </div>
                    {block.active ? (
                      <Badge tone="positive" size="sm">Active</Badge>
                    ) : (
                      <Badge tone="neutral" size="sm">Retired</Badge>
                    )}
                  </div>
                </Card>
              </div>
            ))}
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setEditingUnit(true);
              }}
            >
              Change a home&rsquo;s charge or retire it
            </Button>
          </div>
        )}
      />

      {addingBlock ? (
        <AddBlockSheet
          onClose={() => {
            setAddingBlock(false);
          }}
          onAdded={() => {
            setAddingBlock(false);
            blocks.reload();
            toast.show({ title: 'Block added', description: 'Now add its homes so people can claim them.' });
          }}
        />
      ) : null}

      {addingUnit ? (
        <AddUnitSheet
          blocks={blocks.state.state === 'ready' ? blocks.state.data : []}
          onClose={() => {
            setAddingUnit(false);
          }}
          onAdded={(label, blockName) => {
            setAddingUnit(false);
            blocks.reload();
            toast.show({ title: `${label} added`, description: `A new home in ${blockName}.` });
          }}
        />
      ) : null}

      {editingUnit ? (
        <EditUnitSheet
          onClose={() => {
            setEditingUnit(false);
          }}
          onSaved={(what) => {
            setEditingUnit(false);
            toast.show({ title: 'Saved', description: what });
          }}
        />
      ) : null}
    </Shell>
  );
}

function AddBlockSheet({
  onClose,
  onAdded,
}: {
  readonly onClose: () => void;
  readonly onAdded: (name: string) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [floors, setFloors] = useState<number | null>(1);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const found: Record<string, string> = {};
    if (name.trim().length === 0) found.name = 'Give the block the name residents use for it.';
    if (floors === null) found.floors = 'How many floors does it have?';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await simple<{ id: number }>('/api/property/blocks', {
      method: 'POST',
      json: { name: name.trim(), floors: floors ?? 1 },
    });
    setPending(false);
    if (result.ok) {
      onAdded(name.trim());
      return;
    }
    if (result.error.field !== undefined) setErrors({ [result.error.field]: result.error.message });
    else setErrors({ form: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a block"
      description="A wing, a tower, a row of villas — the name residents already use."
      pending={pending}
      footer={
        <Button
          size="lg"
          fullWidth
          pending={pending}
          pendingLabel="Adding"
          onClick={() => {
            void submit();
          }}
        >
          Add the block
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Block name" required error={errors['name']}>
          <Input
            value={name}
            maxLength={80}
            invalid={errors['name'] !== undefined}
            placeholder="B Wing"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>

        <Field label="Floors" required error={errors['floors']}>
          <NumericInput
            value={floors}
            onValueChange={setFloors}
            min={1}
            max={100}
            steppers
            invalid={errors['floors'] !== undefined}
          />
        </Field>

        {errors['form'] !== undefined ? (
          <p
            role="alert"
            className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical"
          >
            {errors['form']}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function AddUnitSheet({
  blocks,
  onClose,
  onAdded,
}: {
  readonly blocks: readonly BlockWire[];
  readonly onClose: () => void;
  readonly onAdded: (label: string, blockName: string) => void;
}): ReactNode {
  const activeBlocks = blocks.filter((block) => block.active);
  const [blockId, setBlockId] = useState<number | null>(activeBlocks[0]?.id ?? null);
  const [unitLabel, setUnitLabel] = useState('');
  const [type, setType] = useState<C.UnitType>('FLAT_2BHK');
  const [charge, setCharge] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const found: Record<string, string> = {};
    if (blockId === null) found.blockId = 'Which block does this home belong to?';
    if (unitLabel.trim().length === 0) found.unitLabel = 'Enter the flat or plot number.';
    if (charge === null) found.charge = 'Set the monthly maintenance charge for this home.';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    // The person thinks in rupees; the wire carries whole paise, converted once, here.
    const result = await simple<{ id: number }>('/api/property/units', {
      method: 'POST',
      json: {
        blockId: blockId ?? 0,
        unitLabel: unitLabel.trim(),
        type,
        monthlyChargePaise: Math.round((charge ?? 0) * 100),
      },
    });
    setPending(false);
    if (result.ok) {
      const blockName = activeBlocks.find((block) => block.id === blockId)?.name ?? 'the block';
      onAdded(unitLabel.trim().toUpperCase(), blockName);
      return;
    }
    if (result.error.field !== undefined) setErrors({ [result.error.field]: result.error.message });
    else setErrors({ form: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a home"
      description="One flat, villa or shop. An applicant can then claim it on their registration."
      pending={pending}
      footer={
        <Button
          size="lg"
          fullWidth
          pending={pending}
          pendingLabel="Adding"
          onClick={() => {
            void submit();
          }}
        >
          Add the home
        </Button>
      }
    >
      {activeBlocks.length === 0 ? (
        <p className="type-body text-content-muted">
          There is no active block to add a home to yet — add the block first.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Block" required error={errors['blockId']}>
            <Select
              value={blockId === null ? '' : String(blockId)}
              options={activeBlocks.map((block) => ({ value: String(block.id), label: block.name }))}
              onChange={(event) => {
                setBlockId(Number(event.target.value));
              }}
            />
          </Field>

          <Field label="Flat or plot number" required error={errors['unitLabel']}>
            <Input
              value={unitLabel}
              maxLength={20}
              invalid={errors['unitLabel'] !== undefined}
              placeholder="1102"
              onChange={(event) => {
                setUnitLabel(event.target.value);
              }}
            />
          </Field>

          <Field label="Type" required>
            <Select
              value={type}
              options={C.UNIT_TYPES.map((value) => ({ value, label: C.UNIT_TYPE[value].label }))}
              onChange={(event) => {
                setType(event.target.value as C.UnitType);
              }}
            />
          </Field>

          <Field label="Monthly maintenance" required error={errors['charge']} hint="What this home is billed every month.">
            <NumericInput
              value={charge}
              onValueChange={setCharge}
              min={0}
              step={100}
              unit="rupees a month"
              invalid={errors['charge'] !== undefined}
            />
          </Field>

          {errors['form'] !== undefined ? (
            <p
              role="alert"
              className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical"
            >
              {errors['form']}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function EditUnitSheet({
  onClose,
  onSaved,
}: {
  readonly onClose: () => void;
  readonly onSaved: (what: string) => void;
}): ReactNode {
  const options = useAsync(() => simple<readonly RegistrationOptionsWire[]>('/api/registration/options'), []);
  const [blockId, setBlockId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [typeChoice, setTypeChoice] = useState<'KEEP' | C.UnitType>('KEEP');
  const [charge, setCharge] = useState<number | null>(null);
  const [retire, setRetire] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const found: Record<string, string> = {};
    if (unitId === null) found.unit = 'Pick the home this change is for.';
    const changing =
      (typeChoice !== 'KEEP' ? 1 : 0) + (charge !== null ? 1 : 0) + (retire ? 1 : 0);
    if (changing === 0) found.form = 'Choose at least one change — a type, a charge, or retirement.';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await simple<null>(`/api/property/units/${unitId ?? 0}`, {
      method: 'PATCH',
      json: {
        unitId: unitId ?? 0,
        ...(typeChoice !== 'KEEP' ? { type: typeChoice } : {}),
        ...(charge !== null ? { monthlyChargePaise: Math.round(charge * 100) } : {}),
        ...(retire ? { active: false } : {}),
      },
    });
    setPending(false);
    if (result.ok) {
      onSaved(retire ? 'The home is retired — it no longer appears for registration.' : 'The register is up to date.');
      return;
    }
    if (result.error.field !== undefined) setErrors({ [result.error.field]: result.error.message });
    else setErrors({ form: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change a home"
      description="The register keeps what a home already is; only what you set here changes."
      pending={pending}
      footer={
        <Button
          size="lg"
          variant={retire ? 'danger' : 'primary'}
          fullWidth
          pending={pending}
          pendingLabel="Saving"
          onClick={() => {
            void submit();
          }}
        >
          {retire ? 'Retire this home' : 'Save the change'}
        </Button>
      }
    >
      <AsyncView
        state={options.state}
        skeleton={<CardListSkeleton rows={2} />}
        empty={
          <p className="type-body text-content-muted">
            There are no active homes in the register yet — add a block and its homes first.
          </p>
        }
        onRetry={options.reload}
        render={(list) => {
          const activeBlocks = list;
          const block = activeBlocks.find((entry) => entry.blockId === blockId) ?? activeBlocks[0];
          if (block === undefined) {
            return (
              <p className="type-body text-content-muted">
                There are no active homes in the register yet — add a block and its homes first.
              </p>
            );
          }
          const safeBlockId = blockId ?? block.blockId;
          const safeUnits =
            activeBlocks.find((entry) => entry.blockId === safeBlockId)?.units ?? [];
          return (
            <div className="flex flex-col gap-4">
              <Field label="Block" required>
                <Select
                  value={String(safeBlockId)}
                  options={activeBlocks.map((entry) => ({
                    value: String(entry.blockId),
                    label: entry.blockName,
                  }))}
                  onChange={(event) => {
                    setBlockId(Number(event.target.value));
                    setUnitId(null);
                  }}
                />
              </Field>

              <Field label="Home" required error={errors['unit']}>
                <Select
                  value={unitId === null ? '' : String(unitId)}
                  options={safeUnits.map((unit) => ({ value: String(unit.unitId), label: unit.label }))}
                  placeholder="Choose the flat"
                  onChange={(event) => {
                    setUnitId(Number(event.target.value));
                  }}
                />
              </Field>

              <Field label="Type" error={errors['type']} hint="Leave as is unless the home was recorded wrong.">
                <Select
                  value={typeChoice}
                  options={[
                    { value: 'KEEP', label: 'Leave as is' },
                    ...C.UNIT_TYPES.map((value) => ({ value, label: C.UNIT_TYPE[value].label })),
                  ]}
                  onChange={(event) => {
                    setTypeChoice(event.target.value as 'KEEP' | C.UnitType);
                  }}
                />
              </Field>

              <Field
                label="Monthly maintenance"
                optional
                error={errors['monthlyChargePaise']}
                hint="Blank keeps the current charge."
              >
                <NumericInput
                  value={charge}
                  onValueChange={setCharge}
                  min={0}
                  step={100}
                  unit="rupees a month"
                  placeholder="Current charge"
                  invalid={errors['monthlyChargePaise'] !== undefined}
                />
              </Field>

              <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 focus-ring-inset">
                <input
                  type="checkbox"
                  checked={retire}
                  onChange={(event) => {
                    setRetire(event.target.checked);
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-critical"
                />
                <span className="min-w-0">
                  <span className="type-body font-medium">Retire this home</span>
                  <span className="block type-label text-content-subtle">
                    It leaves the registration list. Refused while someone still lives on it.
                  </span>
                </span>
              </label>

              {errors['form'] !== undefined ? (
                <p
                  role="alert"
                  className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical"
                >
                  {errors['form']}
                </p>
              ) : null}
            </div>
          );
        }}
      />
    </Sheet>
  );
}
