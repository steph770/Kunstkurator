"use strict";
const app = document.getElementById("app");
const V = "?v=1";
const IV = id => "?v=" + ((D && D.info._ausschnitte && D.info._ausschnitte[id]) || "1");
let D = null; // {werke, ausschnitte, info, texte}
let filter = sessionStorage.getItem("kk-filter") || "alle";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const absatz = t => (Array.isArray(t) ? t : String(t || "").split(/\n\s*\n/))
  .filter(p => p.trim())
  .map(p => "<p>" + esc(p.trim()).replace(/\*([^*]+)\*/g, "<em>$1</em>") + "</p>").join("");

async function laden() {
  const get = n => fetch("data/" + n + V, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [werke, ausschnitte, info, texte, rahmen, kuenstler] = await Promise.all([
    get("werke.json"), get("ausschnitte.json"), get("bildinfo.json"), get("werktexte.json"), get("rahmen.json"), get("kuenstler.json")]);
  const alle = ausschnitte || [];
  D = { werke: werke || [], alle, ausschnitte: alle.filter(a => !a.test), tests: alle.filter(a => a.test), info: info || {}, texte: texte || {},
        vermittler: (rahmen && rahmen.vermittler || "").replace(/\/$/, ""), status: null };
  D.werkBy = Object.fromEntries(D.werke.map(w => [w.id, w]));
  D.kuenstler = kuenstler || [];
  D.kBy = Object.fromEntries(D.kuenstler.map(k => [k.id, k]));
  D.nummer = {};
  for (const w of D.werke) D.ausschnitte.filter(a => a.werk === w.id).forEach((a, i) => D.nummer[a.id] = i + 1);
}

// Rechteck eines Ausschnitts in Prozent des Gesamtbildes
function box(a) {
  const i = D.info[a.werk];
  const ratio = i ? i.breite / i.hoehe : 1.6;
  return { x: a.x * 100, y: a.y * 100, w: a.w * 100, h: a.w * ratio * 4 / 3 * 100 };
}

function werkZeile(w) {
  const k = w.kid && D.kBy[w.kid] ? `<a href="#/kuenstler/${w.kid}">${esc(w.kuenstler)}</a>` : esc(w.kuenstler);
  return `${k}, <a href="#/werk/${w.id}">${esc(w.titel)}</a>, ${esc(w.datierung)} · ${esc(w.museum)}, ${esc(w.ort)}`;
}

function kachel(a) {
  const w = D.werkBy[a.werk];
  return `<a class="kachel" href="#/a/${a.id}">
    <img loading="lazy" src="img/vorschau/${a.id}.jpg${IV(a.id)}" alt="">
    <div class="kachel-text"><div class="kachel-titel">${esc(a.titel)}</div>
    <div class="kachel-werk">${a.makro ? `<span class="makro-marke">Makro</span> ` : ""}${esc(w ? w.titel : "")}</div></div></a>`;
}


// ---------- Verbindung zum Rahmen über den Vermittler ----------
const seit = iso => {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
};
const titelVon = id => (D.alle.find(a => a.id === id) || {}).titel || id;

async function statusLaden() {
  if (!D.vermittler) return;
  try {
    const r = await fetch(D.vermittler + "/status", { cache: "no-store" });
    if (r.ok) D.status = await r.json();
  } catch { /* offline: alten Stand behalten */ }
}

// Reihenfolge wie im Vermittler: Gemälde wie in werke.json, darin die Stationen
function reihe() { return D.werke.flatMap(w => stationen(w.id)).map(a => a.id); }
function naechsterAmRahmen() {
  const s = D.status || {};
  if (s.wunsch) return { id: s.wunsch.id, wunsch: true };
  if ((s.modus || "reihe") !== "reihe") return null;
  const r = reihe(), anker = (s.verlauf || []).map(v => v.id).find(x => r.includes(x));
  return { id: anker ? r[(r.indexOf(anker) + 1) % r.length] : r[0], wunsch: false };
}

async function modusSetzen(modus) {
  const pin = pinHolen(); if (!pin) return false;
  try {
    const r = await fetch(D.vermittler + "/modus", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modus, pin }) });
    if (r.status === 403) { localStorage.removeItem("kk-pin"); alert("Die PIN stimmt nicht."); return false; }
    if (!r.ok) { alert("Das hat nicht geklappt."); return false; }
    localStorage.setItem("kk-pin", pin);
    D.status = await r.json();
    return true;
  } catch { alert("Der Rahmen-Vermittler ist gerade nicht erreichbar."); return false; }
}

