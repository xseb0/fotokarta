/* Ledsidan: vandringarna ur SPOTS som en lista att välja mål i, i stället för en karta.
   Rutter och höjdprofiler kommer från leder.json (byggs av leder.py), väder live från Open-Meteo per led. */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const ICON = {
  forest: '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  summit: '<path d="M2 20l7-12 4 6 2-3 7 9z"/><path d="M7.5 10.5l1.5 1.5 1.5-1.5"/>',
  view:   '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M5 11l2-6h2M19 11l-2-6h-2"/>',
  water:  '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>',
  coast:  '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M6 10l4-6 3 4 2-2 3 4"/>',
  flower: '<circle cx="12" cy="10" r="2.2"/><path d="M12 12.2V21"/>',
};
const svg = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const CATS = { forest: ["Skog och dimma", "--c-forest"], water: ["Vattenfall", "--c-water"], summit: ["Ovan molnen", "--c-summit"],
               view: ["Utsikter och ryggar", "--c-view"], coast: ["Kust och lava", "--c-coast"], flower: ["Trädgårdar", "--c-flower"] };
const STATUS = { open: ["good", "Öppen"], partial: ["ok", "Delvis öppen"], closed: ["closed", "Stängd"], unknown: ["na", "Ej bekräftad"] };
const gmaps = (la, lo) => `https://www.google.com/maps/search/?api=1&query=${la},${lo}`;
const gdir = (la, lo) => `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
const ratingOf = (s) => s.rating || Math.max(1, Math.min(5, Math.round(s.style + (s.calm >= 4 ? 0.4 : s.calm <= 1 ? -0.6 : 0))));
const stars = (n) => `<span class="stars">${"●".repeat(n)}<i>${"●".repeat(5 - n)}</i></span>`;
const nf = (x) => String(x).replace(".", ",");
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem("fkl_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem("fkl_" + k, JSON.stringify(v)); } catch {} } };

const st = { day: 0, sort: store.get("sort", "best"), len: store.get("len", "any"), cats: new Set(store.get("cats", Object.keys(CATS))),
             showClosed: store.get("showClosed", false), open: new Set(), wx: null };
let DATA = { ids: [], routes: {} }, TRAILS = [], GAL = null;

// ── väder ──
// Dimchans i procent är en tumregel ur luftfuktighet och sikt (samma regel som kartan: RH 96+ eller sikt under 1 km = dimma).
const fogPct = (rh, vis) => vis < 1000 ? 92 : vis < 3000 ? 70 : Math.max(0, Math.min(80, Math.round((rh - 86) * 7)));
async function loadWx() {
  const q = new URLSearchParams({
    latitude: TRAILS.map((s) => s.lat).join(","), longitude: TRAILS.map((s) => s.lon).join(","), elevation: TRAILS.map((s) => s.ele).join(","),
    hourly: "temperature_2m,relative_humidity_2m,cloud_cover,cloud_cover_low,visibility,precipitation_probability,precipitation,wind_gusts_10m",
    daily: "sunrise,sunset", timezone: "Atlantic/Madeira", forecast_days: "3",
  });
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q); if (!r.ok) throw new Error(r.status);
    const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    st.wx = {}; TRAILS.forEach((s, i) => (st.wx[s.id] = arr[i]));
    $("#wxMsg").textContent = "Väder från Open-Meteo, räknat på varje leds höjd. Dimchansen är en tumregel ur luftfuktighet och sikt.";
  } catch { st.wx = null; $("#wxMsg").textContent = "Kunde inte hämta prognosen just nu. Lederna visas ändå."; }
  render();
}
// Timmar 7 till 19 för vald dag, med dimma, regn och moln i procent
function hours(s) {
  const w = st.wx && st.wx[s.id]; if (!w) return null;
  const H = w.hourly, D = w.daily, date = D.time[st.day]; const out = [];
  for (let h = 7; h <= 19; h++) {
    const i = H.time.indexOf(`${date}T${String(h).padStart(2, "0")}:00`); if (i < 0) continue;
    out.push({ h, fog: fogPct(H.relative_humidity_2m[i], H.visibility[i]), rain: H.precipitation_probability[i] ?? 0, mm: H.precipitation[i],
               cloud: H.cloud_cover[i], low: H.cloud_cover_low[i], rh: H.relative_humidity_2m[i], t: H.temperature_2m[i], gust: H.wind_gusts_10m[i] });
  }
  const hm = (t) => +t.slice(11, 13) + +t.slice(14, 16) / 60;
  return { list: out, rise: hm(D.sunrise[st.day]), set: hm(D.sunset[st.day]) };
}
// Hur bra en timme är för just den här ledens motiv (0–100)
function hourScore(s, x) {
  let v;
  if (s.wx === "fog") v = x.fog * 0.9 + (x.low > 60 ? 10 : 0);
  else if (s.wx === "above") v = x.rh >= 96 ? 15 : x.low >= 45 ? 85 : x.low >= 20 ? 55 : 40;
  else if (s.wx === "sky") v = x.low >= 80 ? 20 : x.cloud >= 20 && x.cloud <= 80 ? 75 : 45;
  else v = 45 + Math.min(x.cloud, 100) * 0.35 + x.fog * 0.2; // vattenfall och skog: mulet mjukt ljus
  v -= x.rain * 0.7; if (x.gust >= 55 && (s.cat === "summit" || s.cat === "coast")) v -= 40;
  return Math.max(0, Math.min(100, v));
}
function best(s) {
  const H = hours(s); if (!H) return null;
  const now = +new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Atlantic/Madeira" });
  const day = H.list.filter((x) => x.h >= Math.ceil(H.rise) && x.h <= Math.floor(H.set) && (st.day > 0 || x.h >= now)); // idag: bara timmar som är kvar
  if (day.length < 2) return null;
  let top = null;
  // I skog och raviner blir det mörkt tidigt: sista timmen före solnedgången och första efter soluppgången räknas ner
  const dim = (x) => (s.wx === "sky" || s.wx === "above") ? 0 : (x.h + 1 > H.set - 0.3 || x.h < H.rise + 0.7) ? 14 : 0;
  for (let i = 0; i < day.length - 1; i++) { const v = (hourScore(s, day[i]) - dim(day[i]) + hourScore(s, day[i + 1]) - dim(day[i + 1])) / 2; if (!top || v > top.v) top = { v, a: day[i], b: day[i + 1] }; }
  const sum = { fog: Math.max(...day.map((x) => x.fog)), rain: Math.max(...day.map((x) => x.rain)), cloud: Math.round(day.reduce((a, x) => a + x.cloud, 0) / day.length) };
  const x = top.a, why = s.wx === "fog" ? (x.fog >= 60 ? "dimma trolig" : x.fog >= 30 ? "dis möjligt" : "ingen dimma väntas")
    : s.wx === "above" ? (x.rh >= 96 ? "inne i molnet" : x.low >= 45 ? "molnhav möjligt" : "klart") : x.cloud >= 60 ? "mjukt mulet ljus" : x.cloud >= 25 ? "växlande moln" : "hård sol";
  const span = `${String(top.a.h).padStart(2, "0")}–${top.b.h + 1 > H.set ? fmtH(H.set) : String(top.b.h + 1).padStart(2, "0")}`;
  return { ...top, sum, why, span, k: top.v >= 62 ? "good" : top.v >= 42 ? "ok" : "bad", H };
}

// ── lista ──
function visible() {
  return TRAILS.filter((s) => st.cats.has(s.cat) && (st.showClosed || s.status !== "closed")
    && (st.len === "any" || (st.len === "3" ? s.km <= 3 : st.len === "6" ? s.km > 3 && s.km <= 6 : s.km > 6)))
    .map((s) => ({ s, b: best(s) }))
    .sort((A, B) => {
      const c = (A.s.status === "closed") - (B.s.status === "closed"); if (c) return c;
      if (st.sort === "short") return A.s.km - B.s.km;
      if (st.sort === "flat") return (A.s.gain || 0) - (B.s.gain || 0);
      const w = (x) => (x.b ? x.b.v : 50);
      if (st.sort === "wx") return w(B) - w(A) || ratingOf(B.s) - ratingOf(A.s);
      return ratingOf(B.s) * 20 + w(B) * 0.35 + (B.s.mine ? 6 : 0) - (ratingOf(A.s) * 20 + w(A) * 0.35 + (A.s.mine ? 6 : 0));
    });
}
const wbadge = (label, v, cls) => `<span class="wb ${cls}"><i>${label}</i>${v} %</span>`;
function head(s, b) {
  const [sk, stxt] = STATUS[s.status] || STATUS.unknown;
  const fogCls = (v) => (s.wx === "fog" ? (v >= 60 ? "hi" : v >= 30 ? "mid" : "") : "");
  const wx = b ? `<div class="wxl">${wbadge("Dimma", b.sum.fog, fogCls(b.sum.fog))}${wbadge("Regn", b.sum.rain, b.sum.rain >= 60 ? "bad" : b.sum.rain >= 30 ? "mid" : "")}${wbadge("Moln", b.sum.cloud, "")}
      <span class="pill ${b.k}">${b.k === "bad" ? "Dåligt läge" : "Bäst"} ${b.span}: ${b.why}</span></div>` : "";
  const r = DATA.routes[s.id];
  return `<button class="trh" aria-expanded="${st.open.has(s.id)}" aria-controls="b-${s.id}">
    <span class="im" style="background-image:url('${THUMBS[s.id] || ""}');--c:var(${CATS[s.cat][1]})"><span class="ix">${svg(s.cat)}</span></span>
    <span><h2>${esc(s.name)}</h2>
      <span class="sn">${stars(ratingOf(s))}<span>${esc(s.styleNote || "")}</span>${s.mine ? '<i class="mtag">● din plats</i>' : ""}</span>
      <span class="facts"><span>${nf(s.km)} <span class="u">km</span></span><span>+${s.gain || 0} <span class="u">m</span></span><span>${s.walk} <span class="u">min gång</span></span>${r ? `<span>${r.min}–${r.max} <span class="u">m ö.h.</span></span>` : ""}<span class="pill ${sk}">${stxt}</span></span>
      ${wx}</span>
    <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>`;
}
function render() {
  const rows = visible();
  $("#list").innerHTML = rows.length ? rows.map(({ s, b }) =>
    `<article class="tr ${s.status === "closed" ? "closed" : ""} ${st.open.has(s.id) ? "open" : ""}" id="t-${s.id}">${head(s, b)}<div class="trb" id="b-${s.id}" ${st.open.has(s.id) ? "" : "hidden"}></div></article>`).join("")
    : `<p class="empty">Inga leder med de här filtren.</p>`;
  for (const id of st.open) { const el = $(`#b-${CSS.escape(id)}`); if (el) body(TRAILS.find((s) => s.id === id), el); }
  renderCtl();
}
function renderCtl() {
  for (const [id, v] of [["day", st.day], ["sort", st.sort], ["len", st.len]])
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(v)));
  const n = (k) => TRAILS.filter((s) => s.cat === k && (st.showClosed || s.status !== "closed")).length;
  $("#chips").innerHTML = Object.entries(CATS).filter(([k]) => n(k)).map(([k, [name, c]]) =>
    `<button class="chip ${st.cats.has(k) ? "" : "off"}" data-k="${k}" style="--c:var(${c})"><span class="dot"></span>${name}<span class="n">${n(k)}</span></button>`).join("");
  $("#showClosed").checked = st.showClosed;
}

