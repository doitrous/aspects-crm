import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDelimited,
  autoMap,
  parseMoney,
  normalizeMethod,
  mapRow,
} from "./importMapping";

test("parseDelimited handles quoted commas and CRLF", () => {
  const csv = 'Lead ID,Service,Service Price\r\nL-1,"Botox, forehead","1,500"\r\nL-2,Filler,3000\r\n';
  const { headers, rows } = parseDelimited(csv);
  assert.deepEqual(headers, ["Lead ID", "Service", "Service Price"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["L-1", "Botox, forehead", "1,500"]);
});

test("parseDelimited auto-detects tab delimiter", () => {
  const tsv = "MRN\tService\tPrice\n123\tHydrafacial\t900\n";
  const { headers, rows } = parseDelimited(tsv);
  assert.deepEqual(headers, ["MRN", "Service", "Price"]);
  assert.deepEqual(rows[0], ["123", "Hydrafacial", "900"]);
});

test("autoMap maps EN + AR headers, order-independent", () => {
  const map = autoMap(["Service Price", "الاسم", "Payment Method", "Nonsense"]);
  assert.equal(map["Service Price"], "basePrice");
  assert.equal(map["الاسم"], "name");
  assert.equal(map["Payment Method"], "paymentMethod");
  assert.equal(map["Nonsense"], "");
});

test("parseMoney strips currency + separators and rejects junk", () => {
  assert.equal(parseMoney("1,500 EGP"), 1500);
  assert.equal(parseMoney("٬"), null);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("-200"), -200);
});

test("normalizeMethod maps free text (EN/AR) to enum", () => {
  assert.equal(normalizeMethod("Cash"), "cash");
  assert.equal(normalizeMethod("فيزا"), "visa");
  assert.equal(normalizeMethod("InstaPay"), "instapay");
  assert.equal(normalizeMethod("something"), "other");
  assert.equal(normalizeMethod(""), null);
});

test("mapRow resolves quoted from price-after-discount", () => {
  const headers = ["Lead ID", "Service Price", "Price After Discount"];
  const mapping = { "Lead ID": "leadId", "Service Price": "basePrice", "Price After Discount": "priceAfterDiscount" } as const;
  const r = mapRow(["L-1", "1000", "850"], headers, mapping, 0);
  assert.equal(r.basePrice, 1000);
  assert.equal(r.quotedPrice, 850);
  assert.equal(r.errors.length, 0);
});

test("mapRow computes quoted = base − discount when after-price absent", () => {
  const headers = ["MRN", "Service Price", "Discount"];
  const mapping = { MRN: "mrn", "Service Price": "basePrice", Discount: "discount" } as const;
  const r = mapRow(["555", "1000", "150"], headers, mapping, 0);
  assert.equal(r.quotedPrice, 850);
});

test("mapRow flags missing match key and missing price as errors", () => {
  const headers = ["Service Price"];
  const mapping = { "Service Price": "basePrice" } as const;
  const r = mapRow([""], headers, mapping, 0);
  assert.ok(r.errors.some((e) => /match key/i.test(e)));
  assert.ok(r.errors.some((e) => /service price/i.test(e)));
});