function pinHolen() {
  return localStorage.getItem("kk-pin") || prompt("PIN für den Rahmen (einmalig, wird auf diesem Gerät gespeichert):");
}

async function wunschSetzen(id) {
  let pin = localStorage.getItem("kk-pin");
  if (!pin) {
    pin = prompt("PIN für den Rahmen (einmalig, wird auf diesem Gerät gespeichert):");
    if (!pin) return false;
  }
  try {
    const r = await fetch(D.vermittler + "/wunsch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, pin }) });
    if (r.status === 403) { localStorage.removeItem("kk-pin"); alert("Die PIN stimmt nicht."); return false; }
    if (!r.ok) { alert("Das hat nicht geklappt."); return false; }
    localStorage.setItem("kk-pin", pin);
    D.status = await r.json();
    return true;
  } catch { alert("Der Rahmen-Vermittler ist gerade nicht erreichbar."); return false; }
}

function rahmenKnoepfe(root) {
  root.querySelectorAll("[data-wunsch-weg]").forEach(b => b.onclick = async e => {
    e.preventDefault(); if (await wunschSetzen(null)) aktualisieren();
  });
  root.querySelectorAll("[data-modus]").forEach(b => b.onclick = async e => {
    e.preventDefault(); b.disabled = true;
    if (await modusSetzen(b.dataset.modus)) aktualisieren(); else b.disabled = false;
  });
  root.querySelectorAll("[data-wunsch]").forEach(b => b.onclick = async e => {
    e.preventDefault(); b.disabled = true;
    if (await wunschSetzen(b.dataset.wunsch)) { b.textContent = "Kommt als Nächstes"; aktualisieren(); } else b.disabled = false;
  });
}

function gesamtbild(w, markierung, alle) {
  const marks = alle ? D.ausschnitte.filter(a => a.werk === w.id).map(a => {
    const b = box(a);
    return `<a class="marke-alle" href="#/a/${a.id}" title="${esc(a.titel)}" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"><span>${D.nummer[a.id]}</span></a>`;
  }).join("") : "";
  const m = markierung ? (b => `<div class="marke-rahmen" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"></div>`)(box(markierung)) : "";
  return `<div class="gesamt-scroll" data-ziel='${markierung ? JSON.stringify(box(markierung)) : ""}'>
    <div class="gesamt-innen"><img src="img/werke/${w.id}.jpg${V}" alt="${esc(w.titel)}">${m}${marks}</div></div>
    <div class="hinweis">Antippen vergrößert das Gemälde${markierung ? " und springt zur Stelle des Ausschnitts" : ""}.</div>`;
}

function zoomen(root) {
  root.querySelectorAll(".gesamt-scroll").forEach(s => {
    s.addEventListener("click", e => {
      if (e.target.closest("a")) return;
      const gross = s.classList.toggle("gross");
      if (!gross) return;
      requestAnimationFrame(() => {
        const inn = s.querySelector(".gesamt-innen");
        let cx, cy;
        if (s.dataset.ziel) {
          const b = JSON.parse(s.dataset.ziel);
          cx = (b.x + b.w / 2) / 100; cy = (b.y + b.h / 2) / 100;
        } else {
          const r = s.getBoundingClientRect();
          cx = (e.clientX - r.left) / r.width; cy = (e.clientY - r.top) / r.height;
        }
        s.scrollLeft = cx * inn.offsetWidth - s.clientWidth / 2;
        s.scrollTop = cy * inn.offsetHeight - s.clientHeight / 2;
      });
    });
  });
}

// ---------- Bühne: das ganze Gemälde, stufenlos zoombar ----------
let buehne = null; // {werk, viewer, el, aktiv}

function rechteck(a) {
  const i = D.info[a.werk];
  const r = i ? i.hoehe / i.breite : 0.75;
  return new OpenSeadragon.Rect(a.x, a.y * r, a.w, a.w * 4 / 3);
}

function buehneBauen(el, werkId, startId) {
  const fallback = () => {
    const w = D.werkBy[werkId];
    const a = D.alle.find(x => x.id === startId);
    el.classList.add("statisch");
    el.innerHTML = gesamtbild(w, a || null, !a);
    zoomen(el);
    buehne = null;
  };
  if (!window.OpenSeadragon) { fallback(); return; }
  const viewer = OpenSeadragon({
    element: el,
    tileSources: `kacheln/${werkId}.dzi`,
    showNavigationControl: false,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
    gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchRotate: false },
    maxZoomPixelRatio: 2.5,
    visibilityRatio: 0.5,
    animationTime: 1.1,
    springStiffness: 6.5,
    immediateRender: false,
    preserveImageSizeOnResize: true,
  });
  buehne = { werk: werkId, viewer, el, aktiv: startId };
  viewer.addHandler("open-failed", fallback);
  viewer.addHandler("open", () => {
    for (const a of D.ausschnitte.filter(x => x.werk === werkId)) {
      const m = document.createElement("div");
      m.className = "marke-alle" + (a.id === buehne.aktiv ? " aktiv" : "");
      m.dataset.id = a.id;
      m.title = a.titel;
      m.innerHTML = `<span>${D.nummer[a.id]}</span>`;
      viewer.addOverlay({ element: m, location: rechteck(a) });
      new OpenSeadragon.MouseTracker({ element: m, clickHandler: () => { location.hash = "#/a/" + a.id; } });
    }
    const a = D.alle.find(x => x.id === startId);
    if (a && a.test) {
      const m = document.createElement("div");
      m.className = "marke-alle aktiv marke-test";
      viewer.addOverlay({ element: m, location: rechteck(a) });
    }
    if (a) viewer.viewport.fitBounds(rechteck(a), true);
  });
}

