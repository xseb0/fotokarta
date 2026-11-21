/* Fotokartan: Leaflet-karta över SPOTS (spots.js) + live-prognos från Open-Meteo per plats. */
(() => {
const $ = (s) => document.querySelector(s);
const ICON = { // små glyfer (24x24, streck) för punkter, chips och hover
  forest: '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  summit: '<path d="M2 20l7-12 4 6 2-3 7 9z"/><path d="M7.5 10.5l1.5 1.5 1.5-1.5"/>',
  view:   '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M5 11l2-6h2M19 11l-2-6h-2"/>',
  water:  '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>',
  coast:  '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M6 10l4-6 3 4 2-2 3 4"/>',
  flower: '<circle cx="12" cy="10" r="2.2"/><path d="M12 7.8C12 4 15 4 15 6.5S12 9 12 9M12 7.8C12 4 9 4 9 6.5S12 9 12 9M14.2 10c3.5 0 3.5 3 1 3s-3.2-2-3.2-2M9.8 10c-3.5 0-3.5 3-1 3s3.2-2 3.2-2M12 12.2V21M12 18c-2 0-4-1.5-4-3"/>',
};
const svg = (k, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const CATS = {
  forest: { n: "Skog och dimma", c: "--c-forest" },
  summit: { n: "Ovan molnen", c: "--c-summit" },
  view:   { n: "Utsikter och ryggar", c: "--c-view" },
  water:  { n: "Vattenfall", c: "--c-water" },
  coast:  { n: "Kust och lava", c: "--c-coast" },
  flower: { n: "Blommor och trädgårdar", c: "--c-flower" },
};
// Betyg 1–5 som på skatekartan. Satt för hand (s.rating) eller uppskattat från stilmatch och hur lugnt det är.
const ratingOf = (s) => s.rating || Math.max(1, Math.min(5, Math.round(s.style + (s.calm >= 4 ? 0.4 : s.calm <= 1 ? -0.6 : 0))));
const stars = (n) => `<span class="stars">${"●".repeat(n)}<i>${"●".repeat(5 - n)}</i></span>`;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const store = { get(k, d) { try { const v = localStorage.getItem("fk_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem("fk_" + k, JSON.stringify(v)); } catch {} } };

const st = {
  cats: new Set(store.get("cats", Object.keys(CATS))),
  day: 1, slot: "rise", acc: store.get("acc", "any"),
  hideClosed: store.get("hideClosed", true), mineOnly: store.get("mineOnly", false), minR: store.get("minR", "0"), onlyGood: false, q: "", sel: null, wx: null,
};

// ── karta ──
const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([32.76, -16.98], 10);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
// CARTO-nyckel (gratisnivå, får ligga publikt enligt Sebastian 2026-11-21)
const CARTO_KEY = "cb1_5ddx_1_b2bc9a882ba6667facbb099a";
const BASES = {
  streets: { n: "Gator", sw: "linear-gradient(135deg,#f2efe9,#cfe3c4)", l: () => L.tileLayer("https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=" + CARTO_KEY, { maxZoom: 20, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }) },
  osm: { n: "OSM", sw: "linear-gradient(135deg,#f2efe9,#f4c99b)", l: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }) },
  topo: { n: "Terräng", sw: "linear-gradient(135deg,#c9d3b0,#e9e2c7)", l: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap, SRTM | OpenTopoMap" }) },
  sat:  { n: "Satellit", sw: "linear-gradient(135deg,#253523,#5c6b4a)", l: () => L.layerGroup([
          L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri World Imagery" }),
          L.tileLayer("https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=" + CARTO_KEY, { maxZoom: 19, subdomains: "abcd" })]) },
  dark: { n: "Mörk", sw: "linear-gradient(135deg,#0b1218,#26323b)", l: () => L.tileLayer("https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=" + CARTO_KEY, { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }) },
};
let baseKey = store.get("base", "topo"), baseLayer = null;
function setBase(k) { if (baseLayer) map.removeLayer(baseLayer); baseKey = k; baseLayer = BASES[k].l().addTo(map); store.set("base", k);
  document.querySelectorAll("#basegrid button").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); }
$("#basegrid").innerHTML = Object.entries(BASES).map(([k, b]) => `<button data-k="${k}"><i style="--sw:${b.sw}"></i>${b.n}</button>`).join("");
$("#basegrid").onclick = (e) => { const b = e.target.closest("button"); if (b) setBase(b.dataset.k); };
setBase(baseKey);

// ── sol (NOAA-förenkling) ──
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
  const n = (d - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const M = (357.5291 + 0.98560028 * n) % 360, C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + n - lon / 360 + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
  const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec))) / rad;
  const toDate = (J) => new Date((J - 2440587.5) * 864e5);
  return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
}
const fmt = (d) => d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Madeira" });
function dayDate(off) { const d = new Date(); d.setDate(d.getDate() + off); return d; }
function slotHour() { // timme (lokal Madeira-tid) som prognosen läses för
  const s = sunTimes(dayDate(st.day), 32.75, -16.95);
  const h = (d) => +d.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Atlantic/Madeira" });
  return st.slot === "rise" ? h(s.rise) : st.slot === "set" ? h(s.set) : 10;
}
function renderSun() { const s = sunTimes(dayDate(st.day), 32.75, -16.95);
  $("#sun").textContent = `↑ ${fmt(s.rise)}  ↓ ${fmt(s.set)}`; }

// ── väder ──
async function loadWx() {
  const q = new URLSearchParams({
    latitude: SPOTS.map((s) => s.lat).join(","), longitude: SPOTS.map((s) => s.lon).join(","),
    elevation: SPOTS.map((s) => s.ele).join(","),
    hourly: "relative_humidity_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation_probability,wind_gusts_10m",
    timezone: "Atlantic/Madeira", forecast_days: "3",
  });
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    st.wx = {}; SPOTS.forEach((s, i) => (st.wx[s.id] = arr[i]));
    $("#wxMsg").textContent = "Prognos från Open-Meteo, uppräknad till varje plats höjd. Tumregler, inte garantier.";
  } catch (e) { st.wx = null; $("#wxMsg").textContent = "Kunde inte hämta prognosen (ingen täckning?). Kartan fungerar ändå."; }
  render();
}
function wxAt(s) {
  const w = st.wx && st.wx[s.id]; if (!w) return null;
  const want = dayDate(st.day).toLocaleDateString("sv-SE", { timeZone: "Atlantic/Madeira" }) + "T" + String(slotHour()).padStart(2, "0") + ":00";
  const i = w.hourly.time.indexOf(want); if (i < 0) return null;
  const H = w.hourly; return { rh: H.relative_humidity_2m[i], low: H.cloud_cover_low[i], mid: H.cloud_cover_mid[i], high: H.cloud_cover_high[i],
    vis: H.visibility[i], pp: H.precipitation_probability[i], gust: H.wind_gusts_10m[i] };
}
// Bedömning per väderregel. Returnerar {k: good|ok|bad, t: text}
function judge(s) {
  const x = wxAt(s); if (!x) return null;
  let v;
  if (s.wx === "fog") {
    if (x.rh >= 96 || x.vis < 1000) v = { k: "good", t: "Dimma trolig" };
    else if (x.rh >= 88 || x.low >= 70) v = { k: "ok", t: "Dis eller lågt moln" };
    else v = { k: "bad", t: "Klart, ingen dimma" };
  } else if (s.wx === "above") {
    if (x.rh >= 96) v = { k: "bad", t: "Inne i molnet" };
    else if (x.low >= 45 && x.rh < 90) v = { k: "good", t: "Molnhav möjligt" };
    else if (x.low >= 20) v = { k: "ok", t: "Molnslöjor under" };
    else v = { k: "ok", t: "Klart, inget molnhav" };
  } else if (s.wx === "sky") {
    const top = Math.max(x.mid, x.high);
    if (x.low >= 80) v = { k: "bad", t: "Mulet lågt" };
    else if (top >= 20 && top <= 80 && x.low < 50) v = { k: "good", t: "Färg i himlen möjlig" };
    else v = { k: "ok", t: top < 20 ? "Klar himmel" : "Tjockt molntäcke" };
  } else {
    v = x.pp >= 60 ? { k: "bad", t: "Regn troligt" } : { k: "good", t: x.low >= 50 ? "Mjukt mulet ljus" : "Okej ljus" };
  }
  if (x.pp >= 70 && v.k === "good") v = { k: "ok", t: v.t + ", men regn" };
  if (x.gust >= 60 && (s.cat === "summit" || s.cat === "coast")) v = { k: "bad", t: `Hårda vindbyar ${Math.round(x.gust)} km/h` };
  v.x = x; return v;
}

// ── tillgänglighet ──
const accScore = (s) => s.mode === "car" ? 5 : s.mode === "short" ? (s.walk <= 15 ? 4 : 3) : s.walk <= 90 ? 2 : 1;
const accOK = (s) => st.acc === "any" || (st.acc === "car" && s.mode === "car") || (st.acc === "short" && s.walk <= 20) || (st.acc === "hike" && s.mode === "hike");
const STATUS = { open: ["good", "Öppen"], partial: ["ok", "Delvis öppen"], closed: ["closed", "Stängd"], unknown: ["na", "Ej bekräftad"] };
const walkTxt = (s) => s.mode === "car" ? "Bil ända fram" : `${s.walk} min gång, ${String(s.km).replace(".", ",")} km${s.gain ? `, +${s.gain} m` : ""}`;

// ── chips ──
function renderChips() {
  const all = st.cats.size === Object.keys(CATS).length;
  $("#chips").innerHTML = `<button class="chip all ${all ? "on" : ""}" data-k="*">Alla<span class="n">${SPOTS.length}</span></button>`
    + `<button class="chip mine ${st.mineOnly ? "on" : ""}" data-k="mine"><span class="dot"></span>Mina<span class="n">${SPOTS.filter((s) => s.mine).length}</span></button>` + Object.entries(CATS).map(([k, c]) => {
    const n = SPOTS.filter((s) => s.cat === k).length;
    return `<button class="chip ${st.cats.has(k) ? "" : "off"}" data-k="${k}" style="--c:var(${c.c})"><span class="dot">${svg(k)}</span>${c.n}<span class="n">${n}</span></button>`;
  }).join("");
}
$("#chips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k;
  if (k === "mine") { st.mineOnly = !st.mineOnly; store.set("mineOnly", st.mineOnly); renderChips(); render(); return; }
  if (k === "*") st.cats = new Set(Object.keys(CATS));
  else if (st.cats.size === Object.keys(CATS).length) { st.cats = new Set([k]); } else if (st.cats.has(k)) { st.cats.delete(k); if (!st.cats.size) st.cats = new Set(Object.keys(CATS)); } else st.cats.add(k);
  store.set("cats", [...st.cats]); renderChips(); render(); };

function segs() {
  for (const [id, key] of [["#day", "day"], ["#slot", "slot"], ["#acc", "acc"], ["#minR", "minR"]]) {
    const el = $(id); el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(st[key]) === b.dataset.v));
    el.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st[key] = key === "day" ? +b.dataset.v : b.dataset.v;
      if (key === "acc" || key === "minR") store.set(key, st[key]); segs(); renderSun(); render(); if (st.sel) openCard(st.sel); };
  }
}
$("#hideClosed").checked = st.hideClosed;
$("#hideClosed").onchange = (e) => { st.hideClosed = e.target.checked; store.set("hideClosed", st.hideClosed); render(); };
$("#onlyGood").onchange = (e) => { st.onlyGood = e.target.checked; render(); };
$("#q").oninput = (e) => { st.q = e.target.value.trim().toLowerCase(); $("#qClear").hidden = !st.q; render(); if (st.q) openSheet(true); };
$("#qClear").onclick = () => { $("#q").value = ""; st.q = ""; $("#qClear").hidden = true; render(); };

