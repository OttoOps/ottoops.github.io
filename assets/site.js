// ottoops.com: theme toggle, hero terrain and relief, survey route, career
// stops, GitHub calendar.
// Every section is readable without this file; it only adds motion and data.
(() => {
  "use strict";

  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = !reduce.matches && "IntersectionObserver" in window;
  if (motion) root.classList.add("motion");
  root.classList.add("js");

  const SVG = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  // ---- Theme toggle -------------------------------------------------------
  const toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    const label = toggle.querySelector("[data-theme-label]");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const current = () => root.dataset.theme || (dark.matches ? "dark" : "light");
    const paint = () => {
      const next = current() === "dark" ? "light" : "dark";
      label.textContent = next === "dark" ? "Dark" : "Light";
      toggle.setAttribute("aria-label", `Switch to ${next} theme`);
    };
    toggle.hidden = false;
    paint();
    toggle.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* storage blocked: the choice lasts for this page view */
      }
      paint();
    });
    dark.addEventListener("change", paint);
  }

  document.querySelectorAll("[data-print]").forEach((b) => {
    b.hidden = false;
    b.addEventListener("click", () => window.print());
  });

  document.querySelectorAll("[data-year]").forEach((n) => {
    n.textContent = String(new Date().getFullYear());
  });

  // ---- Hero terrain -------------------------------------------------------
  const terrain = document.querySelector("[data-terrain]");
  if (terrain) {
    fetch("/assets/terrain.svg")
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        terrain.innerHTML = text;
        const index = terrain.querySelectorAll(".c-index");
        index.forEach((p, i) => p.style.setProperty("--d", String((i % 23) * 60)));
        frameMap();
      })
      .catch(() => {
        /* the hero still reads as a plain sheet */
      });
  }

  // Corner coordinates and a scale bar for the part of the sheet in view. The
  // SVG is 512x384 Web Mercator units, cropped by preserveAspectRatio "slice".
  const VB_W = 512;
  const VB_H = 384;
  const MILE_KM = 1.609344;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const unmerc = (m) => (Math.atan(Math.sinh(m)) * 180) / Math.PI;
  const dms = (v, pos, neg) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.floor((a - d) * 60);
    let s = Math.round(((a - d) * 60 - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    const pad = (n) => String(n).padStart(2, "0");
    return `${d}\u00b0${pad(m)}\u2032${pad(s)}\u2033 ${v < 0 ? neg : pos}`;
  };
  // The part of the sheet in view: k is CSS pixels per SVG unit, (x0, y0) the
  // SVG point at the top left corner of the hero.
  let view = null;
  const frameMap = () => {
    if (!terrain || !terrain.dataset.bounds || !terrain.firstElementChild) return;
    const [n, s, w, e] = terrain.dataset.bounds.split(" ").map(Number);
    const cw = terrain.clientWidth;
    const ch = terrain.clientHeight;
    if (!cw || !ch) return;
    const k = Math.max(cw / VB_W, ch / VB_H);
    const x0 = (VB_W - cw / k) / 2;
    const y0 = (VB_H - ch / k) / 2;
    const lonAt = (x) => w + ((e - w) * x) / VB_W;
    const latAt = (y) => unmerc(merc(n) + ((merc(s) - merc(n)) * y) / VB_H);
    const top = latAt(y0);
    view = { k, x0, y0, cw, ch, lonAt, latAt };
    const corners = {
      nw: `${dms(top, "N", "S")}<br>${dms(lonAt(x0), "E", "W")}`,
      ne: `${dms(top, "N", "S")}<br>${dms(lonAt(VB_W - x0), "E", "W")}`,
    };
    document.querySelectorAll("[data-corner]").forEach((c) => {
      c.innerHTML = corners[c.dataset.corner] || "";
    });
    // Ground distance per SVG unit at the sheet's mid latitude.
    const kmPerUnit = ((e - w) * 111.32 * Math.cos(((n + s) * Math.PI) / 360)) / VB_W;
    const bar = document.querySelector("[data-scalebar]");
    if (bar) {
      bar.style.width = `${((2 * MILE_KM) / kmPerUnit) * k}px`;
      bar.hidden = false;
    }
    if (relief) relief.resize();
  };

  // ---- Shaded relief, pointer readout and spot elevations -------------------
  // The elevation grid is real 3DEP data: 256x192 cells of whole feet, stored
  // as gzipped int16 deltas. Shading is computed from it on a small canvas and
  // scaled up, so turning the light costs well under a millisecond.
  const DEM_W = 256;
  const DEM_H = 192;
  const SUN_HOME = { az: 315, alt: 45 };
  let relief = null;

  const gunzip = async (buf) => {
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] !== 0x1f || head[1] !== 0x8b) return buf; // already decoded in transit
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  };

  const buildRelief = (map, feet) => {
    const [bn, bs, bw, be] = terrain.dataset.bounds.split(" ").map(Number);
    const midLat = ((bn + bs) * Math.PI) / 360;
    const cellFt = (((be - bw) * 111320 * Math.cos(midLat)) / DEM_W) * 3.28084;
    const EXAGGERATE = 1.5;
    const nx = new Float32Array(DEM_W * DEM_H);
    const ny = new Float32Array(DEM_W * DEM_H);
    const nz = new Float32Array(DEM_W * DEM_H);
    const at = (x, y) =>
      feet[Math.min(DEM_H - 1, Math.max(0, y)) * DEM_W + Math.min(DEM_W - 1, Math.max(0, x))];
    for (let y = 0; y < DEM_H; y++) {
      for (let x = 0; x < DEM_W; x++) {
        const dx = ((at(x + 1, y) - at(x - 1, y)) / (2 * cellFt)) * EXAGGERATE;
        const dy = ((at(x, y + 1) - at(x, y - 1)) / (2 * cellFt)) * EXAGGERATE;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const i = y * DEM_W + x;
        nx[i] = -dx * inv;
        ny[i] = -dy * inv;
        nz[i] = inv;
      }
    }

    const small = document.createElement("canvas");
    small.width = DEM_W;
    small.height = DEM_H;
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(DEM_W, DEM_H);
    const canvas = document.createElement("canvas");
    canvas.className = "map-relief";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    map.insertBefore(canvas, terrain);

    const marks = document.createElement("div");
    marks.className = "map-marks";
    marks.setAttribute("aria-hidden", "true");
    const hair = document.createElement("div");
    hair.className = "map-hair";
    marks.append(hair);
    terrain.after(marks);

    const read = document.createElement("p");
    read.className = "map-read lettering";
    read.setAttribute("aria-hidden", "true");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const idle = () =>
      fine.matches
        ? "Move over the map to read the ground and turn the light. Click to mark a spot."
        : "Tap the map to read the ground and turn the light.";
    read.textContent = idle();
    map.querySelector(".map-credit").before(read);

    const sun = { ...SUN_HOME };
    const goal = { ...SUN_HOME };
    let raf = 0;
    let dark = false;

    const paint = () => {
      const az = (sun.az * Math.PI) / 180;
      const alt = (sun.alt * Math.PI) / 180;
      // Light direction in grid space: x east, y south, z up.
      const lx = Math.sin(az) * Math.cos(alt);
      const ly = -Math.cos(az) * Math.cos(alt);
      const lz = Math.sin(alt);
      const d = img.data;
      // Shadows print in a warm brown, like a relief plate under the contours;
      // lit slopes lift toward paper white. The dark sheet leans on the lights.
      const sr = dark ? 0 : 96;
      const sg = dark ? 0 : 74;
      const sb = dark ? 0 : 56;
      const shadeK = dark ? 300 : 240;
      const shadeMax = dark ? 120 : 104;
      const lightK = dark ? 110 : 200;
      const lightMax = dark ? 30 : 170;
      for (let i = 0, p = 0; i < nx.length; i++, p += 4) {
        const v = nx[i] * lx + ny[i] * ly + nz[i] * lz - lz;
        if (v < 0) {
          d[p] = sr;
          d[p + 1] = sg;
          d[p + 2] = sb;
          d[p + 3] = Math.min(shadeMax, -v * shadeK);
        } else {
          d[p] = dark ? 232 : 255;
          d[p + 1] = dark ? 226 : 255;
          d[p + 2] = dark ? 206 : 250;
          d[p + 3] = Math.min(lightMax, v * lightK);
        }
      }
      sctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!view) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const u = DEM_W / VB_W;
      ctx.drawImage(
        small,
        view.x0 * u, view.y0 * u, (view.cw / view.k) * u, (view.ch / view.k) * u,
        0, 0, canvas.width, canvas.height
      );
    };

    const step = () => {
      raf = 0;
      let turn = ((goal.az - sun.az + 540) % 360) - 180;
      const lift = goal.alt - sun.alt;
      if (Math.abs(turn) < 0.3 && Math.abs(lift) < 0.3) {
        sun.az = goal.az;
        sun.alt = goal.alt;
      } else {
        sun.az = (sun.az + turn * 0.14 + 360) % 360;
        sun.alt += lift * 0.14;
        raf = requestAnimationFrame(step);
      }
      paint();
    };
    const aim = (az, alt) => {
      goal.az = az;
      goal.alt = alt;
      if (reduce.matches) return; // the light stays put; readouts still work
      if (!raf) raf = requestAnimationFrame(step);
    };

    const elevation = (vx, vy) => {
      const gx = Math.min(DEM_W - 1.001, Math.max(0, (vx * DEM_W) / VB_W - 0.5));
      const gy = Math.min(DEM_H - 1.001, Math.max(0, (vy * DEM_H) / VB_H - 0.5));
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const a = feet[iy * DEM_W + ix] * (1 - fx) + feet[iy * DEM_W + ix + 1] * fx;
      const b = feet[(iy + 1) * DEM_W + ix] * (1 - fx) + feet[(iy + 1) * DEM_W + ix + 1] * fx;
      return Math.round((a * (1 - fy) + b * fy) / 10) * 10;
    };
    const ft = (n) => `${n.toLocaleString("en-US")} ft`;

    const locate = (e) => {
      const box = terrain.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      if (!view || px < 0 || py < 0 || px > box.width || py > box.height) return null;
      const vx = view.x0 + px / view.k;
      const vy = view.y0 + py / view.k;
      return { px, py, vx, vy, w: box.width, h: box.height };
    };
    const point = (e) => {
      const at = locate(e);
      if (!at) return null;
      hair.style.transform = `translate(${at.px}px, ${at.py}px)`;
      marks.classList.add("is-live");
      read.textContent =
        `${dms(view.latAt(at.vy), "N", "S")}  ${dms(view.lonAt(at.vx), "E", "W")}` +
        `  \u00b7  ${ft(elevation(at.vx, at.vy))}`;
      // The light comes from the pointer's side of the sheet, lower toward the edge.
      const dx = at.px / at.w - 0.5;
      const dy = at.py / at.h - 0.5;
      const reach = Math.min(1, Math.hypot(dx, dy) * 2);
      aim((Math.atan2(dx, -dy) * 180) / Math.PI + 360, 62 - reach * 40);
      return at;
    };

    const spots = [];
    const placeSpots = () => {
      for (const sp of spots) {
        sp.node.style.transform =
          `translate(${(sp.vx - view.x0) * view.k}px, ${(sp.vy - view.y0) * view.k}px)`;
      }
    };
    const drop = (at) => {
      const node = document.createElement("span");
      node.className = "map-spot";
      node.textContent = elevation(at.vx, at.vy).toLocaleString("en-US");
      marks.append(node);
      spots.push({ node, vx: at.vx, vy: at.vy });
      if (spots.length > 16) spots.shift().node.remove();
      placeSpots();
    };

    map.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") point(e);
    });
    map.addEventListener("pointerleave", () => {
      marks.classList.remove("is-live");
      read.textContent = idle();
      aim(SUN_HOME.az, SUN_HOME.alt);
    });
    map.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      if (String(window.getSelection())) return;
      const at = point(e);
      if (at) drop(at);
    });

    const theme = () => {
      dark = (root.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
      paint();
    };
    new MutationObserver(theme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);

    const resize = () => {
      if (!view) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(view.cw * dpr * 0.5);
      canvas.height = Math.round(view.ch * dpr * 0.5);
      placeSpots();
      paint();
    };
    resize();
    theme();
    requestAnimationFrame(() => canvas.classList.add("is-in"));
    return { resize };
  };

  const heroMap = terrain && terrain.closest(".map");
  if (heroMap && "DecompressionStream" in window) {
    fetch("/assets/terrain-dem.bin.gz")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then(gunzip)
      .then((buf) => {
        const deltas = new Int16Array(buf);
        if (deltas.length !== DEM_W * DEM_H) return;
        const feet = new Float32Array(deltas.length);
        let run = 0;
        for (let i = 0; i < deltas.length; i++) feet[i] = run += deltas[i];
        const start = () => {
          if (!view) return window.setTimeout(start, 120);
          relief = buildRelief(heroMap, feet);
        };
        start();
      })
      .catch(() => {
        /* the contour plate stands on its own */
      });
  }

  // ---- Reveals: mark sections once the route reaches them -------------------
  const reached = new Set();
  if (motion) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-reached");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -30% 0px" }
    );
    document.querySelectorAll(".leg, [data-reveal]").forEach((n) => io.observe(n));
  } else {
    document.querySelectorAll(".leg, [data-reveal]").forEach((n) => n.classList.add("is-reached"));
  }

  // ---- Survey route down the left margin ------------------------------------
  const wrap = document.querySelector("[data-route-wrap]");
  const host = document.querySelector("[data-route]");
  let route = null;

  const buildRoute = () => {
    if (!wrap || !host) return;
    host.textContent = "";
    const w = host.clientWidth;
    const h = wrap.clientHeight;
    const legs = [...wrap.querySelectorAll(".leg")];
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const left = Math.max(10, w * 0.18);
    const right = Math.max(18, w * 0.82);
    const pts = legs.map((leg, i) => {
      const heading = leg.querySelector("h2");
      const y = heading.getBoundingClientRect().top + window.scrollY - top + heading.offsetHeight / 2;
      return { x: i % 2 ? right : left, y, leg };
    });
    let d = `M${left} 0`;
    let prev = { x: left, y: 0 };
    for (const p of [...pts, { x: left, y: h }]) {
      const mid = (prev.y + p.y) / 2;
      d += ` C${prev.x} ${mid} ${p.x} ${mid} ${p.x} ${p.y}`;
      prev = p;
    }
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none" });
    svg.append(el("path", { class: "planned", d }));
    const walked = el("path", { class: "walked", d });
    svg.append(walked);
    const len = walked.getTotalLength();
    walked.style.strokeDasharray = `${len}`;
    walked.style.strokeDashoffset = `${len}`;

    // Map scroll depth to path length by sampling the path.
    const samples = [];
    for (let i = 0; i <= 240; i++) {
      const l = (len * i) / 240;
      samples.push([walked.getPointAtLength(l).y, l]);
    }
    const marks = pts.map((p) => {
      const g = el("g", { class: "bm", transform: `translate(${p.x} ${p.y})` });
      g.append(el("path", { d: "M0 -7L6.5 4.5H-6.5Z" }));
      g.append(el("circle", { cx: 0, cy: 0.5, r: 1.6 }));
      if (w >= 60) {
        // Lettering follows the line, as on a map: rotated, reading up from the
        // mark, set beside the stroke on the side with more room.
        const side = p.x > w / 2 ? -11 : 20;
        const t = el("text", { x: 14, y: side, transform: "rotate(-90)" });
        t.textContent = (p.leg.dataset.label || "").toUpperCase();
        g.append(t);
      }
      svg.append(g);
      return { g, y: p.y };
    });
    host.append(svg);
    route = { walked, len, samples, marks, top };
    update();
  };

  const lengthAt = (y) => {
    const s = route.samples;
    if (y <= s[0][0]) return 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i][0] >= y) {
        const [y0, l0] = s[i - 1];
        const [y1, l1] = s[i];
        return l0 + ((l1 - l0) * (y - y0)) / Math.max(1, y1 - y0);
      }
    }
    return route.len;
  };

  let ticking = false;
  const update = () => {
    ticking = false;
    if (!route) return;
    if (!motion) {
      route.walked.style.strokeDashoffset = "0";
      route.marks.forEach((m) => m.g.classList.add("is-reached"));
      return;
    }
    const depth = window.scrollY + window.innerHeight * 0.6 - route.top;
    route.walked.style.strokeDashoffset = String(route.len - lengthAt(depth));
    for (const m of route.marks) m.g.classList.toggle("is-reached", depth >= m.y);
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  // ---- Career stops: each one opens its record ------------------------------
  const survey = document.querySelector(".survey");
  if (survey) {
    const stops = [...survey.querySelectorAll("li[data-role]")];
    const narrow = window.matchMedia("(max-width: 860px)");
    const card = document.createElement("div");
    card.className = "stop-card";
    card.setAttribute("aria-live", "polite");
    let chosen = null;
    const seat = () => {
      if (narrow.matches && chosen) chosen.append(card);
      else (document.querySelector(".survey-axis") || survey).after(card);
    };
    const choose = (li) => {
      chosen = li;
      stops.forEach((s) => {
        const on = s === li;
        s.classList.toggle("is-chosen", on);
        s.querySelector("button").setAttribute("aria-pressed", String(on));
      });
      const d = li.dataset;
      card.innerHTML = "";
      const head = document.createElement("p");
      head.className = "stop-head";
      const name = document.createElement("b");
      name.textContent = li.querySelector("b").textContent;
      const role = document.createElement("span");
      role.textContent = `${d.role}, ${d.dates}`;
      head.append(name, role);
      card.append(head);
      if (d.note) {
        const note = document.createElement("p");
        note.textContent = d.note;
        card.append(note);
      }
      seat();
      buildRoute();
    };
    stops.forEach((li) => {
      const tag = li.querySelector(".tag");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stop-btn";
      btn.append(...tag.childNodes);
      tag.append(btn);
      btn.addEventListener("click", () => choose(li));
    });
    narrow.addEventListener("change", seat);
    if (stops.length) choose(stops[stops.length - 1]);
  }

  // ---- GitHub contribution calendar -----------------------------------------
  const cal = document.querySelector("[data-calendar]");
  const fmtDate = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

  const renderCalendar = (data) => {
    const days = data.days;
    const max = Math.max(...days.map((d) => d[1]));
    const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((Math.log(n) / Math.log(max + 1)) * 4)));
    const first = new Date(`${days[0][0]}T12:00:00Z`).getUTCDay();
    const months = document.createElement("div");
    months.className = "cal-months lettering";
    months.setAttribute("aria-hidden", "true");
    const grid = document.createElement("div");
    grid.className = "cal-grid";
    grid.setAttribute("aria-hidden", "true");
    for (let i = 0; i < first; i++) {
      const pad = document.createElement("i");
      pad.style.visibility = "hidden";
      grid.append(pad);
    }
    let lastMonth = -1;
    const cols = Math.ceil((days.length + first) / 7);
    const monthCells = Array.from({ length: cols }, () => document.createElement("span"));
    days.forEach(([date, n], idx) => {
      const cell = document.createElement("i");
      const col = Math.floor((idx + first) / 7);
      cell.dataset.l = String(level(n));
      cell.style.setProperty("--c", String(col));
      cell.dataset.i = String(idx);
      grid.append(cell);
      const m = new Date(`${date}T12:00:00Z`).getUTCMonth();
      if (m !== lastMonth && (idx + first) % 7 === 0) {
        monthCells[col].textContent = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        });
        if (m % 3 === 0) monthCells[col].dataset.q = "";
        lastMonth = m;
      }
    });
    months.append(...monthCells);
    months.style.gridTemplateColumns = grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    const key = document.createElement("figcaption");
    key.className = "cal-key";
    const busiest = days.reduce((a, b) => (b[1] > a[1] ? b : a));
    const rest = `Each square is one day. Busiest day: ${busiest[1]} on ${fmtDate(busiest[0])}.`;
    key.innerHTML =
      `<span data-cal-read>${rest}</span>` +
      `<span>Less <span class="ramp">${[0, 1, 2, 3, 4]
        .map((l) => `<i style="background:var(--cell-${l})"></i>`)
        .join("")}</span> More</span>`;

    cal.setAttribute("role", "img");
    cal.setAttribute(
      "aria-label",
      `GitHub contribution calendar, ${data.lastYearTotal.toLocaleString("en-US")} contributions in the year to ${fmtDate(data.generated)}.`
    );
    cal.append(months, grid, key);

    // Point at a day to read it; the line falls back to the busiest day.
    const readLine = key.querySelector("[data-cal-read]");
    let held = null;
    const show = (cell) => {
      if (held) held.classList.remove("is-read");
      held = cell;
      if (!cell) {
        readLine.textContent = rest;
        return;
      }
      cell.classList.add("is-read");
      const [date, n] = days[Number(cell.dataset.i)];
      readLine.textContent = `${n.toLocaleString("en-US")} ${n === 1 ? "contribution" : "contributions"} on ${fmtDate(date)}.`;
    };
    const pick = (e) => {
      const cell = e.target.closest("i[data-i]");
      if (cell) show(cell);
    };
    grid.addEventListener("pointerover", pick);
    grid.addEventListener("click", pick);
    grid.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "touch") show(null);
    });
    document.querySelectorAll("[data-gh-total]").forEach((n) => {
      n.textContent = data.lastYearTotal.toLocaleString("en-US");
    });
    document.querySelectorAll("[data-gh-date]").forEach((n) => {
      n.textContent = fmtDate(data.generated);
    });
    buildRoute();
  };

  if (cal) {
    fetch("/assets/github.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(renderCalendar)
      .catch(() => {
        cal.innerHTML =
          '<p>The contribution snapshot did not load. My <a href="https://github.com/potto007">GitHub profile</a> has the same data.</p>';
      });
  }

  // ---- Wire up --------------------------------------------------------------
  buildRoute();
  window.addEventListener("scroll", onScroll, { passive: true });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      buildRoute();
      frameMap();
    }, 150);
  });
  window.addEventListener("load", buildRoute);
  if (document.fonts) document.fonts.ready.then(buildRoute);
})();