function buehneZu(id) {
  if (!buehne) return;
  buehne.aktiv = id;
  buehne.el.querySelectorAll(".marke-alle").forEach(m => m.classList.toggle("aktiv", m.dataset.id === id));
  const a = D.alle.find(x => x.id === id);
  if (a && buehne.viewer.world.getItemCount()) buehne.viewer.viewport.fitBounds(rechteck(a));
}

function stationen(werkId) { return D.ausschnitte.filter(x => x.werk === werkId); }

function leiste(a) {
  if (a.test) return `<div class="buehne-leiste">
      <a class="knopf" href="#/info">‹ Zum Test</a>
      <button class="knopf" data-ganz>Ganzes Bild</button>
    </div>`;
  const st = stationen(a.werk), i = st.indexOf(a);
  const vor = st[(i - 1 + st.length) % st.length], nach = st[(i + 1) % st.length];
  return `<div class="buehne-leiste">
      <a class="knopf rund" href="#/a/${vor.id}" aria-label="Vorige Station">‹</a>
      <button class="knopf" data-ganz>Ganzes Bild</button>
      <span class="station leise klein">Station ${i + 1} von ${st.length}</span>
      <a class="knopf rund" href="#/a/${nach.id}" aria-label="Nächste Station">›</a>
    </div>`;
}

