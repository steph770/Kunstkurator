// Kunstkurator-Vermittler zwischen Begleitapp und E-Ink-Rahmen.
//
//   GET  /bild     Der Rahmen holt hier sein nächstes Bild (Auto-Rotate-URL).
//                  Liegt ein Wunsch vor, kommt dieser, sonst ein zufälliger Ausschnitt.
//   GET  /status   Die App fragt, was gerade am Rahmen hängt, was als Nächstes kommt und wie voll der Akku ist.
//   POST /wunsch   Die App legt das nächste Bild fest: {"id": "GL11", "pin": "..."}; {"id": null} löscht den Wunsch.
//
// Der Zustand liegt in einem einzigen Durable Object (kleiner Speicher mit garantierter Reihenfolge),
// damit ein gerade gesetzter Wunsch beim nächsten Tastendruck sicher ankommt.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const stub = env.RAHMEN.get(env.RAHMEN.idFromName("rahmen"));

    if (url.pathname === "/bild" && request.method === "GET") {
      const liste = await ausschnitte(env);
      if (!liste.length) return new Response("Keine Ausschnitte gefunden", { status: 503 });
      const ids = liste.map(a => a.id);
      const zufall = liste.filter(a => !a.test).map(a => a.id);
      const akku = request.headers.get("X-Battery-Percentage");
      const geraet = {};
      for (const [h, k] of [["X-Processing-Settings", "processing"], ["X-Color-Palette", "palette"],
                            ["X-Display-Width", "breite"], ["X-Display-Height", "hoehe"],
                            ["X-Display-Orientation", "ausrichtung"], ["X-Firmware-Version", "firmware"]]) {
        const v = request.headers.get(h);
        if (v !== null) { try { geraet[k] = JSON.parse(v); } catch { geraet[k] = v; } }
      }
      const wahl = await (await stub.fetch("https://do/naechstes", {
        method: "POST",
        body: JSON.stringify({ ids, zufall, akku: akku === null ? null : Number(akku), geraet }),
      })).json();
      const eintrag = liste.find(a => a.id === wahl.id) || {};
      const bmp = eintrag.format === "bmp";
      const bild = await fetch(`${env.QUELLE}/img/rahmen/${wahl.id}.${bmp ? "bmp" : "jpg"}?v=${env.BILD_VERSION || "1"}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!bild.ok) return new Response("Bild nicht erreichbar", { status: 502 });
      return new Response(bild.body, {
        headers: {
          "Content-Type": bmp ? "image/bmp" : "image/jpeg",
          "Cache-Control": "no-store",
          "X-Kunstkurator-Id": wahl.id,
        },
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return json(await (await stub.fetch("https://do/status")).json());
    }

    if (url.pathname === "/wunsch" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ fehler: "Ungültige Anfrage" }, 400); }
      if (!env.RAHMEN_PIN || String(body.pin || "") !== String(env.RAHMEN_PIN)) return json({ fehler: "PIN falsch" }, 403);
      if (body.id !== null) {
        const ids = await ausschnittIds(env);
        if (!ids.includes(body.id)) return json({ fehler: "Unbekannter Ausschnitt" }, 400);
      }
      return json(await (await stub.fetch("https://do/wunsch", { method: "POST", body: JSON.stringify({ id: body.id }) })).json());
    }

    if (url.pathname === "/") return json({ dienst: "Kunstkurator", wege: ["/bild", "/status", "/wunsch"] });
    return json({ fehler: "Nicht gefunden" }, 404);
  },
};

async function ausschnitte(env) {
  const r = await fetch(`${env.QUELLE}/data/ausschnitte.json`, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) return [];
  return r.json();
}

async function ausschnittIds(env) {
  return (await ausschnitte(env)).map(a => a.id);
}

export class Rahmen {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const s = (await this.storage.get("zustand")) || { aktuell: null, wunsch: null, akku: null, verlauf: [] };

    if (url.pathname === "/status") return Response.json(s);

    if (url.pathname === "/wunsch") {
      const { id } = await request.json();
      s.wunsch = id ? { id, seit: new Date().toISOString() } : null;
      await this.storage.put("zustand", s);
      return Response.json(s);
    }

    if (url.pathname === "/naechstes") {
      const { ids, zufall, akku, geraet } = await request.json();
      let id;
      if (s.wunsch && ids.includes(s.wunsch.id)) {
        id = s.wunsch.id;
      } else {
        // Zufall, aber die letzten Bilder auslassen, solange genug übrig bleiben
        const basis = zufall && zufall.length ? zufall : ids;
        const zuletzt = new Set(s.verlauf.slice(0, Math.min(10, Math.floor(basis.length / 2))).map(v => v.id));
        const pool = basis.filter(x => !zuletzt.has(x));
        const auswahl = pool.length ? pool : basis;
        id = auswahl[Math.floor(Math.random() * auswahl.length)];
      }
      const jetzt = new Date().toISOString();
      s.aktuell = { id, seit: jetzt, gewuenscht: !!(s.wunsch && s.wunsch.id === id) };
      s.wunsch = null;
      if (akku !== null && !Number.isNaN(akku)) s.akku = { prozent: akku, stand: jetzt };
      if (geraet && Object.keys(geraet).length) s.geraet = { ...geraet, stand: jetzt };
      s.verlauf = [{ id, zeit: jetzt }, ...(s.verlauf || [])].slice(0, 30);
      await this.storage.put("zustand", s);
      return Response.json({ id });
    }

    return new Response("?", { status: 404 });
  }
}
