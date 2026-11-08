import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runGreenhouseTool } from "../api/lib/greenhouse-tools.js";
import { fetchThingSpeakFeeds } from "../api/lib/thingspeak.js";

// The data source is faked, so no API key is needed and no real measurement is changed.
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const history = (field = "field5", start = "2026-11-01", end = start) =>
  runGreenhouseTool("get_sensor_history", { field, start_date: start, end_date: end, hours: null });
function useFeeds(feeds) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ feeds }) });
}

test("15 active samples represent 450 estimated seconds, not thousands of minutes", async () => {
  const start = Date.parse("2026-11-01T11:00:00Z");
  const feeds = Array.from({ length: 16 }, (_, index) => ({
    created_at: new Date(start + index * 30_000).toISOString(),
    field5: index < 15 ? "1" : "0"
  }));
  useFeeds(feeds.reverse());
  const result = await history();
  const rain = result.fields.field5;
  assert.equal(rain.last_active_event.estimated_duration_seconds, 450);
  assert.equal(rain.last_active_event.active_samples, 15);
  assert.equal(rain.last_active_event.is_active_at_end, false);
  assert.equal(rain.first.recorded_at, "2026-11-01T11:00:00.000Z");
  assert.equal(rain.last.value, 0);
});

test("long gaps separate rain events", async () => {
  useFeeds([
    { created_at: "2026-11-01T11:00:00Z", field5: "1" },
    { created_at: "2026-11-01T11:10:00Z", field5: "1" }
  ]);
  const event = (await history()).fields.field5.last_active_event;
  assert.equal(event.active_samples, 1);
  assert.equal(event.estimated_duration_seconds, 30);
});

test("blank values are missing, but zero is a valid measurement", async () => {
  useFeeds([
    { created_at: "2026-11-01T11:00:00Z", field1: "   " },
    { created_at: "2026-11-01T11:00:30Z", field1: "0" }
  ]);
  const summary = (await history("field1")).fields.field1;
  assert.equal(summary.count, 1);
  assert.equal(summary.mean, 0);
});

test("invalid calendar dates are rejected before fetching", async () => {
  globalThis.fetch = async () => { assert.fail("Invalid date must not reach the API"); };
  await assert.rejects(history("field1", "2026-02-01", "2026-02-30"), /nem érvényes/);
  await assert.rejects(history("field1", "2026-02-01", "2026-13-01"), /nem érvényes/);
});

test("Budapest daylight-saving transition produces a 25-hour day", async () => {
  useFeeds([]);
  const result = await history("field1", "2026-10-25");
  assert.equal((Date.parse(result.end_utc) - Date.parse(result.start_utc)) / 3_600_000, 25);
});

test("malformed and null responses have a controlled error code", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError(); } });
  await assert.rejects(fetchThingSpeakFeeds(), { code: "invalid_thingspeak_response" });
  globalThis.fetch = async () => ({ ok: true, json: async () => null });
  await assert.rejects(fetchThingSpeakFeeds(), { code: "invalid_thingspeak_response" });
});