function detailText(a) {
  const w = D.werkBy[a.werk];
  return `
    <h1>${esc(a.titel)}</h1>
    <p class="werkzeile">${werkZeile(w)}${a.stelle ? "<br>" + esc(a.stelle) : ""}</p>
    ${rahmenAktion(a)}
    <div class="lesetext">${absatz(a.text)}</div>
    <div class="detail-fuss">
      <img src="img/vorschau/${a.id}.jpg${IV(a.id)}" alt="">
      <div class="klein leise">Ausschnitt für den Rahmen · Datei ${esc(a.id)}.png (bereits in die sechs Displayfarben umgerechnet)<br>
        <a class="knopf" href="img/rahmen/${a.id}.png" download="${a.id}.png">Bild laden</a>
        <a class="knopf" href="#/werk/${w.id}">Zum Gemälde</a></div>
    </div>`;
}

function leisteKnoepfe(root) {
  root.querySelectorAll("[data-ganz]").forEach(b => b.onclick = () => {
    if (!buehne) return;
    const vp = buehne.viewer.viewport;
    if (b.dataset.zustand === "ganz") {
      const a = D.alle.find(x => x.id === buehne.aktiv);
      if (a) vp.fitBounds(rechteck(a));
      b.dataset.zustand = ""; b.textContent = "Ganzes Bild";
    } else {
      vp.goHome();
      b.dataset.zustand = "ganz"; b.textContent = "Zum Ausschnitt";
    }
  });
}

function detail(id, keepScroll) {
  const a = D.alle.find(x => x.id === id);
  if (!a) return gemaeldeSeite();
  document.title = a.titel + " · Kunstkurator";
  const vorhanden = buehne && buehne.werk === a.werk && document.body.contains(buehne.el) && document.getElementById("detailtext");
  if (vorhanden) {
    document.getElementById("detailtext").innerHTML = detailText(a);
    document.getElementById("leiste").innerHTML = leiste(a);
    if (buehne.aktiv !== a.id) buehneZu(a.id);
  } else {
    if (buehne) { try { buehne.viewer.destroy(); } catch {} buehne = null; }
    app.innerHTML = `
      <div class="detail">
        <div class="buehne-spalte">
          <div class="buehne" id="buehne"></div>
          <div id="leiste">${leiste(a)}</div>
        </div>
        <div id="detailtext">${detailText(a)}</div>
      </div>`;
    buehneBauen(document.getElementById("buehne"), a.werk, a.id);
  }
  leisteKnoepfe(app);
  rahmenKnoepfe(app);
  if (!keepScroll && !vorhanden) window.scrollTo(0, 0);
}

function rahmenAktion(a) {
  if (!D.vermittler) return "";
  const s = D.status || {};
  if (s.aktuell && s.aktuell.id === a.id) return `<p class="hinweisbox">Hängt gerade am Rahmen (${seit(s.aktuell.seit)}).</p>`;
  if (s.wunsch && s.wunsch.id === a.id) return `<p class="hinweisbox">Kommt als Nächstes. Drück am Rahmen die rechte Taste.
      <button class="mini" data-wunsch-weg>Zurücknehmen</button></p>`;
  return `<p><button class="knopf gold" data-wunsch="${a.id}">Als Nächstes am Rahmen zeigen</button></p>`;
}

function werk(id) {
  const w = D.werkBy[id];
  if (!w) return gemaeldeSeite();
  document.title = w.titel + " · Kunstkurator";
  const quelle = D.info[id] && D.info[id].quelle;
  if (buehne) { try { buehne.viewer.destroy(); } catch {} buehne = null; }
  const st = stationen(id), erste = st[0];
  const k = w.kid && D.kBy[w.kid];
  app.innerHTML = `
    <p class="klein"><a class="zurueck" href="#/gemaelde">‹ Alle Gemälde</a></p>
    <h1>${esc(w.titel)}</h1>
    <p class="werkzeile">${k ? `<a href="#/kuenstler/${k.id}">${esc(w.kuenstler)}</a>` : esc(w.kuenstler)} · ${esc(w.datierung)} · ${esc(w.technik)}, ${esc(w.masse)}<br>${esc(w.museum)}, ${esc(w.ort)}</p>
    <div class="buehne breit" id="buehne"></div>
    <p class="hinweis">Mit zwei Fingern zoomen, eine nummerierte Station antippen für ihren Begleittext.</p>
    ${D.vermittler && erste ? `<p><button class="knopf gold" data-wunsch="${erste.id}">Dieses Gemälde am Rahmen zeigen</button>
      <span class="leise klein">Beginnt mit Station 1, dann der Reihe nach.</span></p>` : ""}
    <div class="lesetext" style="margin-top:1.4em">${absatz(D.texte[id])}</div>
    <h2>Die Ausschnitte</h2>
    <div class="raster">${st.map(kachel).join("")}</div>
    ${quelle ? `<p class="fuss"><a href="${esc(quelle)}" target="_blank" rel="noopener">Abbildung auf Wikimedia Commons</a> (gemeinfrei)</p>` : ""}`;
  rahmenKnoepfe(app);
  buehneBauen(document.getElementById("buehne"), id, null);
  window.scrollTo(0, 0);
}

