import type { DeckButton, DeckPage, DeckPlacement, DeckWidget, DeckWidgetArea, DeckWidgetPage } from './connection';

type PlacedItem = { id: string; placement?: DeckPlacement };

export function buttonPlacement(page: DeckPage, button: DeckButton, index = page.buttons.findIndex((item) => item.id === button.id)): DeckPlacement {
  if (button.placement) return button.placement;
  const columns = page.columns ?? 3;
  return { row: Math.floor(index / columns), column: index % columns, rowSpan: 1, columnSpan: 1 };
}

function validLayout(rows: number, columns: number, items: PlacedItem[], allowRowMajorFallback = false): boolean {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || items.length > rows * columns) return false;
  const occupied = new Set<number>();
  for (const [index, item] of items.entries()) {
    const placement = item.placement ?? (allowRowMajorFallback ? { row: Math.floor(index / columns), column: index % columns, rowSpan: 1, columnSpan: 1 } : undefined);
    if (!placement || ![placement.row, placement.column, placement.rowSpan, placement.columnSpan].every(Number.isInteger) ||
        placement.row < 0 || placement.column < 0 || placement.rowSpan < 1 || placement.columnSpan < 1 ||
        placement.row + placement.rowSpan > rows || placement.column + placement.columnSpan > columns) return false;
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) {
        const cell = row * columns + column;
        if (occupied.has(cell)) return false;
        occupied.add(cell);
      }
    }
  }
  return true;
}

export function validDeckPageLayout(page: DeckPage): boolean {
  if (page.rows === 0 && page.columns === 0) return page.buttons.length === 0;
  const columns = page.columns ?? 3;
  const rows = page.rows ?? Math.max(1, Math.ceil(page.buttons.length / columns));
  return validLayout(rows, columns, page.buttons, true);
}

export function validDeckWidgetAreaLayout(area: DeckWidgetArea): boolean {
  return area.pages.every((page) => validLayout(area.rows, area.columns, [...page.buttons, ...page.widgets], true));
}

export function deckOccupancy(page: DeckPage): Map<number, DeckButton> {
  const occupied = new Map<number, DeckButton>();
  page.buttons.forEach((button, index) => {
    const placement = buttonPlacement(page, button, index);
    const columns = page.columns ?? 3;
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) occupied.set(row * columns + column, button);
    }
  });
  return occupied;
}

export type WidgetScreenItem = { type: 'button'; button: DeckButton } | { type: 'widget'; widget: DeckWidget };

export function widgetPageOccupancy(area: DeckWidgetArea, page: DeckWidgetPage): Map<number, WidgetScreenItem> {
  const occupied = new Map<number, WidgetScreenItem>();
  const deckPage: DeckPage = { id: page.id, name: page.name, rows: area.rows, columns: area.columns, buttons: page.buttons };
  page.buttons.forEach((button, index) => {
    const placement = buttonPlacement(deckPage, button, index);
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) occupied.set(row * area.columns + column, { type: 'button', button });
    }
  });
  for (const widget of page.widgets) {
    const { placement } = widget;
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) occupied.set(row * area.columns + column, { type: 'widget', widget });
    }
  }
  return occupied;
}
