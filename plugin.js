/// <reference path="./kino.d.ts" />
//
// Plugin de Kino para pelispanda.org ("Hacktorrent" / tema wpreact).
// Fuente: wp-json/wpreact/v1 (películas, series, animes, búsqueda, categorías).
// Reproducción: los enlaces del sitio son "embeds" (reproductores externos) que
// arman la URL del video con scripts. Se resuelven con kino.browser.capture y,
// cuando el embed ya trae la URL plana, con un kino.fetch barato.
//
// search / home / browse leen la API; episodes arma temporadas y capítulos
// desde el endpoint /related; resolve saca el stream del embed y ofrece los
// demás servidores como copias perezosas en el menú "Servidor".

const BASE = "https://pelispanda.org";
const API = BASE + "/wp-json/wpreact/v1/";
const IMG = "https://image.tmdb.org/t/p/";
const UA =
  "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

// El sitio filtra por NOMBRE de genero/idioma. Usamos claves ASCII en los refs
// (mas seguras al viajar por la app) y aqui las convertimos al termino real.
const GENRES = {
  accion: "Acci\u00f3n",
  terror: "Terror",
  comedia: "Comedia",
  drama: "Drama",
  animacion: "Animaci\u00f3n",
  aventura: "Aventura",
  cienciaficcion: "Ciencia ficci\u00f3n",
  suspenso: "Suspense",
  romance: "Romance",
  familia: "Familia"
};
const LANGS = {
  latino: "Latino",
  castellano: "Castellano",
  subtitulado: "Subtitulado",
  ingles: "Ingles"
};

function genreName(key) {
  return GENRES[key] || key;
}
function langTerm(key) {
  return LANGS[key] || key;
}

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

