import { addMoney } from "./money";

/** Domain-level total used after add, edit, remove, bundle and add-on changes. */
export function serviceBillTotal(lines: ReadonlyArray<{ billPrice: number }>): number {
  return addMoney(...lines.map((line) => line.billPrice));
}