// ── markörer och lista ──
const layer = L.layerGroup().addTo(map); const markers = {};
function visible() {
  return SPOTS.filter((s) => st.cats.has(s.cat) && accOK(s) && ratingOf(s) >= +st.minR && (!st.mineOnly || s.mine) && !(st.hideClosed && s.status === "closed")
    && (!st.q || (s.name + " " + s.why).toLowerCase().includes(st.q))
    && (!st.onlyGood || (judge(s) || {}).k === "good"));
}
function rank(s) { const j = judge(s); return ratingOf(s) * 2 + (j ? (j.k === "good" ? 3 : j.k === "ok" ? 1 : -1) : 0) + s.calm * 0.4 + accScore(s) * 0.3; }
let lastKey = "";
function render() {
  const vis = visible().sort((a, b) => rank(b) - rank(a));
  // Markörerna byggs bara om när filter eller prognos ändras, inte när en plats väljs.
  const key = vis.map((s) => s.id + ":" + ((judge(s) || {}).k || "")).join(",");
  if (key !== lastKey) {
    lastKey = key; layer.clearLayers();
    for (const s of vis) {
      const j = judge(s), d = 18 + ratingOf(s) * 2.5;
      const ring = s.status === "closed" ? "var(--closed)" : j ? `var(--${j.k})` : "var(--ink)";
      const icon = L.divIcon({ className: "pinwrap", iconSize: [d, d],
        html: `<div class="pin${s.status === "closed" ? " closed" : ""}${s.mine ? " mine" : ""}" data-id="${s.id}" style="--c:var(${CATS[s.cat].c});--r:${ring};width:${d}px;height:${d}px">${svg(s.cat)}</div>` });
      const m = L.marker([s.lat, s.lon], { icon, riseOnHover: true, zIndexOffset: ratingOf(s) * 100, keyboard: true, title: s.name })
        .bindTooltip(() => tipHtml(s), { className: "tip", direction: "top", offset: [0, -d / 2], opacity: 1 })
        .on("mouseover", () => loadThumb(s).then(() => m.isTooltipOpen() && m.setTooltipContent(tipHtml(s))))
        .on("click", (e) => { L.DomEvent.stop(e); openCard(s.id); });
      m.addTo(layer); markers[s.id] = m;
    }
  }
  document.querySelectorAll(".pin").forEach((p) => p.classList.toggle("sel", p.dataset.id === st.sel));
  $("#sheetSub").textContent = `${vis.length} av ${SPOTS.length}, bäst först`;
  $("#list").innerHTML = vis.length ? vis.map((s) => {
    const j = judge(s), [sk, stxt] = STATUS[s.status];
    return `<button class="item ${st.sel === s.id ? "sel" : ""}" data-id="${s.id}" style="--c:var(${CATS[s.cat].c})"><span class="dot">${svg(s.cat)}</span>
      <span style="min-width:0"><div class="t">${s.name}</div><div class="w">${walkTxt(s)}</div></span>
      <span class="meta">${stars(ratingOf(s))}
      ${s.status !== "open" && s.status !== "unknown" ? `<span class="pill ${sk}">${stxt}</span>` : j ? `<span class="pill ${j.k}">${j.t}</span>` : `<span class="pill ${sk}">${stxt}</span>`}</span></button>`;
  }).join("") : `<div class="empty">Inga platser matchar filtren.</div>`;
}
$("#list").onclick = (e) => { const b = e.target.closest(".item"); if (b) openCard(b.dataset.id); };
function openSheet(on) { $("#sheet").classList.toggle("collapsed", !on); $("#sheetBar").setAttribute("aria-expanded", on); }
$("#sheetBar").onclick = () => openSheet($("#sheet").classList.contains("collapsed"));

