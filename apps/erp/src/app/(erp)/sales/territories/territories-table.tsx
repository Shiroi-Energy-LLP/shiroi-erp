'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui';
import { Map, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  createTerritory,
  updateTerritory,
  deleteTerritory,
  toggleTerritoryActive,
  type TerritoryInput,
} from '@/lib/sales-territories-actions';
import {
  TERRITORY_SEGMENTS,
  TERRITORY_SEGMENT_LABELS,
  citiesToString,
  parseCities,
  type TerritorySegment,
} from '@/lib/sales-territories-constants';
import type { TerritoryWithAssignee } from '@/lib/sales-territories-queries';

// ── Props ─────────────────────────────────────────────────────────────────────

interface TerritoriesTableProps {
  territories: TerritoryWithAssignee[];
  employees: { id: string; full_name: string }[];
}

// ── Territory form dialog ─────────────────────────────────────────────────────

interface TerritoryFormDialogProps {
  mode: 'add' | 'edit';
  territory?: TerritoryWithAssignee;
  employees: { id: string; full_name: string }[];
  trigger: React.ReactNode;
  onDone?: () => void;
}

function TerritoryFormDialog({
  mode,
  territory,
  employees,
  trigger,
}: TerritoryFormDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(territory?.territory_name ?? '');
  const [cities, setCities] = React.useState(
    territory ? citiesToString(territory.cities) : '',
  );
  const [segment, setSegment] = React.useState<string>(territory?.segment ?? '');
  const [assigneeId, setAssigneeId] = React.useState<string>(
    territory?.default_assignee_employee_id ?? '',
  );
  const [active, setActive] = React.useState(territory?.active ?? true);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName(territory?.territory_name ?? '');
      setCities(territory ? citiesToString(territory.cities) : '');
      setSegment(territory?.segment ?? '');
      setAssigneeId(territory?.default_assignee_employee_id ?? '');
      setActive(territory?.active ?? true);
      setErrorMsg('');
    }
  }, [open, territory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const input: TerritoryInput = {
      territory_name: name,
      cities,
      segment: segment || null,
      default_assignee_employee_id: assigneeId || null,
      active,
    };

    const result =
      mode === 'add'
        ? await createTerritory(input)
        : await updateTerritory(territory!.id, input);

    setLoading(false);

    if (!result.success) {
      setErrorMsg(result.error);
      return;
    }

    setOpen(false);
  }

  const title = mode === 'add' ? 'Add Territory' : 'Edit Territory';
  const cityCount = parseCities(cities).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Territory definitions drive AI lead routing. City names are stored in lowercase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Territory name */}
          <div className="space-y-1.5">
            <Label htmlFor="terr-name">Territory name</Label>
            <Input
              id="terr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chennai South"
              required
              disabled={loading}
            />
          </div>

          {/* Cities */}
          <div className="space-y-1.5">
            <Label htmlFor="terr-cities">
              Cities{' '}
              <span className="text-n-400 font-normal text-xs">
                (comma-separated — {cityCount > 0 ? `${cityCount} cities` : 'none'})
              </span>
            </Label>
            <Input
              id="terr-cities"
              value={cities}
              onChange={(e) => setCities(e.target.value)}
              placeholder="chennai, tambaram, velachery, adyar"
              required
              disabled={loading}
            />
          </div>

          {/* Segment */}
          <div className="space-y-1.5">
            <Label htmlFor="terr-segment">Segment filter</Label>
            <Select
              id="terr-segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              disabled={loading}
            >
              {TERRITORY_SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Assignee */}
          <div className="space-y-1.5">
            <Label htmlFor="terr-assignee">Default assignee</Label>
            <Select
              id="terr-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={loading}
            >
              <option value="">— No assignee (fallback routing) —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </Select>
          </div>

          {/* Active toggle (only shown on edit) */}
          {mode === 'edit' && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="terr-active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                disabled={loading}
                className="h-4 w-4 rounded border-n-300 text-brand-500 focus:ring-brand-500"
              />
              <Label htmlFor="terr-active" className="cursor-pointer">
                Active
              </Label>
            </div>
          )}

          {errorMsg && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : mode === 'add' ? 'Add territory' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm delete dialog ─────────────────────────────────────────────────────

function DeleteTerritoryButton({ territory }: { territory: TerritoryWithAssignee }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  async function handleDelete() {
    setLoading(true);
    setErrorMsg('');
    const result = await deleteTerritory(territory.id);
    setLoading(false);
    if (!result.success) {
      setErrorMsg(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 px-2">
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Deactivate {territory.territory_name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Deactivate territory?</DialogTitle>
          <DialogDescription>
            &ldquo;{territory.territory_name}&rdquo; will be marked inactive. New leads will no
            longer route to this territory. Existing lead assignments are preserved.
          </DialogDescription>
        </DialogHeader>
        {errorMsg && <p className="text-sm text-red-600 mt-2">{errorMsg}</p>}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle active button ──────────────────────────────────────────────────────

function ToggleActiveButton({ territory }: { territory: TerritoryWithAssignee }) {
  const [loading, setLoading] = React.useState(false);

  async function handleToggle() {
    setLoading(true);
    await toggleTerritoryActive(territory.id, territory.active);
    setLoading(false);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      disabled={loading}
      className="px-2"
      title={territory.active ? 'Deactivate' : 'Activate'}
    >
      <Power className="h-4 w-4" />
      <span className="sr-only">{territory.active ? 'Deactivate' : 'Activate'}</span>
    </Button>
  );
}

// ── City chips ────────────────────────────────────────────────────────────────

function CityChips({ cities }: { cities: string[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const SHOW = 4;

  if (cities.length === 0) return <span className="text-n-400 text-xs">—</span>;

  const visible = expanded ? cities : cities.slice(0, SHOW);
  const remaining = cities.length - SHOW;

  return (
    <div className="flex flex-wrap gap-1 max-w-xs">
      {visible.map((city) => (
        <span
          key={city}
          className="inline-block px-1.5 py-0.5 rounded bg-n-100 text-n-600 text-xs"
        >
          {city}
        </span>
      ))}
      {!expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-brand-600 hover:underline"
          type="button"
        >
          +{remaining} more
        </button>
      )}
      {expanded && cities.length > SHOW && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-brand-600 hover:underline"
          type="button"
        >
          show less
        </button>
      )}
    </div>
  );
}

// ── Main table component ──────────────────────────────────────────────────────

export function TerritoriesTable({ territories, employees }: TerritoriesTableProps) {
  return (
    <div className="space-y-4">
      {/* Header row with Add button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-n-500">
          {territories.length} {territories.length === 1 ? 'territory' : 'territories'}
          {' '}·{' '}
          {territories.filter((t) => t.active).length} active
        </p>
        <TerritoryFormDialog
          mode="add"
          employees={employees}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add territory
            </Button>
          }
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Territory</TableHead>
                <TableHead>Cities</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Default assignee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {territories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={<Map className="h-10 w-10" />}
                      title="No territories yet"
                      description="Add your first sales territory to enable AI lead routing."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                territories.map((t) => (
                  <TableRow
                    key={t.id}
                    className={t.active ? undefined : 'opacity-50'}
                  >
                    <TableCell className="font-medium">{t.territory_name}</TableCell>
                    <TableCell>
                      <CityChips cities={t.cities} />
                    </TableCell>
                    <TableCell>
                      {t.segment ? (
                        <Badge variant="outline" className="text-xs">
                          {TERRITORY_SEGMENT_LABELS[t.segment as TerritorySegment] ?? t.segment}
                        </Badge>
                      ) : (
                        <span className="text-n-400 text-xs">Any</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.assignee_name ?? (
                        <span className="text-n-400 italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.active ? 'default' : 'secondary'}>
                        {t.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <TerritoryFormDialog
                          mode="edit"
                          territory={t}
                          employees={employees}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-2"
                              title="Edit territory"
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit {t.territory_name}</span>
                            </Button>
                          }
                        />
                        <ToggleActiveButton territory={t} />
                        <DeleteTerritoryButton territory={t} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