// ---------- Untere Leiste ----------
function reiterSetzen(name) {
  document.querySelectorAll(".unten a").forEach(a => a.classList.toggle("aktiv", a.dataset.reiter === name));
}

const groesse = id => `img/rahmen/${id}.jpg${IV(id)}`;

// ---------- Im Rahmen ----------
function rahmenSeite() {
  document.title = "Im Rahmen · Kunstkurator";
  reiterSetzen("rahmen");
  if (!D.vermittler) { app.innerHTML = `<h1>Im Rahmen</h1><p class="leise">Die Verbindung zum Rahmen ist nicht eingerichtet.</p>`; return; }
  const s = D.status;
  const akku = s && s.akku ? `<span class="akku ${s.akku.prozent < 20 ? "niedrig" : ""}">Akku ${Math.round(s.akku.prozent)} %</span>` : "";
  const akt = s && s.aktuell && D.alle.find(a => a.id === s.aktuell.id);
  let oben;
  if (!s) oben = `<p class="leise">Rahmenstatus wird geladen …</p>`;
  else if (!akt) oben = `<p class="leise">Noch kein Bild über den Kurator geladen. ${akku}</p>`;
  else {
    const w = D.werkBy[akt.werk];
    oben = `
      <div class="buehnenbild">
        <a href="#/a/${akt.id}"><img src="${groesse(akt.id)}" alt="${esc(akt.titel)}"></a>
        <div class="buehnenbild-text">
          <div class="leise klein">Hängt seit ${seit(s.aktuell.seit).replace(/^vor /, "")} ${akku}</div>
          <h1>${esc(akt.titel)}</h1>
          <p class="werkzeile">${werkZeile(w)}${akt.stelle ? "<br>" + esc(akt.stelle) : ""}</p>
          <p><a class="knopf" href="#/a/${akt.id}">Im Gemälde zeigen</a></p>
          <div class="lesetext">${absatz(akt.text)}</div>
        </div>
      </div>`;
  }
  const zufall = s && s.modus === "zufall";
  app.innerHTML = `
    ${oben}
    <div class="infokasten">
      <strong>Ohne Wunsch kommt beim Tastendruck</strong>
      <div class="moduswahl">
        <button class="knopf ${zufall ? "" : "gold"}" data-modus="reihe">Der Reihe nach</button>
        <button class="knopf ${zufall ? "gold" : ""}" data-modus="zufall">Zufall</button>
      </div>
      <p class="leise klein">${zufall ? "Ein zufälliger Ausschnitt aus der ganzen Sammlung." : "Die nächste Station des Gemäldes, nach der letzten Station das nächste Gemälde."} Bild wechseln: rechte Taste am Rahmen kurz antippen und warten, bis das Bild aufgebaut ist.</p>
    </div>
    ${s && s.verlauf && s.verlauf.length > 1 ? `<h2>Zuletzt am Rahmen</h2>
      <div class="raster">${s.verlauf.slice(1, 9).map(v => D.alle.find(a => a.id === v.id)).filter(Boolean).map(kachel).join("")}</div>` : ""}
    <h2>Ohne Internet</h2>
    <p class="leise">Alle Bilder gibt es auch als ZIP mit 1200 × 1600 Pixeln, bereits für das Display umgerechnet, zum Hochladen über die Weboberfläche des Rahmens in ein Album.</p>
    <p><a class="knopf" href="download/rahmenbilder.zip" download>Alle ${D.ausschnitte.length} Bilder als ZIP</a></p>`;
  rahmenKnoepfe(app);
}

