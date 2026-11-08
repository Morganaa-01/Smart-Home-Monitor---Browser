import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Report building can be tested without a browser or real sensor requests.
const context = vm.createContext({ window: {}, Intl, Date, TextEncoder, Uint8Array });
vm.runInContext(readFileSync(new URL("../public/measurement-report.js", import.meta.url), "utf8"), context);
const { buildReport, buildCharts, createPdf, fileName } = context.window.GreenhouseReport;

test("report contains all eight readings with units and recorded device states", () => {
  const report = buildReport({ created_at: "2026-11-01T11:00:00Z", field1: "22.5", field2: "0",
    field3: "1013.2", field4: "0", field5: "0", field6: "1", field7: "0", field8: "1" },
  new Date("2026-11-01T11:01:00Z"));
  assert.equal(report.rows.length, 8);
  assert.equal(report.rows[0].value, "22,5 °C");
  assert.equal(report.rows[1].value, "0 %");
  assert.equal(report.rows[2].value, "1013,2 hPa");
  assert.equal(report.rows[3].value, "0 lux");
  assert.equal(report.rows[4].value, "Nem jelez esőt");
  assert.equal(report.rows[5].value, "Bekapcsolva");
  assert.equal(report.rows[7].value, "Nyitva");
  assert.equal(report.status, "Friss mérés");
  assert.match(report.measuredAt, /12:00/);
});

test("missing measurements and invalid states are not reported as zero or off", () => {
  const report = buildReport({ field1: " ", field2: null, field3: "invalid", field5: "2" });
  assert.equal(report.status, "A mérés időpontja ismeretlen");
  assert.equal(report.rows[0].value, "Nincs adat");
  assert.equal(report.rows[1].value, "Nincs adat");
  assert.equal(report.rows[2].value, "Nincs adat");
  assert.equal(report.rows[4].value, "Ismeretlen állapot");
});

test("old data is marked and export does not mutate the source", () => {
  const entry = Object.freeze({ created_at: "2026-11-01T11:00:00Z", field1: "22" });
  assert.equal(buildReport(entry, new Date("2026-11-02T11:00:00Z")).status, "Régi mérés");
  assert.equal(entry.field1, "22");
  assert.throws(() => buildReport(null), /nincs exportálható/);
});

test("generated PDF has one page per image and correct cross-reference offsets", () => {
  const jpegs = [new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]), new Uint8Array([0xff, 0xd8, 0x09, 0xff, 0xd9])];
  const pdf = Buffer.from(createPdf(jpegs.map((jpeg) => ({ jpeg, width: 1240, height: 1754 }))));
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/Count 2 /);
  assert.match(text, /\/Kids \[3 0 R 6 0 R\]/);
  assert.match(text, /\/Length 7 >>/);
  assert.match(text, /\/Length 5 >>/);
  jpegs.forEach((jpeg) => assert.ok(pdf.includes(Buffer.from(jpeg))));
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  assert.match(text, /xref\n0 9\n/);
  assert.match(text, /\/Size 9 /);
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 8);
  offsets.forEach((offset, index) => assert.ok(text.startsWith(`${index + 1} 0 obj\n`, offset)));
});

test("chart series skip missing values, sort by time and keep on/off states", () => {
  const charts = buildCharts([
    { created_at: "2026-11-01T11:10:00Z", field1: "23", field6: "1" },
    { created_at: "2026-11-01T11:00:00Z", field1: "22", field6: "0" },
    { created_at: "2026-11-01T11:20:00Z", field1: null, field6: "" },
    { created_at: "invalid", field1: "99" }
  ]);
  assert.equal(charts.length, 8);
  assert.deepEqual(Array.from(charts[0].points, (p) => p.value), [22, 23]);
  assert.equal(charts[0].unit, "°C");
  assert.equal(charts[5].states[1], "Bekapcsolva");
  assert.deepEqual(Array.from(charts[5].points, (p) => p.value), [0, 1]);
  assert.equal(charts[2].points.length, 0);
  assert.equal(buildCharts(null).length, 8);
});

test("long history is thinned but keeps the extreme values", () => {
  const feeds = Array.from({ length: 5000 }, (_, i) => ({
    created_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
    field1: i === 2500 ? "80" : i === 4000 ? "-20" : "20"
  }));
  const { points } = buildCharts(feeds)[0];
  assert.ok(points.length <= 700);
  assert.ok(points.some((p) => p.value === 80));
  assert.ok(points.some((p) => p.value === -20));
});

test("PDF file name uses the measurement day in Budapest time", () => {
  assert.equal(fileName({ created_at: "2026-11-01T23:30:00Z" }), "noveny-haz-jelentes-2026-11-02.pdf");
  assert.equal(fileName({ created_at: "invalid" }), "noveny-haz-jelentes-ismeretlen-datum.pdf");
});
