import { createHash } from "node:crypto";
import { DIFF_ALGORITHM_VERSION } from "./constants.js";

/**
 * Deterministic revision comparison.
 *
 * This module is the engineering record. It contains no I/O, no `ctx`, and no
 * LLM call, and it must stay that way: an LLM may *explain* a diff produced
 * here, but it may never produce one. See CLAUDE.md section 6.
 *
 * Given the same inputs this always returns identical output, including
 * ordering, which is what makes `inputFingerprint` meaningful as a cache key.
 */

export interface DiffInputValue {
  valueId: string;
  tag: string;
  attribute: string;
  valueText: string;
  valueNumeric?: number | null;
  unit?: string | null;
}

export interface DiffEntry {
  tag: string;
  attribute: string;
  fromValueId: string | null;
  toValueId: string | null;
  fromValueText: string | null;
  toValueText: string | null;
  fromUnit: string | null;
  toUnit: string | null;
  /** `to - from`, only when both sides are numeric AND share a unit. */
  numericDelta: number | null;
  unitChanged: boolean;
}

export interface RevisionDiff {
  algorithmVersion: number;
  inputFingerprint: string;
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  counts: { added: number; removed: number; changed: number; unchanged: number };
  summaryText: string;
}

export class DuplicateDiffKeyError extends Error {
  constructor(side: "from" | "to", key: string) {
    super(`Duplicate (tag, attribute) on the ${side} side: ${key}`);
    this.name = "DuplicateDiffKeyError";
  }
}

/** Separator that cannot occur inside a tag or attribute. */
const KEY_SEPARATOR = "\u0000";

