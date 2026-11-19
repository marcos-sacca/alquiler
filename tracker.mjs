// Tracker de alquileres (Zonaprop). Uso: node tracker.mjs   |   node tracker.mjs --test
// Baja los avisos, actualiza data/listings.json (historial de precios) y regenera data.js para index.html.
import fs from "node:fs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const TIPOS = ["departamentos", "ph"];
// Zonaprop rellena las páginas con avisos de zonas vecinas: solo me quedo con las que busco.
const CABA_RE = /Belgrano|N[uú]ñez|Saavedra/i;
const LOC_OK = new RegExp(`Vicente L[oó]pez|Mart[ií]nez|Villa Adelina|${CABA_RE.source}`, "i");
// Filtros del propio sitio. Zonaprop bloquea (403) de la página 10 en adelante (270 avisos por búsqueda), así que:
// - "1-ambiente" y "2-ambientes" sin precio dan una muestra de todo el mercado, que sirve para saber qué es "típico".
// - Las versiones "hasta $900.000" aseguran no perder ningún aviso dentro del presupuesto. Si una pasa los 270, se pide también
//   ordenada al revés (la descendente se salta cuando la ascendente ya entró completa).
const HASTA = "menos-900000-pesos";
const BASE = ["1-ambiente", "2-ambientes"];
const GBA = { zonas: ["vicente-lopez", "martinez", "villa-adelina"], sufijos: [...BASE, `2-ambientes-${HASTA}`] };
const CABA = { zonas: ["belgrano", "nunez", "saavedra"], sufijos: [...BASE, ...BASE.flatMap((a) => [`${a}-${HASTA}-orden-precio-ascendente`, `${a}-${HASTA}-orden-precio-descendente`])] };
const BUSQUEDAS = [GBA, CABA].flatMap((g) => TIPOS.flatMap((tipo) => g.zonas.flatMap((zona) => g.sufijos.map((suf) => ({ tipo, zona, suf })))));
const MAX_PAGINAS = 9, PAUSA_MS = 4000, TOPE = 900_000, PISO = 200_000, MAX_DETALLES = 80; // MAX_DETALLES: páginas de aviso que se piden por corrida
const UA = "alquiler-tracker-personal/1.0";
const DB = "data/listings.json";