// ── kort ──
const bar = (label, v, txt) => `<span>${label}</span><span class="m"><i style="width:${v * 20}%"></i></span><span class="v">${txt ?? v + "/5"}</span>`;
function openCard(id) {
  const s = SPOTS.find((x) => x.id === id); if (!s) return; st.sel = id;
  const j = judge(s), [sk, stxt] = STATUS[s.status];
  const src = SRC[s.src] || (/^https?:/.test(s.src || "") ? { t: new URL(s.src).hostname.replace(/^www\./, ""), u: s.src } : SRC.ifcn18);
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const slotName = { rise: "soluppgång", mid: "kl 10", set: "solnedgång" }[st.slot], dayName = ["idag", "i morgon", "i övermorgon"][st.day];
  $("#card").innerHTML = `<button class="x" aria-label="Stäng">×</button><div class="body" style="--c:var(${CATS[s.cat].c})">
    <div><div class="kind">${svg(s.cat)}${CATS[s.cat].n} · ${s.ele} m ö.h.</div><h2>${s.name}</h2>
      <div class="rate">${stars(ratingOf(s))}<span class="small">${s.styleNote ? s.styleNote : s.rating ? "betygsatt för hand" : "uppskattat från stilmatch och lugn"}</span></div></div>
      ${s.mine ? `<p class="mine-line">På din lista i Google Maps${s.mineNote ? ". " + s.mineNote : ""}</p>` : ""}
    <div class="gal" id="gal"><span class="ph"></span><span class="ph"></span><span class="ph"></span></div>
    <p class="why" style="margin:0">${s.why}</p>
    ${s.stands && s.stands.length ? `<div><h3>Fotopunkter</h3><div class="standlist">${s.stands.map((p, i) =>
      `<button data-i="${i}"><span class="n">${i + 1}</span><span><b>${p.name}</b>${p.note}</span></button>`).join("")}</div></div>` : ""}
    <div class="status" style="--sc:var(--${sk === "na" ? "closed" : sk === "closed" ? "bad" : sk})"><span><span class="pill ${sk}">${stxt}</span></span>
      <span>${s.statusNote}</span><span class="small">Källa: <a href="${src.u}" target="_blank" rel="noopener">${src.t}</a>. Kontrollerat ${STATUS_DATE}.</span></div>
    <div><h3>Ta sig dit</h3><dl>
      <dt>Väg</dt><dd>${walkTxt(s)}</dd><dt>Svårighet</dt><dd>${s.diff}</dd><dt>Avgift</dt><dd>${s.fee}</dd></dl></div>
    <div><h3>Variabler</h3><div class="bars">${bar("Stilmatch", s.style)}${bar("Dimchans", s.fog)}${bar("Lugn", s.calm)}${bar("Tillgänglighet", accScore(s))}</div></div>
    <div class="wx"><h3 style="margin:0">Prognos ${dayName}, ${slotName}</h3>${j ? `<span><span class="pill ${j.k}">${j.t}</span></span>
      <div class="row"><span>Låga moln ${j.x.low}%</span><span>Mellan/höga ${Math.max(j.x.mid, j.x.high)}%</span><span>Fukt ${j.x.rh}%</span><span>Sikt ${j.x.vis >= 10000 ? ">10" : (j.x.vis / 1000).toFixed(1)} km</span><span>Regn ${j.x.pp}%</span><span>Byar ${Math.round(j.x.gust)} km/h</span></div>`
      : `<span class="small">Ingen prognos laddad.</span>`}</div>
    <div><h3>Ljus</h3><p style="margin:0">${s.light}</p></div>
    ${s.tips ? `<div><h3>Tips</h3><p style="margin:0">${s.tips}</p></div>` : ""}
    <div class="tags">${s.figure ? "<span>Figur/modell</span>" : ""}${s.still ? "<span>Still life för klienter</span>" : ""}${s.shot ? "<span>Redan i portfolion</span>" : ""}</div>
    <div class="links"><a href="${nav}" target="_blank" rel="noopener">Vägbeskrivning</a>
      ${s.mode === "hike" || /SIMplifica|PR1/.test(s.fee) ? `<a href="${SRC.fees.u}" target="_blank" rel="noopener">Boka led (SIMplifica)</a>` : ""}
      ${s.cam ? `<a href="${s.cam.url}" target="_blank" rel="noopener">Webbkamera: ${s.cam.name}${s.cam.km ? ` (${String(s.cam.km).replace(".", ",")} km)` : ""}</a>`
        : `<a href="https://www.netmadeira.com/webcams-madeira" target="_blank" rel="noopener">Webbkameror (alla)</a>`}
      <a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(s.name.replace(/\(.*?\)/g, "") + " Madeira")}" target="_blank" rel="noopener">Fler bilder</a></div>
  </div>`;
  $("#card").hidden = false; $("#card").scrollTop = 0; document.body.classList.add("card-open");
  $("#card .x").onclick = closeCard;
  $("#card .standlist")?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
    const p = s.stands[+b.dataset.i]; map.flyTo([p.lat, p.lon], 16); standMarkers[+b.dataset.i]?.openTooltip(); });
  showStands(s); loadGallery(s); render();
  keepVisible(s);
}
// Flytta kartan så att vald plats inte hamnar under kortet eller sidopanelen
function keepVisible(s) {
  const p = map.latLngToContainerPoint([s.lat, s.lon]), W = innerWidth, H = innerHeight;
  const box = phone.matches ? { x0: 20, x1: W - 70, y0: 120, y1: H * 0.36 } : { x0: 430, x1: W - 500, y0: 40, y1: H - 40 };
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) map.panBy([p.x - cx, p.y - cy]);
}
function closeCard() { $("#card").hidden = true; st.sel = null; document.body.classList.remove("card-open"); standLayer.clearLayers(); render(); }