/** Tags and attributes are compared case- and whitespace-insensitively. */
function normalizeKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeUnit(unit: string | null | undefined): string | null {
  const trimmed = (unit ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function keyOf(value: DiffInputValue): string {
  return `${normalizeKeyPart(value.tag)}${KEY_SEPARATOR}${normalizeKeyPart(value.attribute)}`;
}

function indexBySide(
  values: readonly DiffInputValue[],
  side: "from" | "to",
): Map<string, DiffInputValue> {
  const index = new Map<string, DiffInputValue>();
  for (const value of values) {
    const key = keyOf(value);
    if (index.has(key)) {
      // Silently keeping the last write would make the diff depend on input
      // order, which would make the fingerprint a lie.
      throw new DuplicateDiffKeyError(side, key.replace(KEY_SEPARATOR, "."));
    }
    index.set(key, value);
  }
  return index;
}

/**
 * Round to 9 decimal places before comparing, so values that differ only by
 * float representation (42 vs 42.0 vs 42.000000000000004) compare equal.
 */
function numericallyEqual(a: number, b: number): boolean {
  return a.toFixed(9) === b.toFixed(9);
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function entryFor(from: DiffInputValue | null, to: DiffInputValue | null): DiffEntry {
  const source = to ?? from;
  if (!source) throw new Error("entryFor requires at least one side");

  const fromUnit = from ? normalizeUnit(from.unit) : null;
  const toUnit = to ? normalizeUnit(to.unit) : null;
  const unitChanged = Boolean(from && to && fromUnit !== toUnit);

  let numericDelta: number | null = null;
  if (
    from &&
    to &&
    !unitChanged &&
    isFiniteNumber(from.valueNumeric) &&
    isFiniteNumber(to.valueNumeric)
  ) {
    numericDelta = to.valueNumeric - from.valueNumeric;
  }

  return {
    tag: source.tag.trim(),
    attribute: source.attribute.trim(),
    fromValueId: from?.valueId ?? null,
    toValueId: to?.valueId ?? null,
    fromValueText: from ? normalizeText(from.valueText) : null,
    toValueText: to ? normalizeText(to.valueText) : null,
    fromUnit,
    toUnit,
    numericDelta,
    unitChanged,
  };
}

function sameValue(from: DiffInputValue, to: DiffInputValue): boolean {
  const fromUnit = normalizeUnit(from.unit);
  const toUnit = normalizeUnit(to.unit);

  // A value expressed in a different unit is a change, full stop. Slice 1 does
  // not convert units - inventing a conversion factor here would be exactly the
  // fabricated engineering calculation the project rules prohibit.
  if (fromUnit !== toUnit) return false;

  const fromNumeric = isFiniteNumber(from.valueNumeric);
  const toNumeric = isFiniteNumber(to.valueNumeric);

  if (fromNumeric && toNumeric) {
    return numericallyEqual(from.valueNumeric as number, to.valueNumeric as number);
  }
  // Mixed numeric / non-numeric is a change; otherwise compare normalized text.
  if (fromNumeric !== toNumeric) return false;
  return normalizeText(from.valueText) === normalizeText(to.valueText);
}

function byTagThenAttribute(a: DiffEntry, b: DiffEntry): number {
  const tag = a.tag.localeCompare(b.tag, "en");
  if (tag !== 0) return tag;
  return a.attribute.localeCompare(b.attribute, "en");
}

function canonicalForFingerprint(values: readonly DiffInputValue[]): unknown[] {
  return [...values]
    .map((value) => ({
      k: keyOf(value),
      t: normalizeText(value.valueText),
      n: isFiniteNumber(value.valueNumeric) ? (value.valueNumeric as number).toFixed(9) : null,
      u: normalizeUnit(value.unit),
    }))
    .sort((a, b) => a.k.localeCompare(b.k, "en"));
}

function fingerprint(from: readonly DiffInputValue[], to: readonly DiffInputValue[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: DIFF_ALGORITHM_VERSION,
        from: canonicalForFingerprint(from),
        to: canonicalForFingerprint(to),
      }),
    )
    .digest("hex");
}

const SUMMARY_DETAIL_LIMIT = 5;

function describeChange(entry: DiffEntry): string {
  const from = [entry.fromValueText, entry.fromUnit].filter(Boolean).join(" ");
  const to = [entry.toValueText, entry.toUnit].filter(Boolean).join(" ");
  return `${entry.tag}.${entry.attribute} ${from} -> ${to}`;
}

/**
 * Compare two sets of extracted values.
 *
 * @throws DuplicateDiffKeyError if either side contains the same
 *         (tag, attribute) twice.
 */
export function diffRevisionValues(
  from: readonly DiffInputValue[],
  to: readonly DiffInputValue[],
): RevisionDiff {
  const fromIndex = indexBySide(from, "from");
  const toIndex = indexBySide(to, "to");

  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  let unchanged = 0;

  for (const [key, toValue] of toIndex) {
    const fromValue = fromIndex.get(key);
    if (!fromValue) {
      added.push(entryFor(null, toValue));
      continue;
    }
    if (sameValue(fromValue, toValue)) {
      unchanged += 1;
      continue;
    }
    changed.push(entryFor(fromValue, toValue));
  }

  for (const [key, fromValue] of fromIndex) {
    if (!toIndex.has(key)) removed.push(entryFor(fromValue, null));
  }

  added.sort(byTagThenAttribute);
  removed.sort(byTagThenAttribute);
  changed.sort(byTagThenAttribute);

  const counts = {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    unchanged,
  };

  const details = changed.slice(0, SUMMARY_DETAIL_LIMIT).map(describeChange);
  const overflow = changed.length - details.length;
  const summaryText = [
    `${counts.changed} changed, ${counts.added} added, ${counts.removed} removed (${counts.unchanged} unchanged).`,
    details.length > 0
      ? `Changed: ${details.join("; ")}${overflow > 0 ? `; +${overflow} more` : ""}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    algorithmVersion: DIFF_ALGORITHM_VERSION,
    inputFingerprint: fingerprint(from, to),
    added,
    removed,
    changed,
    counts,
    summaryText,
  };
}