// ---------- Als Nächstes ----------
async function ueberspringen() {
  const r = reihe(), n = naechsterAmRahmen();
  const ziel = n ? r[(r.indexOf(n.id) + 1) % r.length] : r[Math.floor(Math.random() * r.length)];
  return wunschSetzen(ziel);
}

function naechstesSeite() {
  document.title = "Als Nächstes · Kunstkurator";
  reiterSetzen("naechstes");
  if (!D.vermittler) { app.innerHTML = `<h1>Als Nächstes</h1><p class="leise">Die Verbindung zum Rahmen ist nicht eingerichtet.</p>`; return; }
  if (!D.status) { app.innerHTML = `<h1>Als Nächstes</h1><p class="leise">Rahmenstatus wird geladen …</p>`; return; }
  const n = naechsterAmRahmen();
  const knoepfe = `<div class="knopfreihe">
      <button class="knopf" data-ueberspringen>Überspringen</button>
      <a class="knopf" href="#/gemaelde">Anderes wählen</a>
      ${n && n.wunsch ? `<button class="knopf" data-wunsch-weg>Zurücknehmen</button>` : ""}
    </div>`;
  if (!n) {
    app.innerHTML = `<h1>Als Nächstes</h1>
      <p class="leise">Der Rahmen steht auf Zufall. Welches Bild kommt, entscheidet sich erst beim Tastendruck.</p>${knoepfe}`;
  } else {
    const a = D.alle.find(x => x.id === n.id), w = D.werkBy[a.werk];
    app.innerHTML = `
      <div class="buehnenbild">
        <a href="#/a/${a.id}"><img src="${groesse(a.id)}" alt="${esc(a.titel)}"></a>
        <div class="buehnenbild-text">
          <div class="leise klein">${n.wunsch ? "Ausgewählt" : "Nächste Station in der Reihenfolge"} · kommt beim nächsten Tastendruck</div>
          <h1>${esc(a.titel)}</h1>
          <p class="werkzeile">${werkZeile(w)}${a.stelle ? "<br>" + esc(a.stelle) : ""}</p>
          ${knoepfe}
          <div class="lesetext">${absatz(a.text)}</div>
        </div>
      </div>`;
  }
  rahmenKnoepfe(app);
  app.querySelectorAll("[data-ueberspringen]").forEach(b => b.onclick = async () => {
    b.disabled = true; if (await ueberspringen()) naechstesSeite(); else b.disabled = false;
  });
}

// ---------- Gemälde ----------
function werkKarte(w) {
  const n = stationen(w.id).length;
  return `<a class="werkkarte" href="#/werk/${w.id}"><img loading="lazy" src="img/werke/${w.id}.jpg${V}" alt="">
    <div><strong>${esc(w.titel)}</strong><span class="leise klein">${esc(w.kuenstler)} · ${esc(w.datierung)}<br>${n} Ausschnitte</span></div></a>`;
}

function gemaeldeSeite() {
  document.title = "Gemälde · Kunstkurator";
  reiterSetzen("gemaelde");
  const liste = [...D.werke].filter(w => stationen(w.id).length).sort((a, b) => (a.jahr || 0) - (b.jahr || 0));
  app.innerHTML = `<h1>Gemälde</h1>
    <p class="leise">${liste.length} Gemälde von ${(liste[0] || {}).jahr} bis ${(liste[liste.length - 1] || {}).jahr}, mit ${D.ausschnitte.length} Ausschnitten für den Rahmen.</p>
    <div class="werke">${liste.map(werkKarte).join("")}</div>
    <p class="fuss">Alle Abbildungen gemeinfrei, Quelle: Wikimedia Commons.</p>`;
}

