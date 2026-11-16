import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_ID,
  applyLayoutDelta,
  parseLayoutXml,
  placeholderKey,
  primaryDevice,
  resolveLayout,
} from "../src/domain/layout.js";

const D = DEFAULT_DEVICE_ID;
const MOBILE = "{46D2F427-4CE5-4E1F-BA10-EF3636F43534}";
const L = "{14030E9F-CE92-49C6-AD87-7D49B50E42EA}";
const HERO = "{AAAAAAAA-0000-0000-0000-000000000001}";
const PROMO = "{AAAAAAAA-0000-0000-0000-000000000002}";
const CARD = "{AAAAAAAA-0000-0000-0000-000000000003}";
const u = (n: number) => `{00000000-0000-0000-0000-00000000000${n}}`;

const shared =
  `<?xml version="1.0"?><r xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
  `<d id="${D.toLowerCase()}" l="${L}">` +
  `<r uid="${u(1)}" id="${HERO}" ph="main" ds="${HERO.toLowerCase().replace(/[{}]/g, "")}" par="a=1&amp;b=x%20y" />` +
  `<!-- a comment --><r uid="${u(2)}" id="${PROMO}" ph="main" ds="">` +
  `<rls><ruleset /></rls></r>` +
  `</d><d id="${MOBILE}" l="${L}" /></r>`;

describe("parseLayoutXml", () => {
  it("parses devices, renderings, datasources and params", () => {
    const devices = parseLayoutXml(shared);
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ deviceId: D, layoutId: L });
    expect(devices[0]!.renderings).toEqual([
      { uid: u(1), renderingId: HERO, placeholder: "main", datasource: HERO, params: { a: "1", b: "x y" } },
      { uid: u(2), renderingId: PROMO, placeholder: "main", datasource: undefined, params: {} },
    ]);
    expect(devices[1]!.renderings).toEqual([]);
  });

  it("is tolerant of empty and malformed values", () => {
    expect(parseLayoutXml(undefined)).toEqual([]);
    expect(parseLayoutXml("")).toEqual([]);
    expect(parseLayoutXml("not xml")).toEqual([]);
    expect(parseLayoutXml(`<r><d id="${D}"><r uid="x" id="not-a-guid" /></d>`)).toEqual([
      { deviceId: D, layoutId: undefined, renderings: [] },
    ]);
  });
});

describe("applyLayoutDelta", () => {
  const base = parseLayoutXml(shared);

  it("deletes, inserts before/after, updates and appends", () => {
    const delta =
      `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${D}">` +
      `<r uid="${u(2)}" p:d="1" />` +
      `<r uid="${u(3)}" p:before="r[@uid='${u(1)}']" s:id="${CARD}" s:ph="main" />` +
      `<r uid="${u(1)}" s:ds="local:/Data/Hero" />` +
      `<r uid="${u(4)}" s:id="${PROMO}" s:ph="footer" s:par="x=1" />` +
      `<r uid="${u(5)}" p:after="r[@uid='${u(3)}']" s:id="${PROMO}" s:ph="main" />` +
      `</d></r>`;
    const [device] = applyLayoutDelta(base, delta);
    expect(device!.renderings.map((r) => [r.uid, r.renderingId, r.placeholder, r.datasource])).toEqual([
      [u(3), CARD, "main", undefined],
      [u(5), PROMO, "main", undefined],
      [u(1), HERO, "main", "local:/Data/Hero"],
      [u(4), PROMO, "footer", undefined],
    ]);
    // an updated rendering keeps the attributes the delta didn't touch
    expect(device!.renderings[2]!.params).toEqual({ a: "1", b: "x y" });
    // the shared layout is not mutated
    expect(base[0]!.renderings).toHaveLength(2);
  });

  it("can change the layout and add a device", () => {
    const L2 = "{BBBBBBBB-0000-0000-0000-000000000001}";
    const DEV2 = "{CCCCCCCC-0000-0000-0000-000000000001}";
    const delta =
      `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${D}" s:l="${L2}" />` +
      `<d id="${DEV2}"><r uid="${u(6)}" s:id="${HERO}" s:ph="x" /></d></r>`;
    const devices = applyLayoutDelta(base, delta);
    expect(devices[0]!.layoutId).toBe(L2);
    expect(devices.find((d) => d.deviceId === DEV2)!.renderings.map((r) => r.renderingId)).toEqual([HERO]);
  });

  it("treats a non-delta final value as a full replacement", () => {
    const full = `<r><d id="${D}" l="${L}"><r uid="${u(7)}" id="${CARD}" ph="body" /></d></r>`;
    expect(applyLayoutDelta(base, full)[0]!.renderings.map((r) => r.renderingId)).toEqual([CARD]);
  });
});

describe("resolveLayout", () => {
  it("reports where the layout came from", () => {
    expect(resolveLayout(undefined, undefined).source).toBe("none");
    expect(resolveLayout(`<r><d id="${D}" /></r>`, undefined).source).toBe("none");
    expect(resolveLayout(shared, undefined).source).toBe("shared");
    const final = resolveLayout(shared, `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${D}"><r uid="${u(1)}" p:d="1" /></d></r>`);
    expect(final.source).toBe("final");
    expect(primaryDevice(final)!.renderings.map((r) => r.uid)).toEqual([u(2)]);
  });

  it("falls back to the first used device when Default is empty", () => {
    const xml = `<r><d id="${D}" /><d id="${MOBILE}" l="${L}"><r uid="${u(1)}" id="${HERO}" ph="m" /></d></r>`;
    expect(primaryDevice(resolveLayout(xml, undefined))!.deviceId).toBe(MOBILE);
  });
});

describe("placeholderKey", () => {
  it.each([
    ["main", "main"],
    ["/main/centercolumn", "centercolumn"],
    ["/main/container-{11111111-2222-3333-4444-555555555555}-0", "container"],
    ["main_11111111-2222-3333-4444-555555555555", "main"],
    ["column-1-{11111111-2222-3333-4444-555555555555}", "column"],
  ])("%s -> %s", (input, expected) => {
    expect(placeholderKey(input)).toBe(expected);
  });
});
