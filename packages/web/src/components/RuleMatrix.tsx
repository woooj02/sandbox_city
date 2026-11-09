import { plainName } from '../rulebook-names';
import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, ICellRendererParams, CellClassParams, ValueSetterParams } from 'ag-grid-community';
import { Policy, PRESETS, RULES } from '@sandbox-city/core';
import { gridTheme } from './Ledger';
import { useModal } from './useModal';

type Val = boolean | number;
interface Row { key: keyof Policy; label: string; kind: 'bool' | 'num'; min: number; max: number; step: number; blurb: string; yours: Val; [preset: string]: unknown }

const fmt = (v: unknown, kind: string) => kind === 'bool' ? (v ? '● on' : '· off') : (v as number) === 0 ? '· off' : Number.isInteger(v) ? String(v) : (v as number).toFixed(2);
const Cell = (p: ICellRendererParams<Row>) => <span className={(p.data && (p.data.kind === 'bool' ? p.value : p.value > 0)) ? 'rm-on' : 'rm-off'}>{p.data ? fmt(p.value, p.data.kind) : ''}</span>;
const snap = (r: Row, v: number) => Math.min(r.max, Math.max(r.min, Math.round(v / r.step) * r.step));

/**
 * Every rule as a row, every preset as a column, your rulebook as the one editable column.
 * Edits write straight into the draft rulebook; preset cells that differ from yours are lit, so the grid doubles as a diff.
 */
export function RuleMatrix({ policy, onChange, onApply, onClose, dirty }: {
  policy: Policy; onChange: (p: Partial<Policy>) => void; onApply: () => void; onClose: () => void; dirty: boolean;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const panel = useModal<HTMLDivElement>(true, onClose);

  const rows = useMemo<Row[]>(() => RULES.map((r) => ({
    key: r.key, label: r.label, kind: r.kind, min: r.min ?? 0, max: r.max ?? 1, step: r.step ?? 1, blurb: r.blurb,
    yours: policy[r.key] as Val, ...Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p[r.key]])),
  })), [policy]);

  const cols = useMemo<ColDef<Row>[]>(() => [
    { field: 'label', headerName: 'RULE', pinned: 'left', width: 250, tooltipField: 'blurb', cellClass: 'rm-label' },
    {
      field: 'yours', headerName: `YOURS · ${plainName(policy.name)}`, width: 150, editable: true, singleClickEdit: true, cellDataType: false,
      cellRenderer: Cell, cellClass: 'rm-yours', headerClass: 'rm-yours-h',
      cellEditorSelector: (p) => p.data?.kind === 'bool'
        ? { component: 'agSelectCellEditor', params: { values: [true, false] } }
        : { component: 'agNumberCellEditor', params: { min: p.data?.min, max: p.data?.max, step: p.data?.step, precision: p.data && p.data.step < 1 ? 2 : 0 } },
      // the select editor labels its options with this; without it a boolean label crashes the list (the cell itself uses Cell)
      valueFormatter: (p) => (typeof p.value === 'boolean' ? (p.value ? 'on' : 'off') : String(p.value ?? '')),
      valueSetter: (p: ValueSetterParams<Row>) => {
        const r = p.data;
        const v = r.kind === 'bool' ? p.newValue === true || p.newValue === 'true' : snap(r, Number(p.newValue) || 0);
        if (v === r.yours) return false;
        change.current({ [r.key]: v } as Partial<Policy>);
        return true;
      },
    },
    ...Object.entries(PRESETS).map(([k, p]): ColDef<Row> => ({
      field: k, headerName: plainName(p.name).toUpperCase(), width: 128, cellRenderer: Cell,
      cellClassRules: { 'rm-diff': (c: CellClassParams<Row>) => !!c.data && c.value !== c.data.yours },
    })),
  ], [policy.name]);

  return createPortal(
    <div className="report-wrap" onClick={onClose}>
      <div className="report panel rule-matrix" ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rule matrix">
        <div className="report-head">
          <div className="glyph">⊞</div>
          <div>
            <h2>RULE MATRIX</h2>
            <p>Every rule against every preset. Click a cell in YOURS to edit it; lit cells are where a preset disagrees with you.</p>
          </div>
        </div>
        <div className="rm-grid">
          <AgGridReact<Row>
            theme={gridTheme}
            rowData={rows}
            columnDefs={cols}
            getRowId={(p) => p.data.key}
            stopEditingWhenCellsLoseFocus
            domLayout="autoHeight"
            tooltipShowDelay={300}
            defaultColDef={{ sortable: false, resizable: true, suppressMovable: true, enableCellChangeFlash: true }}
          />
        </div>
        <div className="report-foot">
          <button className={`btn apply ${dirty ? 'hot' : ''}`} onClick={() => { onApply(); onClose(); }}>{dirty ? '⟳ REPLAY WITH THESE RULES' : '⟳ REPLAY'}</button>
          <button className="btn" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
