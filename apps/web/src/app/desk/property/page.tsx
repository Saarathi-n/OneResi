'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from '@oneresi/ui';
import { UNIT_TYPES, UNIT_TYPE, type UnitType } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Property: blocks and units, the society's own ground truth. Every charge the ledger raises
 * comes from here — the monthly charge on a unit is the number, and this screen is where it is
 * set and corrected. Adding a unit to an existing block is how a growing society stays accurate.
 */

interface BlockRow {
  readonly id: number;
  readonly name: string;
  readonly floors: number;
  readonly active: boolean;
  readonly unitCount: number;
}

interface UnitLine {
  readonly unitId: number;
  readonly label: string;
}

interface OptionBlock {
  readonly blockId: number;
  readonly blockName: string;
  readonly units: readonly UnitLine[];
}

const UNIT_TYPE_OPTIONS = UNIT_TYPES.map((value) => ({
  value,
  label: UNIT_TYPE[value].label,
}));

export default function PropertyPage() {
  const blocks = useFetch<readonly BlockRow[]>('/api/property/blocks');
  const toast = useToast();

  const [blockOpen, setBlockOpen] = useState(false);
  const [blockName, setBlockName] = useState('');
  const [floors, setFloors] = useState('1');
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockPending, setBlockPending] = useState(false);

  const [unitOpen, setUnitOpen] = useState(false);
  const [options, setOptions] = useState<readonly OptionBlock[] | null>(null);
  const [blockId, setBlockId] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [unitType, setUnitType] = useState('');
  const [charge, setCharge] = useState('');
  const [unitError, setUnitError] = useState<string | null>(null);
  const [unitPending, setUnitPending] = useState(false);

  const [editFor, setEditFor] = useState<{ blockName: string; unit: UnitLine } | null>(null);
  const [editType, setEditType] = useState('');
  const [editCharge, setEditCharge] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);

  async function loadOptions(): Promise<readonly OptionBlock[]> {
    const result = await call<readonly OptionBlock[]>('/api/registration/options');
    if (result.ok) {
      setOptions(result.data);
      return result.data;
    }
    setOptions(null);
    return [];
  }

  async function createBlock(): Promise<void> {
    if (blockName.trim().length === 0) {
      setBlockError('The block needs a name.');
      return;
    }
    const floorCount = Number(floors);
    if (!Number.isInteger(floorCount) || floorCount < 1 || floorCount > 100) {
      setBlockError('Floors is a whole number from 1 to 100.');
      return;
    }
    setBlockPending(true);
    setBlockError(null);
    const result = await call<{ id: number }>('/api/property/blocks', {
      method: 'POST',
      json: { name: blockName.trim(), floors: floorCount },
    });
    setBlockPending(false);
    if (result.ok) {
      setBlockOpen(false);
      setBlockName('');
      setFloors('1');
      blocks.reload();
      toast.show({ title: 'Block added', tone: 'positive' });
      return;
    }
    setBlockError(result.error.message);
  }

  async function createUnit(): Promise<void> {
    if (blockId === '') {
      setUnitError('Which block is the unit in?');
      return;
    }
    if (unitLabel.trim().length === 0) {
      setUnitError('The unit needs a label — usually its number, like 402.');
      return;
    }
    if (unitType === '') {
      setUnitError('What kind of unit is it?');
      return;
    }
    const rupees = Number(charge.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setUnitError('The monthly charge is a positive amount in rupees.');
      return;
    }
    setUnitPending(true);
    setUnitError(null);
    const result = await call<{ id: number }>('/api/property/units', {
      method: 'POST',
      json: {
        blockId: Number(blockId),
        unitLabel: unitLabel.trim(),
        type: unitType,
        monthlyChargePaise: Math.round(rupees * 100),
      },
    });
    setUnitPending(false);
    if (result.ok) {
      setUnitOpen(false);
      setUnitLabel('');
      setCharge('');
      blocks.reload();
      void loadOptions();
      toast.show({ title: 'Unit added', tone: 'positive' });
      return;
    }
    setUnitError(result.error.message);
  }

  async function saveUnit(): Promise<void> {
    if (editFor === null) return;
    const rupees = Number(editCharge.replace(/[^0-9.]/g, ''));
    if (editType !== '' && !UNIT_TYPES.includes(editType as UnitType)) {
      setEditError('That unit type is not one the society recognises.');
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setEditError('The monthly charge is a positive amount in rupees.');
      return;
    }
    setEditPending(true);
    setEditError(null);
    const result = await call<null>(`/api/property/units/${editFor.unit.unitId}`, {
      method: 'PATCH',
      json: {
        unitId: editFor.unit.unitId,
        ...(editType === '' ? {} : { type: editType }),
        monthlyChargePaise: Math.round(rupees * 100),
        active: editActive,
      },
    });
    setEditPending(false);
    if (result.ok) {
      setEditFor(null);
      blocks.reload();
      toast.show({ title: 'Unit updated', tone: 'positive' });
      return;
    }
    setEditError(result.error.message);
  }

  const blockOptions = options?.map((block) => ({
    value: String(block.blockId),
    label: block.blockName,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-display text-content">Property</h1>
          <p className="type-body mt-1 text-content-muted">
            Blocks and units — the society&apos;s ground truth, and the monthly charges the ledger
            raises from.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setUnitOpen(true);
              setUnitError(null);
              if (options === null) void loadOptions();
            }}
          >
            Add a unit
          </Button>
          <Button
            onClick={() => {
              setBlockOpen(true);
              setBlockError(null);
            }}
          >
            Add a block
          </Button>
        </div>
      </div>

      {blocks.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={120} />
          <Skeleton variant="block" height={120} />
        </div>
      ) : blocks.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState title="Blocks did not load" onRetry={blocks.reload} />
          </CardBody>
        </Card>
      ) : blocks.state.data.length === 0 ? (
        <EmptyState
          title="No blocks yet"
          description="A society starts with its blocks. Add the first one and units follow."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {blocks.state.data.map((block) => (
            <li key={block.id}>
              <Card elevation={0} className="border border-border">
                <CardHeader
                  title={block.name}
                  subtitle={`${block.floors} floor${block.floors === 1 ? '' : 's'} · ${block.unitCount} unit${block.unitCount === 1 ? '' : 's'}`}
                  actions={
                    block.active ? (
                      <Badge tone="positive" size="sm">
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="sm">
                        Inactive
                      </Badge>
                    )
                  }
                />
                <CardBody className="mt-2">
                  {block.unitCount === 0
                    ? 'No units yet — add one so the block can house anyone.'
                    : 'Units are managed from the registration options list below the table.'}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {blocks.state.state === 'ready' && blocks.state.data.some((block) => block.unitCount > 0) ? (
        <Card elevation={1}>
                <CardHeader
                  title="Units"
                  subtitle="Update a unit&apos;s type, monthly charge, or whether it is active."
                />
          <CardBody className="mt-3">
            {options === null ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadOptions()}
                >
                  Load units
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {options.flatMap((block) =>
                  block.units.map((unit) => (
                    <li
                      key={unit.unitId}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="type-body text-content">
                        {block.blockName} {unit.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditFor({ blockName: block.blockName, unit });
                          setEditType('');
                          setEditCharge('');
                          setEditActive(true);
                          setEditError(null);
                        }}
                      >
                        Edit
                      </Button>
                    </li>
                  )),
                )}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Dialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Add a block"
        description="A block is a physical wing of the society — A, B, the tower, whatever residents call it."
      >
        <div className="space-y-4">
          <Field label="Name" required hint="Up to 80 characters.">
            <Input
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
              placeholder="Block C"
            />
          </Field>
          <Field label="Floors" required>
            <Input
              inputMode="numeric"
              value={floors}
              onChange={(event) => setFloors(event.target.value)}
            />
          </Field>
          {blockError !== null ? (
            <p className="type-body text-critical" role="alert">
              {blockError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button pending={blockPending} onClick={() => void createBlock()}>
              Add block
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={unitOpen}
        onClose={() => setUnitOpen(false)}
        title="Add a unit"
        description="The unit&apos;s monthly charge is what the ledger raises for it every period — set it right the first time."
      >
        <div className="space-y-4">
          <Field label="Block" required>
            {options === null ? (
              <Skeleton variant="text" width="60%" height={40} />
            ) : (
              <Select
                options={blockOptions ?? []}
                value={blockId}
                onChange={(event) => setBlockId(event.target.value)}
                placeholder="Choose the block"
              />
            )}
          </Field>
          <Field label="Unit label" required hint="Its number — 402, B-12, whatever residents say.">
            <Input
              value={unitLabel}
              onChange={(event) => setUnitLabel(event.target.value)}
              placeholder="402"
            />
          </Field>
          <Field label="Type" required>
            <Select
              options={UNIT_TYPE_OPTIONS}
              value={unitType}
              onChange={(event) => setUnitType(event.target.value)}
              placeholder="Choose the type"
            />
          </Field>
          <Field label="Monthly charge (rupees)" required>
            <Input
              inputMode="decimal"
              value={charge}
              onChange={(event) => setCharge(event.target.value)}
              placeholder="2500"
            />
          </Field>
          {unitError !== null ? (
            <p className="type-body text-critical" role="alert">
              {unitError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUnitOpen(false)}>
              Cancel
            </Button>
            <Button pending={unitPending} onClick={() => void createUnit()}>
              Add unit
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={editFor !== null}
        onClose={() => setEditFor(null)}
        title={
          editFor !== null ? `Edit ${editFor.blockName} ${editFor.unit.label}` : 'Edit a unit'
        }
        description="Changing the charge affects the next invoice run, not ones already raised."
      >
        <div className="space-y-4">
          <Field label="Type" hint="Leave blank to keep the current type.">
            <Select
              options={[{ value: '', label: 'Keep current' }, ...UNIT_TYPE_OPTIONS]}
              value={editType}
              onChange={(event) => setEditType(event.target.value)}
            />
          </Field>
          <Field label="Monthly charge (rupees)" required>
            <Input
              inputMode="decimal"
              value={editCharge}
              onChange={(event) => setEditCharge(event.target.value)}
              placeholder="2500"
            />
          </Field>
          <Field label="Active" hint="An inactive unit is not offered to new residents.">
            <div className="flex gap-2">
              <Button
                variant={editActive ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setEditActive(true)}
              >
                Active
              </Button>
              <Button
                variant={!editActive ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setEditActive(false)}
              >
                Inactive
              </Button>
            </div>
          </Field>
          {editError !== null ? (
            <p className="type-body text-critical" role="alert">
              {editError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditFor(null)}>
              Cancel
            </Button>
            <Button pending={editPending} onClick={() => void saveUnit()}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