// ---------- Künstler ----------
function kuenstlerBild(k, klasse) {
  return `<img class="${klasse}" src="img/kuenstler/${k.id}.jpg${V}" alt="" onerror="this.remove()">`;
}

function kuenstlerListe() {
  document.title = "Künstler · Kunstkurator";
  reiterSetzen("kuenstler");
  const jahr = k => Math.min(...D.werke.filter(w => w.kid === k.id).map(w => w.jahr || 9999));
  const liste = [...D.kuenstler].sort((a, b) => jahr(a) - jahr(b));
  app.innerHTML = `<h1>Künstler</h1>
    <div class="kuenstlerliste">${liste.map(k => `
      <a class="kuenstlerkarte" href="#/kuenstler/${k.id}">
        ${kuenstlerBild(k, "kuenstler-mini")}
        <div><strong>${esc(k.name)}</strong><span class="leise klein">${esc(k.lebensdaten)}</span>
        <p class="klein">${esc(k.kurz)}</p></div></a>`).join("")}</div>`;
}

function kuenstlerSeite(id) {
  const k = D.kBy[id];
  if (!k) return kuenstlerListe();
  document.title = k.name + " · Kunstkurator";
  reiterSetzen("kuenstler");
  const werke = D.werke.filter(w => w.kid === id && stationen(w.id).length);
  app.innerHTML = `
    <p class="klein"><a class="zurueck" href="#/kuenstler">‹ Alle Künstler</a></p>
    <h1>${esc(k.name)}</h1>
    <p class="werkzeile">${esc(k.lebensdaten)}</p>
    ${k.bild || k.bild_suche ? `<figure class="kuenstler-bild">${kuenstlerBild(k, "")}<figcaption class="leise klein">${esc(k.bild_text || "")}</figcaption></figure>` : ""}
    <div class="lesetext">${absatz(k.text)}</div>
    <h2>In der Sammlung</h2>
    <div class="werke">${werke.map(werkKarte).join("")}</div>`;
  window.scrollTo(0, 0);
}

// ---------- Navigation ----------
function route() {
  if (!D) return;
  const h = location.hash.replace(/^#\/?/, "");
  const [teil, id] = h.split("/");
  if (teil !== "a" && teil !== "werk" && buehne) { try { buehne.viewer.destroy(); } catch {} buehne = null; }
  if (teil === "a") { reiterSetzen("gemaelde"); detail(decodeURIComponent(id)); }
  else if (teil === "werk") { reiterSetzen("gemaelde"); werk(decodeURIComponent(id)); }
  else if (teil === "gemaelde") gemaeldeSeite();
  else if (teil === "kuenstler") id ? kuenstlerSeite(decodeURIComponent(id)) : kuenstlerListe();
  else if (teil === "naechstes") naechstesSeite();
  else rahmenSeite();
  if (teil !== "a") window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
laden().then(async () => { route(); await statusLaden(); aktualisieren(); });

// Nach neuem Rahmenstatus nur die Seiten neu zeichnen, die ihn anzeigen
function aktualisieren() {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (h[0] === "a") detail(decodeURIComponent(h[1]), true);
  else if (h[0] === "naechstes") naechstesSeite();
  else if (!h[0] || h[0] === "rahmen" || h[0] === "info") { const y = window.scrollY; rahmenSeite(); window.scrollTo(0, y); }
}
// Status alle 30 Sekunden auffrischen, solange die App sichtbar ist
setInterval(async () => {
  if (document.visibilityState !== "visible" || !D || !D.vermittler) return;
  const vorher = JSON.stringify(D.status);
  await statusLaden();
  if (JSON.stringify(D.status) !== vorher) aktualisieren();
}, 30000);
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && D && D.vermittler) { await statusLaden(); aktualisieren(); }
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