// Fotopunkter för vald plats
const standLayer = L.layerGroup().addTo(map); let standMarkers = [];
const camSvg = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
function showStands(s) {
  standLayer.clearLayers(); standMarkers = [];
  (s.stands || []).forEach((p, i) => {
    L.polyline([[s.lat, s.lon], [p.lat, p.lon]], { color: "#e8e6e1", weight: 1.5, opacity: 0.6, dashArray: "4 5", interactive: false }).addTo(standLayer);
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", iconSize: [26, 26], html: `<div class="stand">${i + 1}</div>` }), zIndexOffset: 2000 })
      .bindTooltip(`<b>${i + 1}. ${p.name}</b>`, { className: "lbl", direction: "top", offset: [0, -14] })
      .on("click", (e) => { L.DomEvent.stop(e); $("#card .standlist")?.children[i]?.scrollIntoView({ block: "center", behavior: "smooth" }); });
    m.addTo(standLayer); standMarkers.push(m);
  });
}

// Hover: miniatyrbild, kategori, betyg och status
const thumbs = {};
function loadThumb(s) {
  if (thumbs[s.id] !== undefined) return Promise.resolve();
  if (s.thumb) { thumbs[s.id] = s.thumb; return Promise.resolve(); }
  thumbs[s.id] = null; // markerar "hämtas" så att vi bara frågar en gång
  return loadGallery(s, true).then((imgs) => { thumbs[s.id] = imgs && imgs[0] ? imgs[0].src : ""; });
}
function tipHtml(s) {
  const t = thumbs[s.id], [sk, stxt] = STATUS[s.status], j = judge(s);
  return `<div class="tipc" style="--c:var(${CATS[s.cat].c})">
    ${t ? `<img src="${t}" alt="">` : t === "" ? "" : `<span class="tph"></span>`}
    <div class="tipb"><b>${s.name}</b>
      <span class="tag">${svg(s.cat)}${CATS[s.cat].n}${s.mine ? ' · <i class="mtag">din plats</i>' : ""}</span>
      <span class="tipr">${stars(ratingOf(s))}${s.status === "closed" || s.status === "partial" ? `<span class="pill ${sk}">${stxt}</span>` : j ? `<span class="pill ${j.k}">${j.t}</span>` : ""}</span></div></div>`;
}