// ── utfällt läge ──
function profile(r) {
  const P = r.prof, W = 600, Hh = 120, pad = { l: 34, r: 6, t: 8, b: 18 };
  const maxX = P[P.length - 1][0] || 1, lo = Math.floor((r.min - 10) / 50) * 50, hi = Math.ceil((r.max + 10) / 50) * 50;
  const X = (k) => pad.l + (k / maxX) * (W - pad.l - pad.r), Y = (m) => pad.t + (1 - (m - lo) / (hi - lo || 1)) * (Hh - pad.t - pad.b);
  const line = P.map(([k, m], i) => `${i ? "L" : "M"}${X(k).toFixed(1)},${Y(m).toFixed(1)}`).join("");
  const ticks = [lo, Math.round((lo + hi) / 2 / 50) * 50, hi].filter((v, i, a) => a.indexOf(v) === i);
  return `<svg class="prof" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Höjdprofil ${r.min} till ${r.max} meter">
    ${ticks.map((t) => `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="2" y="${Y(t) + 3}">${t}</text>`).join("")}
    <path class="ar" d="${line}L${X(maxX)},${Hh - pad.b}L${X(0)},${Hh - pad.b}Z"/><path class="ln" d="${line}"/>
    <text x="${X(0)}" y="${Hh - 4}">0</text><text x="${X(maxX) - 30}" y="${Hh - 4}">${nf(maxX.toFixed(1))} km</text></svg>`;
}
function cell(v, kind) { // färgad ruta: dimma grå-vit, regn blå, moln grå
  const a = Math.max(0.06, v / 100);
  const bg = kind === "fog" ? `rgba(232,230,225,${a * 0.85})` : kind === "rain" ? `rgba(110,160,220,${a})` : `rgba(160,172,180,${a * 0.75})`;
  return `<span class="c ${kind === "fog" && v >= 55 ? "dark" : ""}" style="background:${bg}">${v}</span>`;
}
function wxTable(s, b) {
  if (!b) return st.wx ? `<p class="small">Inga dagsljustimmar kvar ${st.day ? "" : "idag"}. Välj I morgon ovanför listan.</p>` : `<p class="small">Prognosen är inte laddad.</p>`;
  const L = b.H.list, sun = (h) => (h >= b.H.rise && h <= b.H.set ? "" : ' style="opacity:.45"');
  const rows = [["Dimma", "fog"], ["Regn", "rain"], ["Moln", "cloud"]];
  const day = ["Idag", "I morgon", "Övermorgon"][st.day].toLowerCase();
  return `<div class="best">Bäst ${day} <b>kl ${b.span}</b>: ${b.why}, regn ${b.a.rain} %, ${Math.round(b.a.t)} °C${b.a.gust >= 40 ? `, vindbyar ${Math.round(b.a.gust)} km/h` : ""}.
     Solen ${fmtH(b.H.rise)} till ${fmtH(b.H.set)}.</div>
    <div class="hrs"><span></span>${L.map((x) => `<span class="h"${sun(x.h)}>${x.h}</span>`).join("")}
    ${rows.map(([n, k]) => `<span class="lb2">${n} %</span>${L.map((x) => cell(x[k], k)).join("")}`).join("")}</div>`;
}
const fmtH = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
function body(s, el) {
  const r = DATA.routes[s.id], b = best(s), pts = s.stands && s.stands.length ? s.stands : [{ name: s.name, lat: s.lat, lon: s.lon, note: "" }];
  const start = pts.find((p) => /start|parker/i.test(p.name)) || (r ? { lat: r.segs[0][0][0], lon: r.segs[0][0][1] } : s);
  el.innerHTML = `
    <div class="duo">
      <div><div class="mm" id="m-${s.id}"></div>${r ? `<p class="nomap">Rutt: ${esc(r.src)}${r.segs.length > 1 ? ` (${r.segs.length} delar)` : ""}. Siffrorna är fotopunkterna.</p>` : `<p class="nomap">Ingen rutt i OpenStreetMap, så kartan visar bara fotopunkterna.</p>`}</div>
      <div>
        <h3>Leden</h3>
        <div class="stats">
          <div class="stat"><b>${nf(s.km)} km</b><span>din tur, ${s.walk} min</span></div>
          <div class="stat"><b>+${s.gain || 0} m</b><span>stigning</span></div>
          <div class="stat"><b>${s.ele} m</b><span>höjd vid målet</span></div>
          ${r ? `<div class="stat"><b>${nf(r.fullKm ?? r.mainKm)} km</b><span>hela leden i OSM</span></div><div class="stat"><b>+${r.gain} / −${r.loss}</b><span>m längs ${r.fullKm > r.mainKm + 0.2 ? "visad bit" : "leden"}</span></div><div class="stat"><b>${r.min}–${r.max}</b><span>m ö.h.</span></div>` : ""}
        </div>
        ${r ? profile(r) : ""}
        <p class="small">${esc(s.diff || "")}${s.fee && s.fee !== "Ingen" ? ` · Avgift: ${esc(s.fee)}` : ""}</p>
      </div>
    </div>
    <div><h3>Väder ${["idag", "i morgon", "i övermorgon"][st.day]}, timme för timme</h3>${wxTable(s, b)}</div>
    <div><h3>Fotopunkter</h3><ol class="spots">${pts.map((p, i) => `<li><span class="no">${i + 1}</span><span><b>${esc(p.name)}</b>${p.note ? `<p>${esc(p.note)}</p>` : ""}</span><a href="${gmaps(p.lat, p.lon)}" target="_blank" rel="noopener">Maps</a></li>`).join("")}</ol></div>
    <div class="txt">
      <div><h3>Därför passar den dig</h3><p>${esc(s.why || "")}</p></div>
      <div><h3>Ljus</h3><p>${esc(s.light || "")}</p></div>
      ${s.tips ? `<div><h3>Tips</h3><p>${esc(s.tips)}</p></div>` : ""}
      <div><h3>Status</h3><p><span class="pill ${(STATUS[s.status] || STATUS.unknown)[0]}">${(STATUS[s.status] || STATUS.unknown)[1]}</span> ${esc(s.statusNote || "")}${s.src && /^https?:/.test(s.src) ? ` <a href="${esc(s.src)}" target="_blank" rel="noopener" style="color:var(--accent-hi)">Källa</a>` : ""}</p></div>
      ${s.mineNote ? `<div><h3>Din anteckning</h3><p>${esc(s.mineNote.replace(/^Din anteckning: /, ""))}</p></div>` : ""}
    </div>
    <div><h3>Bilder</h3><div class="gal" id="g-${s.id}"><span class="ph"></span><span class="ph"></span><span class="ph"></span></div></div>
    <div class="links">
      <a href="${gdir(start.lat, start.lon)}" target="_blank" rel="noopener">Vägbeskrivning till starten</a>
      <a href="${gmaps(s.lat, s.lon)}" target="_blank" rel="noopener">Öppna i Google Maps</a>
      <a href="index.html#${s.id}">Visa på fotokartan</a>
      ${r ? r.osm.slice(0, 2).map((id, i) => `<a href="https://www.openstreetmap.org/relation/${id}" target="_blank" rel="noopener">${esc((r.refs || [])[i] || "Leden")} i OSM</a>`).join("") : ""}
      ${s.cam ? `<a href="${esc(s.cam.url)}" target="_blank" rel="noopener">Webbkamera (${nf(s.cam.km)} km)</a>` : ""}
    </div>`;
  miniMap(s, r, pts); gallery(s);
}
function miniMap(s, r, pts) {
  const el = $(`#m-${CSS.escape(s.id)}`); if (!el) return;
  const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap, SRTM | OpenTopoMap" }).addTo(m);
  const b = L.latLngBounds([]);
  if (r) r.segs.forEach((seg) => { const pl = L.polyline(seg, { color: "#070d12", weight: 7, opacity: 0.55 }).addTo(m); L.polyline(seg, { color: "#c2412d", weight: 3.5 }).addTo(m); b.extend(pl.getBounds()); });
  pts.forEach((p, i) => { L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "npin", html: String(i + 1), iconSize: [22, 22] }), title: p.name }).addTo(m); b.extend([p.lat, p.lon]); });
  m.fitBounds(b.isValid() ? b : L.latLngBounds([[s.lat, s.lon], [s.lat, s.lon]]), { padding: [18, 18], maxZoom: 16 });
}
async function gallery(s) {
  const el = $(`#g-${CSS.escape(s.id)}`); if (!el) return;
  try { GAL = GAL || (await (await fetch("galleries.json?v=13")).json()); } catch { el.innerHTML = '<p class="small">Kunde inte hämta bilderna.</p>'; return; }
  const g = GAL[s.id] || []; if (!g.length) { el.innerHTML = '<p class="small">Inga bra bilder hittades på Wikimedia Commons.</p>'; return; }
  const url = ([fn, hd, w], px) => { const e = encodeURIComponent(fn); return w > px ? `https://upload.wikimedia.org/wikipedia/commons/thumb/${hd}/${e}/${px}px-${e}` : `https://upload.wikimedia.org/wikipedia/commons/${hd}/${e}`; };
  const imgs = g.map((x) => ({ src: url(x, 500), big: url(x, 1920), t: x[0].replace(/_/g, " ").replace(/\.\w+$/, ""), page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(x[0])}` }));
  el.innerHTML = imgs.map((i, n) => `<a href="${i.page}" data-n="${n}"><img src="${i.src}" alt="${esc(i.t)}" loading="lazy"></a>`).join("");
  el.onclick = (e) => { const a = e.target.closest("a"); if (!a) return; e.preventDefault(); lbImgs = imgs; showLb(+a.dataset.n); };
}
let lbImgs = [], lbN = 0;
function showLb(n) {
  lbN = (n + lbImgs.length) % lbImgs.length; const i = lbImgs[lbN];
  $("#lbImg").src = i.src; $("#lbImg").alt = i.t;
  const pre = new Image(); pre.onload = () => { if (lbImgs[lbN] === i) $("#lbImg").src = i.big; }; pre.src = i.big;
  $("#lbCap").innerHTML = `${esc(i.t)} <span>${lbN + 1} / ${lbImgs.length}</span> <a href="${i.page}" target="_blank" rel="noopener">Wikimedia Commons, fotograf och licens</a>`;
  $("#lb").hidden = false;
}
$("#lbClose").onclick = () => ($("#lb").hidden = true);
$("#lbPrev").onclick = () => showLb(lbN - 1); $("#lbNext").onclick = () => showLb(lbN + 1);
document.addEventListener("keydown", (e) => { if ($("#lb").hidden) return; if (e.key === "Escape") $("#lb").hidden = true; if (e.key === "ArrowLeft") showLb(lbN - 1); if (e.key === "ArrowRight") showLb(lbN + 1); });

// ── händelser ──
$("#list").addEventListener("click", (e) => {
  const h = e.target.closest(".trh"); if (!h) return;
  const art = h.parentElement, id = art.id.slice(2), el = $(".trb", art), on = !st.open.has(id);
  on ? st.open.add(id) : st.open.delete(id);
  art.classList.toggle("open", on); h.setAttribute("aria-expanded", on); el.hidden = !on;
  if (on) { body(TRAILS.find((s) => s.id === id), el); history.replaceState(null, "", "#" + id); }
  else { el.innerHTML = ""; if (location.hash === "#" + id) history.replaceState(null, "", location.pathname); }
});
for (const [id, key] of [["day", "day"], ["sort", "sort"], ["len", "len"]])
  $("#" + id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; st[key] = key === "day" ? +b.dataset.v : b.dataset.v; if (key !== "day") store.set(key, st[key]); render(); });
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k, all = st.cats.size === Object.keys(CATS).length;
  if (all) st.cats = new Set([k]); else if (st.cats.has(k)) { st.cats.delete(k); if (!st.cats.size) st.cats = new Set(Object.keys(CATS)); } else st.cats.add(k);
  store.set("cats", [...st.cats]); render();
});
$("#showClosed").addEventListener("change", (e) => { st.showClosed = e.target.checked; store.set("showClosed", st.showClosed); render(); });

// ── start ──
fetch("leder.json?v=13").then((r) => r.json()).catch(() => ({ ids: [], routes: {} })).then((d) => {
  DATA = d; const byId = Object.fromEntries(SPOTS.map((s) => [s.id, s]));
  TRAILS = d.ids.map((id) => byId[id]).filter(Boolean);
  const h = decodeURIComponent(location.hash.slice(1));
  if (byId[h] && TRAILS.includes(byId[h])) { st.open.add(h); if (byId[h].status === "closed") st.showClosed = true; st.cats.add(byId[h].cat); }
  $("#lead").textContent = `${TRAILS.length} vandringar valda och sorterade efter din stil: dimskog, vattenfall i mörk sten och platser där en figur får plats. Öppna en led för rutt, höjdprofil, väder timme för timme och fotopunkter.`;
  render(); if (st.open.size) setTimeout(() => $(`#t-${CSS.escape(h)}`)?.scrollIntoView({ block: "start" }), 50);
  loadWx();
});
})();
