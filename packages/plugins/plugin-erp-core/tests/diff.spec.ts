import { describe, expect, it } from "vitest";
import {
  diffRevisionValues,
  DuplicateDiffKeyError,
  type DiffInputValue,
} from "../src/erp/diff.js";
import { DIFF_ALGORITHM_VERSION } from "../src/constants.js";

function value(
  valueId: string,
  tag: string,
  attribute: string,
  valueText: string,
  extra: Partial<DiffInputValue> = {},
): DiffInputValue {
  return { valueId, tag, attribute, valueText, ...extra };
}

describe("diffRevisionValues", () => {
  it("classifies added, removed, changed and unchanged", () => {
    const from = [
      value("f1", "FV-1042", "design_pressure", "42", { valueNumeric: 42, unit: "bar" }),
      value("f2", "FV-1042", "body_material", "CS"),
      value("f3", "PT-2001", "range_max", "100", { valueNumeric: 100, unit: "bar" }),
    ];
    const to = [
      value("t1", "FV-1042", "design_pressure", "55", { valueNumeric: 55, unit: "bar" }),
      value("t2", "FV-1042", "body_material", "CS"),
      value("t4", "FV-1042", "actuator_type", "pneumatic"),
    ];

    const diff = diffRevisionValues(from, to);

    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(diff.changed[0]).toMatchObject({
      tag: "FV-1042",
      attribute: "design_pressure",
      fromValueText: "42",
      toValueText: "55",
      numericDelta: 13,
      unitChanged: false,
    });
    expect(diff.added[0]).toMatchObject({ attribute: "actuator_type", fromValueId: null });
    expect(diff.removed[0]).toMatchObject({ tag: "PT-2001", toValueId: null });
  });

  it("treats values equal across numeric formatting", () => {
    const diff = diffRevisionValues(
      [value("f", "FV-1", "p", "42", { valueNumeric: 42, unit: "bar" })],
      [value("t", "FV-1", "p", "42.000", { valueNumeric: 42.0, unit: "bar" })],
    );
    expect(diff.counts.unchanged).toBe(1);
    expect(diff.counts.changed).toBe(0);
  });

  it("normalises tag and attribute case and whitespace when matching", () => {
    const diff = diffRevisionValues(
      [value("f", " fv-1042 ", "Design  Pressure", "42", { valueNumeric: 42, unit: "bar" })],
      [value("t", "FV-1042", "design pressure", "42", { valueNumeric: 42, unit: "bar" })],
    );
    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });

  it("reports a unit change as changed with no numeric delta, and never converts units", () => {
    const diff = diffRevisionValues(
      [value("f", "FV-1", "p", "42", { valueNumeric: 42, unit: "bar" })],
      [value("t", "FV-1", "p", "4200", { valueNumeric: 4200, unit: "kPa" })],
    );

    expect(diff.counts.changed).toBe(1);
    const entry = diff.changed[0]!;
    expect(entry.unitChanged).toBe(true);
    // 42 bar and 4200 kPa are the same pressure. Slice 1 must NOT know that -
    // inventing a conversion factor is a fabricated engineering calculation.
    expect(entry.numericDelta).toBeNull();
    expect(entry.fromUnit).toBe("bar");
    expect(entry.toUnit).toBe("kPa");
  });

  it("treats a numeric value replaced by free text as changed", () => {
    const diff = diffRevisionValues(
      [value("f", "FV-1", "p", "42", { valueNumeric: 42, unit: "bar" })],
      [value("t", "FV-1", "p", "TBC", { valueNumeric: null, unit: "bar" })],
    );
    expect(diff.counts.changed).toBe(1);
    expect(diff.changed[0]!.numericDelta).toBeNull();
  });

  it("is deterministic - identical inputs in any order give identical output", () => {
    const from = [
      value("f1", "ZV-9", "a", "1", { valueNumeric: 1 }),
      value("f2", "AV-1", "b", "2", { valueNumeric: 2 }),
      value("f3", "MV-5", "c", "3", { valueNumeric: 3 }),
    ];
    const to = [
      value("t1", "AV-1", "b", "20", { valueNumeric: 20 }),
      value("t2", "MV-5", "c", "3", { valueNumeric: 3 }),
      value("t3", "ZV-9", "a", "10", { valueNumeric: 10 }),
    ];

    const baseline = diffRevisionValues(from, to);
    const shuffled = diffRevisionValues([...from].reverse(), [...to].reverse());

    // Same inputs, different insertion order: fingerprint, ordering and text
    // must all match, or the fingerprint is not a usable cache key.
    expect(shuffled.inputFingerprint).toBe(baseline.inputFingerprint);
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(baseline));
    expect(baseline.changed.map((entry) => entry.tag)).toEqual(["AV-1", "ZV-9"]);
  });

  it("changes the fingerprint when any input value changes", () => {
    const from = [value("f", "FV-1", "p", "42", { valueNumeric: 42, unit: "bar" })];
    const a = diffRevisionValues(from, [
      value("t", "FV-1", "p", "43", { valueNumeric: 43, unit: "bar" }),
    ]);
    const b = diffRevisionValues(from, [
      value("t", "FV-1", "p", "44", { valueNumeric: 44, unit: "bar" }),
    ]);
    expect(a.inputFingerprint).not.toBe(b.inputFingerprint);
  });

  it("ignores value ids when fingerprinting, since they are not engineering content", () => {
    const a = diffRevisionValues(
      [value("id-a", "FV-1", "p", "42", { valueNumeric: 42 })],
      [value("id-b", "FV-1", "p", "43", { valueNumeric: 43 })],
    );
    const b = diffRevisionValues(
      [value("id-c", "FV-1", "p", "42", { valueNumeric: 42 })],
      [value("id-d", "FV-1", "p", "43", { valueNumeric: 43 })],
    );
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
  });

  it("rejects duplicate (tag, attribute) rather than silently picking one", () => {
    const dup = [
      value("a", "FV-1", "p", "42", { valueNumeric: 42 }),
      value("b", "fv-1", "P", "43", { valueNumeric: 43 }),
    ];
    expect(() => diffRevisionValues(dup, [])).toThrow(DuplicateDiffKeyError);
    expect(() => diffRevisionValues([], dup)).toThrow(/on the to side/);
  });

  it("handles empty inputs", () => {
    const diff = diffRevisionValues([], []);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 0 });
    expect(diff.summaryText).toBe("0 changed, 0 added, 0 removed (0 unchanged).");
    expect(diff.algorithmVersion).toBe(DIFF_ALGORITHM_VERSION);
  });

  it("summarises the first five changes and counts the overflow", () => {
    const from = Array.from({ length: 8 }, (_, index) =>
      value(`f${index}`, `TAG-${index}`, "p", String(index), { valueNumeric: index, unit: "bar" }),
    );
    const to = Array.from({ length: 8 }, (_, index) =>
      value(`t${index}`, `TAG-${index}`, "p", String(index + 1), {
        valueNumeric: index + 1,
        unit: "bar",
      }),
    );

    const diff = diffRevisionValues(from, to);
    expect(diff.counts.changed).toBe(8);
    expect(diff.summaryText).toContain("8 changed, 0 added, 0 removed (0 unchanged).");
    expect(diff.summaryText).toContain("TAG-0.p 0 bar -> 1 bar");
    expect(diff.summaryText).toContain("+3 more");
  });

  it("scales to a large revision without losing determinism", () => {
    const from = Array.from({ length: 5000 }, (_, index) =>
      value(`f${index}`, `TAG-${index}`, "p", String(index), { valueNumeric: index, unit: "bar" }),
    );
    const to = from.map((entry, index) =>
      index % 2 === 0
        ? entry
        : value(`t${index}`, entry.tag, entry.attribute, String(index + 1), {
            valueNumeric: index + 1,
            unit: "bar",
          }),
    );

    const first = diffRevisionValues(from, to);
    const second = diffRevisionValues(from, to);
    expect(first.counts).toEqual({ added: 0, removed: 0, changed: 2500, unchanged: 2500 });
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
  });
});