// Lightbox för förhandsbilderna
let lbImgs = [], lbN = 0;
function lbShow(n) {
  lbN = (n + lbImgs.length) % lbImgs.length; const i = lbImgs[lbN];
  $("#lbImg").src = i.src; $("#lbImg").alt = i.t; // visa tumnageln direkt, byt till stor när den laddats
  const pre = new Image(); pre.onload = () => { if (lbImgs[lbN] === i) $("#lbImg").src = i.big; }; pre.src = i.big;
  $("#lbCap").innerHTML = `${i.t} <span>${lbN + 1} / ${lbImgs.length}</span> <a href="${i.page}" target="_blank" rel="noopener">Wikimedia Commons, fotograf och licens</a>`;
  [lbImgs[lbN + 1], lbImgs[lbN - 1]].forEach((x) => x && (new Image().src = x.big));
}
function lbOpen(imgs, n) { lbImgs = imgs; $("#lb").hidden = false; lbShow(n); $("#lbClose").focus(); }
function lbClose() { $("#lb").hidden = true; $("#lbImg").removeAttribute("src"); }
$("#lbClose").onclick = lbClose; $("#lbPrev").onclick = () => lbShow(lbN - 1); $("#lbNext").onclick = () => lbShow(lbN + 1);
$("#lb").onclick = (e) => { if (e.target.id === "lb" || e.target.id === "lbStage") lbClose(); };
addEventListener("keydown", (e) => { if ($("#lb").hidden) return;
  if (e.key === "Escape") lbClose(); else if (e.key === "ArrowRight") lbShow(lbN + 1); else if (e.key === "ArrowLeft") lbShow(lbN - 1); });
