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
  const [werke, ausschnitte, info, texte] = await Promise.all([
    get("werke.json"), get("ausschnitte.json"), get("bildinfo.json"), get("werktexte.json")]);
  D = { werke: werke || [], ausschnitte: ausschnitte || [], info: info || {}, texte: texte || {} };
  D.werkBy = Object.fromEntries(D.werke.map(w => [w.id, w]));
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
  return `${esc(w.kuenstler)}, <a href="#/werk/${w.id}">${esc(w.titel)}</a>, ${esc(w.datierung)} · ${esc(w.museum)}, ${esc(w.ort)}`;
}

function kachel(a) {
  const w = D.werkBy[a.werk];
  return `<a class="kachel" href="#/a/${a.id}">
    <img loading="lazy" src="img/vorschau/${a.id}.jpg${IV(a.id)}" alt="">
    <div class="kachel-text"><div class="kachel-titel">${esc(a.titel)}</div>
    <div class="kachel-werk">${esc(w ? w.titel : "")}</div></div></a>`;
}

function uebersicht() {
  document.title = "Kunstkurator";
  const liste = D.ausschnitte.filter(a => filter === "alle" || a.werk === filter);
  const chips = [["alle", "Alle"], ...D.werke.filter(w => D.ausschnitte.some(a => a.werk === w.id)).map(w => [w.id, w.titel])]
    .map(([id, t]) => `<button class="chip ${filter === id ? "aktiv" : ""}" data-f="${id}">${esc(t)}</button>`).join("");
  const werke = D.werke.filter(w => D.ausschnitte.some(a => a.werk === w.id)).map(w => `
    <a class="werkkarte" href="#/werk/${w.id}"><img loading="lazy" src="img/werke/${w.id}.jpg${V}" alt="">
    <div><strong>${esc(w.titel)}</strong><span class="leise klein">${esc(w.kuenstler)} · ${D.ausschnitte.filter(a => a.werk === w.id).length} Ausschnitte</span></div></a>`).join("");
  app.innerHTML = `
    <h1>Ausschnitte</h1>
    <p class="leise">${D.ausschnitte.length} Details aus ${D.werke.filter(w => D.ausschnitte.some(a => a.werk === w.id)).length} Gemälden, zugeschnitten für den Rahmen.</p>
    <div class="chips">${chips}</div>
    <div class="raster">${liste.map(kachel).join("")}</div>
    <h2>Die Gemälde</h2>
    <div class="werke">${werke}</div>
    <p class="fuss">Alle Abbildungen gemeinfrei, Quelle: Wikimedia Commons.</p>`;
  app.querySelectorAll(".chip").forEach(b => b.onclick = () => {
    filter = b.dataset.f; sessionStorage.setItem("kk-filter", filter); uebersicht();
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

function detail(id) {
  const a = D.ausschnitte.find(x => x.id === id);
  if (!a) return uebersicht();
  const w = D.werkBy[a.werk];
  const liste = D.ausschnitte;
  const i = liste.indexOf(a);
  const vor = liste[(i - 1 + liste.length) % liste.length], nach = liste[(i + 1) % liste.length];
  document.title = a.titel + " · Kunstkurator";
  app.innerHTML = `
    <div class="detail">
      <div class="detail-bild">
        <img src="img/rahmen/${a.id}.jpg${IV(a.id)}" alt="${esc(a.titel)}">
        <div class="blaettern">
          <a class="knopf" href="#/a/${vor.id}">‹ Zurück</a>
          <a class="knopf" href="img/rahmen/${a.id}.jpg" download="${a.id}.jpg">Bild laden</a>
          <a class="knopf" href="#/a/${nach.id}">Weiter ›</a>
        </div>
      </div>
      <div>
        <h1>${esc(a.titel)}</h1>
        <p class="werkzeile">${werkZeile(w)}${a.stelle ? "<br>" + esc(a.stelle) : ""}</p>
        <div class="lesetext">${absatz(a.text)}</div>
        <h2>Wo im Gemälde</h2>
        ${gesamtbild(w, a, false)}
        <p class="klein leise" style="margin-top:1.5em">Ausschnitt ${D.nummer[a.id]} von ${D.ausschnitte.filter(x => x.werk === w.id).length} aus diesem Werk · Datei ${esc(a.id)}.jpg</p>
      </div>
    </div>`;
  zoomen(app);
  window.scrollTo(0, 0);
}

function werk(id) {
  const w = D.werkBy[id];
  if (!w) return uebersicht();
  document.title = w.titel + " · Kunstkurator";
  const quelle = D.info[id] && D.info[id].quelle;
  app.innerHTML = `
    <h1>${esc(w.titel)}</h1>
    <p class="werkzeile">${esc(w.kuenstler)} · ${esc(w.datierung)} · ${esc(w.technik)}, ${esc(w.masse)}<br>${esc(w.museum)}, ${esc(w.ort)}</p>
    ${gesamtbild(w, null, true)}
    <div class="lesetext" style="margin-top:1.4em">${absatz(D.texte[id])}</div>
    <h2>Die Ausschnitte</h2>
    <div class="raster">${D.ausschnitte.filter(a => a.werk === id).map(kachel).join("")}</div>
    ${quelle ? `<p class="fuss"><a href="${esc(quelle)}" target="_blank" rel="noopener">Abbildung auf Wikimedia Commons</a> (gemeinfrei)</p>` : ""}`;
  zoomen(app);
  window.scrollTo(0, 0);
}

function info() {
  document.title = "Rahmen · Kunstkurator";
  app.innerHTML = `
    <h1>Bilder für den Rahmen</h1>
    <p class="leise">Jeder Ausschnitt liegt als JPG mit 1200 × 1600 Pixeln im Hochformat bereit, passend zum reTerminal E1004.</p>
    <p><a class="knopf gold" href="download/rahmenbilder.zip" download>Alle ${D.ausschnitte.length} Bilder als ZIP laden</a></p>
    <div class="infokasten">
      <strong>So kommen die Bilder auf den Rahmen</strong>
      <ol>
        <li>ZIP am Computer laden und entpacken.</li>
        <li>Rahmen mit der Refresh-Taste aufwecken, die Weboberfläche bleibt dann erreichbar.</li>
        <li>Weboberfläche im Browser öffnen, ein Album anlegen (zum Beispiel „Bosch“ und „Bruegel“) und die Bilder hineinziehen. Die Firmware rechnet sie beim Hochladen ins Displayformat um.</li>
        <li>In den Einstellungen die Rotation auf Speicher und Reihenfolge „random“ stellen.</li>
        <li>Rechte Taste am Rahmen: nächstes Bild, auch aus dem Tiefschlaf.</li>
      </ol>
    </div>
    <p class="leise klein">Neue Gemälde kommen über ein Update dazu. Bereits geladene Bilder ändern ihren Dateinamen nicht.</p>`;
}

function zufall() {
  const a = D.ausschnitte[Math.floor(Math.random() * D.ausschnitte.length)];
  location.replace("#/a/" + a.id);
}

function route() {
  if (!D) return;
  const h = location.hash.replace(/^#\/?/, "");
  const [teil, id] = h.split("/");
  if (teil === "a") detail(decodeURIComponent(id));
  else if (teil === "werk") werk(decodeURIComponent(id));
  else if (teil === "info") info();
  else if (teil === "zufall") zufall();
  else uebersicht();
}

window.addEventListener("hashchange", route);
laden().then(route);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
