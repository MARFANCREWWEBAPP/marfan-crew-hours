const fs = require("node:fs");

const originalFetch = globalThis.fetch;
const logPath = process.env.MOCK_GOOGLE_FETCH_LOG;
const foundUidByEventId = new Map();

function record(entry) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function parsePayload(init) {
  if (!init?.body) return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

globalThis.fetch = async function mockGoogleFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const method = String(init?.method || "GET").toUpperCase();

  if (url.startsWith("https://oauth2.test/token")) {
    record({ kind: "token", method, url });
    return jsonResponse({ access_token: "mock-google-access-token", expires_in: 3600 });
  }

  if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
    const parsed = new URL(url);
    const payload = parsePayload(init);
	    record({
	      kind: "calendar",
	      method,
	      url,
	      summary: payload.summary || "",
	      location: payload.location || "",
	      description: payload.description || "",
	      private: payload.extendedProperties?.private || {}
	    });

    if (method === "GET") {
      const iCalUID = parsed.searchParams.get("iCalUID");
      if (!iCalUID) {
        return jsonResponse({
          items: [{
            id: "oauth_api_event",
            iCalUID: "oauth-api-event@example.com",
            summary: "Evento OAuth API",
            location: "Recinto OAuth API, Malaga",
            description: "Leido desde Google con OAuth",
            start: { dateTime: "2026-07-03T09:00:00+02:00" },
            end: { dateTime: "2026-07-03T11:00:00+02:00" },
            htmlLink: "https://calendar.google.com/calendar/event?eid=oauth_api_event"
          }]
        });
      }
      const eventId = `found_${Buffer.from(iCalUID).toString("base64url").slice(0, 24)}`;
      foundUidByEventId.set(eventId, iCalUID);
      return jsonResponse({
        items: [{
          id: eventId,
          iCalUID,
          htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`
        }]
      });
    }

    if (method === "POST") {
      const marfanId = payload.extendedProperties?.private?.marfan_event_id || "event";
      const eventId = `mock_${marfanId}`;
      return jsonResponse({
        id: eventId,
        iCalUID: `${eventId}@marfan.test`,
        htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`
      });
    }

    if (method === "PATCH") {
      const eventId = decodeURIComponent(parsed.pathname.split("/").pop() || "patched_event");
      return jsonResponse({
        id: eventId,
        iCalUID: foundUidByEventId.get(eventId) || `${eventId}@marfan.test`,
        htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`
      });
    }

    return jsonResponse({ ok: true });
  }

  return originalFetch(input, init);
};