let tx = null;
$("#lb").addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
$("#lb").addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
  if (Math.abs(dx) > 50) lbShow(lbN + (dx < 0 ? 1 : -1)); });

// Förhandsbilder: geotaggade foton från Wikimedia Commons nära platsen och dess fotopunkter
const galCache = {}; let curP;
const curated = () => (curP ||= fetch("galleries.json?v=10").then((r) => r.json()).catch(() => ({})));
async function loadGallery(s, silent) {
  const el = () => (st.sel === s.id ? $("#gal") : null);
  if (!galCache[s.id]) galCache[s.id] = (async () => {
    // Förvalda bilder från bildval.py, rankade efter vad platsen är till för; live-sökning bara som reserv
    const pick = (await curated())[s.id];
    if (pick && pick.length) return pick.map(([fn, hd, w]) => { const e = encodeURIComponent(fn), base = "https://upload.wikimedia.org/wikipedia/commons/";
      const th = (px) => (w > px ? `${base}thumb/${hd}/${e}/${px}px-${e}` : base + hd + "/" + e);
      return { src: th(500), big: th(1920), page: "https://commons.wikimedia.org/wiki/File:" + e, t: fn.replace(/_/g, " ").replace(/\.\w+$/, "") }; });
    const pts = [[s.lat, s.lon], ...(s.stands || []).slice(0, 2).map((p) => [p.lat, p.lon])];
    const seen = new Set(), out = [];
    const cached = store.get("gal2_" + s.id, null);
    if (cached && Date.now() - cached.at < 7 * 864e5) return cached.imgs;
    const res = await Promise.all(pts.map(async ([la, lo]) => {
      const q = new URLSearchParams({ action: "query", generator: "geosearch", ggscoord: `${la}|${lo}`, ggsradius: "700", ggslimit: "30",
        ggsnamespace: "6", prop: "imageinfo", iiprop: "url|size", iiurlheight: "380", format: "json", origin: "*" });
      try { return Object.values((await (await fetch("https://commons.wikimedia.org/w/api.php?" + q)).json()).query?.pages || {}).sort((a, b) => a.index - b.index); }
      catch { return []; }
    }));
    for (const pg of res.flat()) {
      const ii = pg.imageinfo?.[0]; if (!ii || seen.has(pg.pageid) || !/\.(jpe?g)$/i.test(pg.title) || ii.width < 800) continue;
      seen.add(pg.pageid);
      const big = ii.width > 1800 ? ii.thumburl.replace(/\/\d+px-/, "/1800px-") : ii.url;
      out.push({ src: ii.thumburl, big, page: ii.descriptionurl, t: pg.title.replace(/^File:|\.\w+$/g, "") });
    }
    if (out.length) store.set("gal2_" + s.id, { at: Date.now(), imgs: out.slice(0, 14) });
    return out.slice(0, 14);
  })();
  const imgs = await galCache[s.id]; if (silent) return imgs; const g = el(); if (!g) return imgs;
  g.onclick = (e) => { const a = e.target.closest("a[data-n]"); if (!a) return; e.preventDefault(); lbOpen(imgs, +a.dataset.n); };
  g.innerHTML = imgs.length ? imgs.map((i, n) => `<a href="${i.page}" data-n="${n}" title="${i.t.replace(/"/g, "")}"><img src="${i.src}" alt="${i.t.replace(/"/g, "")}" loading="lazy"></a>`).join("")
    : `<p class="small" style="padding:0 18px">Inga geotaggade bilder hittades här. Prova "Fler bilder".</p>`;
}
map.on("click", () => { if (st.sel) closeCard(); });
// Mindre punkter när man zoomat ut, så att de inte täcker varandra
function zoomClass() { const z = map.getZoom(), c = map.getContainer().classList; c.toggle("zlo", z < 11); c.toggle("zmid", z >= 11 && z < 12); }
map.on("zoomend", zoomClass);