const txt = (s) => (s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
const grab = (h, re) => h.match(re)?.[1];

const NUM = { un: 1, uno: 1, dos: 2, tres: 3 };
// El contrato no es un dato del aviso: solo aparece si el dueño lo escribe en la descripción ("contrato 2 años", "18 meses de contrato").
export function contratoMeses(texto) {
  const N = "(\\d+|uno?|dos|tres)", U = "(a[ñn]os?|meses)";
  const m = texto.match(new RegExp(`contrato[^.\\d]{0,25}?${N}\\s*${U}`, "i")) ?? texto.match(new RegExp(`${N}\\s*${U}\\s*de\\s*contrato`, "i"));
  if (!m) return null;
  const n = NUM[m[1].toLowerCase()] ?? Number(m[1]);
  return /^a/i.test(m[2]) ? n * 12 : n;
}

// La página de cada aviso dice "Publicado hoy / ayer / hace 70 días". Devuelve los días desde la publicación.
export function diasPublicado(html) {
  const m = html.match(/Publicado\s+(hoy|ayer|hace\s+(\d+)\s+(d[ií]as?|semanas?|mes(?:es)?|a[ñn]os?))/i);
  if (!m) return null;
  if (/hoy/i.test(m[1])) return 0;
  if (/ayer/i.test(m[1])) return 1;
  const n = Number(m[2]), u = m[3].toLowerCase();
  return n * (u.startsWith("d") ? 1 : u.startsWith("s") ? 7 : u.startsWith("m") ? 30 : 365);
}

export function parsePagina(html) {
  return html.split('data-qa="posting PROPERTY"').slice(1).map((c) => {
    const price = txt(grab(c, /POSTING_CARD_PRICE">(.*?)<\/h2>/s));
    const exp = txt(grab(c, /data-qa="expensas">(.*?)<\/h2>/s));
    const feats = txt(grab(c, /POSTING_CARD_FEATURES">(.*?)<\/h3>/s));
    return {
      id: grab(c, /data-id="(\d+)"/),
      url: "https://www.zonaprop.com.ar" + grab(c, /data-to-posting="([^"?]+)/), // sin parámetros de tracking
      usd: /USD/.test(price),
      precio: /\d/.test(price) ? num(price.replace(/[^\d.,]/g, "")) : null,
      exp: /\$\s*[\d.]+/.test(exp) ? num(grab(exp, /\$\s*([\d.]+)/)) : null,
      m2: num(grab(feats, /(\d+(?:[.,]\d+)?)\s*m²/) ?? NaN) >= 8 ? num(grab(feats, /(\d+(?:[.,]\d+)?)\s*m²/)) : null, // <8 m² es un dato mal cargado
      amb: Number(grab(feats, /(\d+)\s*amb/)) || null,
      dir: txt(grab(c, /location-address[^>]*>(.*?)<\/h4>/s)),
      loc: txt(grab(c, /POSTING_CARD_LOCATION">(.*?)<\/h4>/s)),
      contrato: contratoMeses(txt(grab(c, /POSTING_CARD_DESCRIPTION">(.*?)<\/h2>/s))),
    };
  }).filter((x) => x.id);
}

// curl y no fetch: Cloudflare desafía al fetch de Node (huella TLS) pero sirve normal a curl, que viene con Windows.
async function bajar(ruta) {
  const url = ruta.startsWith("http") ? ruta : `https://www.zonaprop.com.ar/${ruta}.html`;
  const { stdout } = await run(process.platform === "win32" ? "curl.exe" : "curl", ["-s", "--max-time", "40", "-A", UA, "-w", "\n%{http_code}", url], { maxBuffer: 1 << 26, encoding: "utf8" });
  const i = stdout.lastIndexOf("\n"), code = stdout.slice(i + 1);
  if (code !== "200") throw new Error(`${code} en ${ruta}`); // 403/429: no insisto, paro esa búsqueda
  return stdout.slice(0, i);
}

async function relevar(db, hoy) {
  const vistos = new Set(), completas = [];
  let anteriorCompleta = false;
  for (const { tipo, zona, suf: amb } of BUSQUEDAS) {
    if (amb.endsWith("descendente") && anteriorCompleta) continue;
    const origen = `${tipo}/${zona}/${amb}`, propios = new Set();
    anteriorCompleta = false;
    try {
      let paginas = MAX_PAGINAS, totalAvisos = 0;
      for (let p = 1; p <= paginas; p++) {
        await new Promise((r) => setTimeout(r, PAUSA_MS));
        const html = await bajar(`${tipo}-alquiler-${zona}-${amb}${p > 1 ? `-pagina-${p}` : ""}`);
        // El título dice "892 Departamentos en alquiler...": con eso sé cuántas páginas hay y no pido de más.
        if (p === 1) { totalAvisos = num(grab(html, /<title>\s*([\d.]+)/) ?? 30); paginas = Math.min(MAX_PAGINAS, Math.ceil(totalAvisos / 30)); }
        const cards = parsePagina(html);
        const nuevos = cards.filter((c) => !propios.has(c.id));
        if (!nuevos.length) break; // pasó la última página
        for (const c of nuevos) {
          propios.add(c.id);
          if (!LOC_OK.test(c.loc) || vistos.has(c.id)) continue;
          vistos.add(c.id);
          // Sin total (no entra al ranking): precio en dólares, sin precio, temporarios o precios absurdos (por día).
          const total = c.usd || c.precio == null || c.precio < PISO || /temporari/.test(c.url) ? null : c.precio + (c.exp ?? 0);
          const it = (db.items[c.id] ??= { id: c.id, first: hoy, hist: [] });
          Object.assign(it, { ...c, origen, last: hoy, active: true, total, expMissing: c.exp == null });
          if (total != null && it.hist.at(-1)?.[1] !== total) it.hist.push([hoy, total]);
        }
      }
      anteriorCompleta = paginas * 30 >= totalAvisos;
      if (anteriorCompleta) completas.push(origen); // si quedó truncada no sé qué avisos faltan: no doy de baja nada
      console.log(`${origen}: ok`);
    } catch (e) { console.warn(`${origen}: incompleta (${e.message}); no doy de baja sus avisos`); }
  }
  // Un aviso que no apareció en una búsqueda completa ya no está publicado.
  // Los de búsquedas truncadas (muestras) no entran ahí: se dan de baja si hace más de 4 días que no aparecen.
  const corte = new Date(Date.parse(hoy) - 4 * 864e5).toISOString().slice(0, 10);
  for (const it of Object.values(db.items)) if ((completas.includes(it.origen) && !vistos.has(it.id)) || it.last < corte) it.active = false;
  return vistos.size;
}

// Una vez por aviso (y solo los que entran en el presupuesto), de mejor a peor oportunidad: pide su página para saber hace cuánto
// se publicó. Tope por corrida para no insistir; si el sitio rechaza un pedido, paro y sigo en la próxima corrida.
async function detalles(db, hoy, max) {
  const pend = Object.values(db.items).filter((i) => i.active && i.total != null && i.total <= TOPE && !i.detalle)
    .sort((a, b) => (b.desc ?? -999) - (a.desc ?? -999)).slice(0, max);
  let ok = 0, seguidos = 0;
  for (const it of pend) {
    await new Promise((r) => setTimeout(r, PAUSA_MS));
    try {
      const dias = diasPublicado(await bajar(it.url));
      it.detalle = true; ok++; seguidos = 0;
      if (ok % 20 === 0) fs.writeFileSync(DB, JSON.stringify(db)); // guardo el avance por si se corta
      if (dias != null) it.pub = new Date(Date.parse(hoy) - dias * 864e5).toISOString().slice(0, 10);
    } catch (e) { // un fallo suelto se salta; tres seguidos (bloqueo) cortan y queda para la próxima corrida
      console.warn(`Detalles: falló ${it.id} (${e.message.split("\n")[0].slice(0, 80)})`);
      if (++seguidos >= 3) break;
    }
  }
  console.log(`Detalles: ${ok} de ${pend.length} consultados.`);
}

const mediana =(a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// "Oportunidad" = cuánto más barato que la mediana de avisos comparables (misma cantidad de ambientes,
// mismo barrio si hay >=5, si no toda la zona). Compara $/m² si hay m², si no el total.
export function puntuar(items) {
  const act = items.filter((i) => i.active && i.total != null && i.amb);
  const med = (i, f) => {
    // Del más parecido al más amplio: mismo barrio, misma ciudad (Capital o GBA), todo. Nunca se mezcla Belgrano con Olivos si hay datos.
    const barrio = (x) => x.loc.match(CABA_RE)?.[0].toLowerCase().replace("ñ", "n") ?? x.loc, caba = (x) => CABA_RE.test(x.loc);
    for (const g of [act.filter((x) => x.amb === i.amb && barrio(x) === barrio(i)), act.filter((x) => x.amb === i.amb && caba(x) === caba(i)), act.filter((x) => x.amb === i.amb)]) {
      const v = g.map(f).filter(Number.isFinite);
      if (v.length >= 5) return mediana(v);
    }
  };
  for (const i of act) {
    const porM2 = i.m2 ? (x) => (x.m2 ? x.total / x.m2 : NaN) : (x) => x.total;
    const ref = med(i, porM2);
    i.desc = ref ? Math.round((1 - porM2(i) / ref) * 100) : null;
    i.ref = med(i, (x) => x.total) ?? null;
  }
}

async function main() {
  const hoy = new Date().toISOString().slice(0, 10);
  fs.mkdirSync("data", { recursive: true });
  const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : { items: {} };
  // --diario: para la tarea que corre al prender la PC; si ya se relevó hace poco, no vuelvo a pedir.
  if (process.argv.includes("--diario") && db.updated && Date.now() - new Date(db.updated) < 20 * 36e5) return console.log("Ya actualizado hoy.");
  const vistos = process.argv.includes("--solo-detalles") ? 1 : await relevar(db, hoy);
  if (!vistos) throw new Error("No se pudo bajar ningún aviso (¿bloqueo?): no toco los datos.");
  puntuar(Object.values(db.items));
  await detalles(db, hoy, Number(process.argv.find((a) => a.startsWith("--detalles="))?.slice(11) ?? MAX_DETALLES));
  db.updated = new Date().toISOString();
  fs.writeFileSync(DB, JSON.stringify(db));
  fs.writeFileSync("data.js", `window.TRACKER=${JSON.stringify({ updated: db.updated, tope: TOPE, items: Object.values(db.items).filter((i) => i.active && i.total != null) })};`);
  console.log(`Listo: ${Object.values(db.items).filter((i) => i.active).length} avisos activos.`);
}

if (process.argv.includes("--test")) {
  const html = `<x data-qa="posting PROPERTY" data-id="1" data-to-posting="/p/1.html"><h2 data-qa="POSTING_CARD_PRICE">$ 650.000</h2><h2 data-qa="expensas">$ 155.000 Expensas</h2><h3 data-qa="POSTING_CARD_FEATURES"><span>28 m² tot.</span><span>1 amb.</span></h3><h4 class="location-address">Calle 1</h4><h4 data-qa="POSTING_CARD_LOCATION">Olivos, Vicente López</h4>
  <x data-qa="posting PROPERTY" data-id="2" data-to-posting="/p/2.html"><h2 data-qa="POSTING_CARD_PRICE">USD 1.300</h2><h3 data-qa="POSTING_CARD_FEATURES"><span>2 amb.</span></h3><h4 data-qa="POSTING_CARD_LOCATION">Martínez, San Isidro</h4>`;
  const [a, b] = parsePagina(html);
  assert.deepEqual([a.precio, a.exp, a.m2, a.amb, a.usd, a.loc], [650000, 155000, 28, 1, false, "Olivos, Vicente López"]);
  assert.deepEqual([b.usd, b.exp, b.m2, b.amb], [true, null, null, 2]);
  assert.equal(a.url, "https://www.zonaprop.com.ar/p/1.html");
  assert.deepEqual(["Contrato por 18 meses, incremento", "honorarios, contrato 2 años, ajuste trimestral", "Ofrece 2 años de contrato", "ajuste cada 3 meses", "contrato dos años"].map(contratoMeses), [18, 24, 24, null, 24]);
  assert.deepEqual(["Publicado hace 70 días", "Publicado hoy", "Publicado hace 2 meses", "Publicado por múltiples"].map(diasPublicado), [70, 0, 60, null]);
  const mk = (id, total) => ({ id, active: true, total, amb: 1, m2: 30, loc: "Olivos" });
  const its = [1, 2, 3, 4, 5].map((n) => mk(n, 800_000)).concat(mk(9, 600_000));
  puntuar(its);
  assert.equal(its.at(-1).desc, 25);
  // Un aviso de Belgrano barato contra Belgrano, no contra el resto: 5 de $1.000.000 y uno de $800.000 en Belgrano; 5 de $500.000 en Olivos.
  const mix = [1, 2, 3, 4, 5].map((n) => ({ ...mk(n, 1_000_000), loc: "Belgrano, Capital Federal" })).concat({ ...mk(6, 800_000), loc: "Belgrano R, Belgrano" }, [7, 8, 9, 10, 11].map((n) => mk(n, 500_000)));
  puntuar(mix);
  assert.equal(mix[5].desc, 20);
  console.log("tests ok");
} else await main();