function buildQuery(params) {
  const parts = [];
  for (const k in params) {
    const v = params[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

async function api(path, params) {
  const url = API + path + buildQuery(params || {});
  const r = await kino.fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    timeoutMs: 15000
  });
  if (!r.ok) throw kino.error("unavailable", "pelispanda respondio " + r.status);
  return r.json();
}

function stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absImg(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (s.indexOf("//") === 0) s = "https:" + s;
  else if (s.charAt(0) === "/") s = IMG + "w500" + s;
  s = s.replace(/^http:\/\//i, "https://");
  // el sitio a veces devuelve ".../t/p/w300//poster.jpg"
  s = s.replace(/(\/t\/p\/[^\/]+)\/\//, "$1/");
  return s;
}

function parseRuntime(v) {
  if (!v) return undefined;
  const m = String(v).match(/(\d+)\s*m/i);
  if (m) return Math.min(1000, Math.max(1, parseInt(m[1], 10)));
  const h = String(v).match(/(\d+)\s*h/i);
  if (h) return Math.min(1000, Math.max(1, parseInt(h[1], 10) * 60));
  return undefined;
}

function kindOf(x) {
  const t = String(x.type || "").toLowerCase();
  if (t.indexOf("serie") === 0 || t.indexOf("anime") === 0) return "series";
  return "movie";
}

function prefixOf(x) {
  const t = String(x.type || "").toLowerCase();
  if (t.indexOf("anime") === 0) return "a:";
  if (t.indexOf("serie") === 0) return "s:";
  return "m:";
}

function toItem(x) {
  if (!x || !x.slug || !x.title) return null;
  const item = {
    id: String(x.id),
    ref: prefixOf(x) + String(x.slug),
    title: stripTags(x.title).slice(0, 200),
    kind: kindOf(x)
  };
  const poster = absImg(x.featured || x.poster || x.image);
  if (poster) item.poster = poster;
  const backdrop = absImg(x.background_image || x.backdrop);
  if (backdrop) item.backdrop = backdrop;
  const overview = stripTags(x.overview);
  if (overview) item.overview = overview.slice(0, 2000);
  const year = String(x.year || (x.years ? String(x.years).slice(0, 4) : "")).slice(0, 10);
  if (year) item.year = year;
  const rating = parseFloat(x.imdb);
  if (isFinite(rating) && rating > 0 && rating <= 10) item.rating = rating;
  const rt = parseRuntime(x.duracion);
  if (rt) item.runtimeMinutes = rt;
  const tmdb = parseInt(x.tmdb_id, 10);
  if (tmdb > 0) item.ids = { tmdb: tmdb };
  if (x.genres) {
    const g = String(x.genres)
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .slice(0, 5)
      .map(function (s) {
        return s.slice(0, 30);
      });
    if (g.length) item.genres = g;
  }
  const lang = stripTags(x.language).slice(0, 20);
  if (lang) item.lang = lang;
  return item;
}

function itemsOf(data, key) {
  const arr = (data && data[key]) || [];
  return arr.map(toItem).filter(Boolean);
}

function toPage(items, page, totalPages) {
  if (items.length && totalPages && page < totalPages) {
    return { items: items, next: String(page + 1) };
  }
  return { items: items };
}

function hostOf(u) {
  const m = String(u || "").match(/^[a-z]+:\/\/([^\/]+)/i);
  return m ? m[1].replace(/^www\./i, "") : "";
}

function labelFor(e) {
  const parts = [];
  if (e.lang) parts.push(String(e.lang));
  if (e.quality) parts.push(String(e.quality));
  parts.push(hostOf(e.url));
  return parts
    .join(" \u00b7 ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 48);
}

/* ------------------------------------------------------------------ */
/* búsqueda, inicio y navegación                                       */
/* ------------------------------------------------------------------ */

export async function search(query) {
  const text = String((query && query.q) || "").trim();
  if (!text) return [];
  const page = Math.max(1, parseInt(query.cursor, 10) || 1);
  const data = await api("search", { query: text, posts_per_page: 40, page: page });
  const items = itemsOf(data, "results");
  const totalPages = parseInt(data.pages, 10) || 0;
  return toPage(items, page, totalPages);
}

export async function home() {
  const rows = [
    { id: "peli-destacadas", title: "Destacadas", path: "slider", key: "slider", params: {}, ref: "browse:released", genre: "peliculas" },
    { id: "peli-peliculas", title: "Pel\u00edculas", path: "movies", key: "movies", params: { posts_per_page: 24, page: 1 }, ref: "browse:movies", genre: "peliculas" },
    { id: "peli-series", title: "Series", path: "series", key: "series", params: { posts_per_page: 24, page: 1 }, ref: "browse:series", genre: "series" },
    { id: "peli-animes", title: "Animes", path: "animes", key: "animes", params: { posts_per_page: 24, page: 1 }, ref: "browse:animes", genre: "anime" },
    { id: "peli-estrenos", title: "Estrenos", path: "released", key: "movies", params: {}, ref: "browse:released", genre: "peliculas" },
    { id: "peli-accion", title: "Acci\u00f3n", path: "category", key: "results", params: { category: genreName("accion"), posts_per_page: 24, page: 1 }, ref: "cat:accion", genre: "peliculas" },
    { id: "peli-terror", title: "Terror", path: "category", key: "results", params: { category: genreName("terror"), posts_per_page: 24, page: 1 }, ref: "cat:terror", genre: "peliculas" },
    { id: "peli-comedia", title: "Comedia", path: "category", key: "results", params: { category: genreName("comedia"), posts_per_page: 24, page: 1 }, ref: "cat:comedia", genre: "peliculas" },
    { id: "peli-latino", title: "Latino", path: "language", key: "results", params: { language: langTerm("latino"), posts_per_page: 24, page: 1 }, ref: "lang:latino", genre: "peliculas" }
  ];
  const data = await Promise.all(
    rows.map(function (r) {
      return api(r.path, r.params).catch(function () {
        return null;
      });
    })
  );
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const items = itemsOf(data[i], rows[i].key);
    if (items.length) {
      out.push({ id: rows[i].id, title: rows[i].title, ref: rows[i].ref, genre: rows[i].genre, items: items.slice(0, 60) });
    }
  }
  return out;
}

export async function browse(ref, cursor) {
  const r = String(ref || "");
  const page = Math.max(1, parseInt(cursor, 10) || 1);
  if (r.indexOf("cat:") === 0) {
    const d = await api("category", { category: genreName(r.slice(4)), posts_per_page: 40, page: page });
    return toPage(itemsOf(d, "results"), page, parseInt(d.pages, 10) || 0);
  }
  if (r.indexOf("lang:") === 0) {
    const d = await api("language", { language: langTerm(r.slice(5)), posts_per_page: 40, page: page });
    return toPage(itemsOf(d, "results"), page, parseInt(d.pages, 10) || 0);
  }
  const name = r.replace(/^browse:/, "");
  if (name === "movies") {
    const d = await api("movies", { posts_per_page: 40, page: page });
    return toPage(itemsOf(d, "movies"), page, parseInt(d.pages, 10) || 0);
  }
  if (name === "series") {
    const d = await api("series", { posts_per_page: 40, page: page });
    return toPage(itemsOf(d, "series"), page, parseInt(d.pages, 10) || 0);
  }
  if (name === "animes") {
    const d = await api("animes", { posts_per_page: 40, page: page });
    return toPage(itemsOf(d, "animes"), page, parseInt(d.pages, 10) || 0);
  }
  if (name === "released") {
    const d = await api("released", {});
    return { items: itemsOf(d, "movies") };
  }
  return { items: [] };
}

/* ------------------------------------------------------------------ */
/* capítulos                                                           */
/* ------------------------------------------------------------------ */

function seriesKey(ref) {
  const p = String(ref || "");
  if (p.indexOf("a:") === 0) return { key: "anime", prefix: "a", slug: p.slice(2) };
  if (p.indexOf("s:") === 0) return { key: "serie", prefix: "s", slug: p.slice(2) };
  return null;
}

function seriesInfo(det) {
  if (!det || !det.title) return null;
  const info = { title: stripTags(det.title).slice(0, 200) };
  const poster = absImg(det.featured);
  if (poster) info.poster = poster;
  const backdrop = absImg(det.background_image);
  if (backdrop) info.backdrop = backdrop;
  const overview = stripTags(det.overview);
  if (overview) info.overview = overview.slice(0, 2000);
  if (det.genres) {
    const g = String(det.genres)
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .slice(0, 5)
      .map(function (s) {
        return s.slice(0, 30);
      });
    if (g.length) info.genres = g;
  }
  const year = String(det.year || "").slice(0, 10);
  if (year) info.year = year;
  const tmdb = parseInt(det.tmdb_id, 10);
  if (tmdb > 0) info.ids = { tmdb: tmdb };
  return info;
}

export async function episodes(ref) {
  const info = seriesKey(ref);
  if (!info) return { episodes: [] };
  const rel = await api(info.key + "/" + info.slug + "/related", {});

  const seen = {};
  const list = [];
  const push = function (s, n) {
    s = parseInt(s, 10) || 1;
    n = parseInt(n, 10) || 0;
    if (n < 1 || n > 99999) return;
    if (s < 1 || s > 999) s = 1;
    const k = s + "-" + n;
    if (seen[k]) return;
    seen[k] = true;
    list.push({ season: s, number: n });
  };
  (rel.downloads || []).forEach(function (d) {
    push(d.season, d.episode);
  });
  (rel.embeds || []).forEach(function (d) {
    push(d.season, d.episode);
  });
  list.sort(function (a, b) {
    return a.season - b.season || a.number - b.number;
  });

  const out = {
    episodes: list.map(function (e) {
      return {
        season: e.season,
        number: e.number,
        ref: "e:" + info.prefix + ":" + info.slug + ":" + e.season + ":" + e.number
      };
    })
  };

  try {
    const det = await api(info.key + "/" + info.slug, {});
    const s = seriesInfo(det);
    if (s) out.series = s;
  } catch (e) {}

  return out;
}

/* ------------------------------------------------------------------ */
/* reproducción                                                        */
/* ------------------------------------------------------------------ */

function orderEmbeds(list) {
  const score = function (e) {
    let v = 0;
    const lang = String(e.lang || "").toLowerCase();
    if (/latino|latin|espa|spanish|\bes\b/.test(lang)) v += 100;
    const q = String(e.quality || "").toLowerCase();
    if (/2160|4k/.test(q)) v += 30;
    else if (/1080/.test(q)) v += 20;
    else if (/720/.test(q)) v += 10;
    if (/dual/.test(q)) v += 5;
    return v;
  };
  return list.slice().sort(function (a, b) {
    return score(b) - score(a);
  });
}

async function loadEmbeds(baseRef) {
  const r = String(baseRef || "");
  if (r.indexOf("m:") === 0) {
    const rel = await api("movie/" + r.slice(2) + "/related", {});
    return orderEmbeds(rel.embeds || []);
  }
  if (r.indexOf("e:") === 0) {
    const p = r.split(":");
    const key = p[1] === "a" ? "anime" : "serie";
    const season = parseInt(p[p.length - 2], 10);
    const episode = parseInt(p[p.length - 1], 10);
    const slug = p.slice(2, p.length - 2).join(":");
    const rel = await api(key + "/" + slug + "/related", {});
    const embeds = (rel.embeds || []).filter(function (e) {
      return Number(e.season) === season && Number(e.episode) === episode;
    });
    return orderEmbeds(embeds);
  }
  return [];
}

async function streamFromEmbed(url) {
  // 1) camino barato: leer el embed y buscar la URL plana del video
  try {
    const r = await kino.fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        Referer: BASE + "/",
        "User-Agent": UA
      },
      timeoutMs: 12000
    });
    if (r.ok) {
      const text = r.text().replace(/\\\//g, "/");
      const m = text.match(/https?:\/\/[^\s"'\\)<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\)<>]*)?/i);
      if (m) {
        return { url: m[0], headers: { Referer: url, "User-Agent": UA } };
      }
    }
  } catch (e) {}

  // 2) navegador oculto: ejecuta la página y captura la petición de video
  const page = await kino.browser.capture(url, {
    headers: { Referer: BASE + "/" },
    timeoutMs: 20000
  });
  const media = (page && page.media) || [];
  if (!media.length) throw kino.error("unavailable", "sin video en " + hostOf(url));
  const first = media[0];
  const stream = { url: first.url };
  if (first.headers) stream.headers = first.headers;
  if (first.mime && /^video\//i.test(first.mime)) stream.mime = first.mime;
  const extra = [];
  for (let i = 1; i < media.length && extra.length < 7; i++) {
    const o = { url: media[i].url };
    if (media[i].headers) o.headers = media[i].headers;
    if (media[i].mime && /^video\//i.test(media[i].mime)) o.mime = media[i].mime;
    extra.push(o);
  }
  if (extra.length) stream.alternatives = extra;
  const subs = [];
  (page.subtitles || []).forEach(function (s) {
    if (subs.length < 10 && s && s.url) subs.push({ url: s.url, lang: "es" });
  });
  if (subs.length) stream.subtitles = subs;
  return stream;
}

export async function resolve(ref, options) {
  const r = String(ref || "");

  // copia perezosa: "<ref base>|<indice>"
  const bar = r.indexOf("|");
  if (bar !== -1) {
    const base = r.slice(0, bar);
    const idx = parseInt(r.slice(bar + 1), 10) || 0;
    const embeds = await loadEmbeds(base);
    const e = embeds[idx];
    if (!e) throw kino.error("not_found", "copia no encontrada");
    return await streamFromEmbed(e.url);
  }

  const embeds = await loadEmbeds(r);
  if (!embeds.length) {
    throw kino.error("not_found", "sin fuentes", {
      userMessage: "Este t\u00edtulo no tiene reproducci\u00f3n en l\u00ednea."
    });
  }

  let lastErr = null;
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    try {
      const stream = await streamFromEmbed(e.url);
      const alts = [];
      for (let j = 0; j < embeds.length && alts.length < 8; j++) {
        if (j === i) continue;
        alts.push({ label: labelFor(embeds[j]), ref: r + "|" + j });
      }
      stream.label = labelFor(e);
      if (alts.length) stream.alternatives = alts;
      return stream;
    } catch (err) {
      lastErr = err;
      if (err && err.code === "browser_unavailable") throw err;
    }
  }
  throw lastErr || kino.error("unavailable", "sin reproducci\u00f3n");
}