// ── knappar ──
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => ($("#" + b.dataset.close).hidden = true)));
$("#bLayers").onclick = () => { $("#info").hidden = true; $("#layers").hidden = !$("#layers").hidden; };
$("#bInfo").onclick = () => { $("#layers").hidden = true; $("#info").hidden = !$("#info").hidden; };
let me = null;
$("#bLocate").onclick = () => { map.locate({ setView: true, maxZoom: 13 }); };
map.on("locationfound", (e) => { if (me) map.removeLayer(me);
  me = L.marker(e.latlng, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] }) }).addTo(map); $("#bLocate").classList.add("follow"); });
map.on("locationerror", () => { $("#wxMsg").textContent = "Kunde inte hämta din position."; });

$("#infoBody").innerHTML = `
  <h4>Variablerna</h4>
  <p><b>Stilmatch och betyg</b>: hur väl platsen passar det du faktiskt fotograferar, utläst ur portfolion: dimskog och förvridna lagerträd, vattenfall i mörk sten, döda träd, ruiner och kyrktak, platser som fungerar som kuliss för en figur. Sol, kustpanoramor och trädgårdar ligger lågt. Varje plats har en kort motivering under betyget.</p>
  <p><b>Dimchans</b>: hur ofta platsen ligger i moln. Laurisilva-zonen på norrsidan (500–1200 m) är dimmigast.</p>
  <p><b>Lugn</b>: hur tomt det brukar vara. 5 betyder nästan ensam.</p>
  <p><b>Tillgänglighet</b>: 5 = bil ända fram, 1 = lång vandring.</p>
  <h4>Väderringen runt pricken</h4>
  <p>Grön betyder att vädret passar platsen vid vald tid, gul att det kanske gör det och röd att det inte gör det. Varje plats har en egen regel. Skog vill ha dimma (fukt över 96 % eller sikt under 1 km). Toppar vill ha låga moln under sig och torr luft på toppen. Kust vill ha mellanhöga eller höga moln som kan färgas av solen. Trädgårdar vill bara slippa regn. Allt är tumregler ovanpå Open-Meteos modell.</p>
  <h4>Status</h4>
  <p>Stormen Charles (10–11 nov) stängde alla leder. Läget den ${STATUS_DATE}: 24 leder har återöppnat, 15 är fortfarande stängda. Sedan 1 jan 2026 måste varje PR-led bokas i SIMplifica med en 30-minuterslucka (4,50 €, dagspass 9 €). Böterna för att gå utan bokning eller på en stängd led är upp till 10 000 €. IFCN stänger lederna med kort varsel vid väglarm, så kontrollera kvällen innan. Marken är fortfarande mättad, så räkna med stenar på bergsvägarna.</p>
  <p><b>Drönare:</b> ANAC-zoner gäller överallt, och flygplatsen är förbjuden zon. I laurisilva och de centrala bergen behövs enligt uppgift tillstånd från IFCN.</p>`;

// På telefon: panelen fälls ihop till en rad (tryck på rubriken för att öppna)
const phone = matchMedia("(max-width:760px)");
function setCtx(min) { $("#ctx").classList.toggle("min", min); $("#ctxTgl").textContent = min ? "Visa" : "Dölj";
  $("#ctxTgl").setAttribute("aria-expanded", !min); store.set("ctxMin", min); }
setCtx(store.get("ctxMin", phone.matches));
$("#ctxHead").onclick = () => setCtx(!$("#ctx").classList.contains("min"));
map.fitBounds([[32.64, -17.27], [32.87, -16.66]], { paddingTopLeft: phone.matches ? [0, 80] : [420, 0] });

zoomClass(); renderChips(); segs(); renderSun(); render();
loadWx().then(() => { const h = location.hash.slice(1); if (SPOTS.some((s) => s.id === h)) openCard(h); });
})();
