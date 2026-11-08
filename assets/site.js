// ottoops.com: theme toggle, hero terrain, survey route, GitHub calendar.
// Every section is readable without this file; it only adds motion and data.
(() => {
  "use strict";

  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = !reduce.matches && "IntersectionObserver" in window;
  if (motion) root.classList.add("motion");

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
      })
      .catch(() => {
        /* the hero still reads as a plain sheet */
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
    const left = Math.max(10, w * 0.3);
    const right = Math.max(18, w * 0.62);
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
      if (w >= 60) {
        // Lettering follows the line, as on a map: rotated, reading up from the mark.
        const t = el("text", { x: 14, y: 3.5, transform: "rotate(-90)" });
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
      cell.title = `${n} on ${fmtDate(date)}`;
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
    key.innerHTML =
      `<span>Each square is one day. Busiest day: ${busiest[1]} on ${fmtDate(busiest[0])}.</span>` +
      `<span>Less <span class="ramp">${[0, 1, 2, 3, 4]
        .map((l) => `<i style="background:var(--cell-${l})"></i>`)
        .join("")}</span> More</span>`;

    cal.setAttribute("role", "img");
    cal.setAttribute(
      "aria-label",
      `GitHub contribution calendar, ${data.lastYearTotal.toLocaleString("en-US")} contributions in the year to ${fmtDate(data.generated)}.`
    );
    cal.append(months, grid, key);
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
    resizeTimer = window.setTimeout(buildRoute, 150);
  });
  window.addEventListener("load", buildRoute);
  if (document.fonts) document.fonts.ready.then(buildRoute);
})();
