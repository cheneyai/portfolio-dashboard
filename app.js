/* 资产配置看板 — client-side portfolio with localStorage + live-ish prices */
(function () {
  "use strict";

  const PASSCODE = "88888888";
  const GATE_KEY = "portfolio_unlocked_v1";
  const STORE_KEY = "portfolio_holdings_v1";
  const COLORS = ["#3d8bfd", "#00c853", "#ffb300", "#7c5cff"];
  const CN_NAMES = ["沪深A500", "科创A50", "恒生科技"];

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const fmtUSD = (n, digits = 2) => {
    if (n == null || !Number.isFinite(n)) return "—";
    return (
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    );
  };
  const fmtPct = (n) => {
    if (n == null || !Number.isFinite(n)) return "—";
    return (n * 100).toFixed(1) + "%";
  };
  const fmtNum = (n, digits = 4) => {
    if (n == null || !Number.isFinite(n)) return "";
    return String(n);
  };
  const uid = () =>
    "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* ---------- State ---------- */
  let state = {
    us: [], // {id, ticker, qty, price, example?, manualPrice?}
    cn: [], // {id, name, cny, example?}
    crypto: [], // {id, symbol, qty, price, example?}
    cash: [], // {id, label, usd, example?}
    usdCny: null,
    btcUsd: null,
    priceMeta: { stocks: "—", fx: "—", btc: "—" },
  };
  let chart = null;
  let quotesCache = { stocks: {} };

  function defaultState() {
    return {
      us: [
        {
          id: uid(),
          ticker: "AAPL",
          qty: 10,
          price: null,
          example: true,
        },
        {
          id: uid(),
          ticker: "TSLA",
          qty: 5,
          price: null,
          example: true,
        },
      ],
      cn: CN_NAMES.map((name, i) => ({
        id: uid(),
        name,
        cny: i === 0 ? 50000 : i === 1 ? 30000 : 20000,
        example: true,
      })),
      crypto: [{ id: uid(), symbol: "BTC", qty: 0.05, price: null, example: true }],
      cash: [{ id: uid(), label: "美元现金（示例）", usd: 5000, example: true }],
      usdCny: null,
      btcUsd: null,
      priceMeta: { stocks: "—", fx: "—", btc: "—" },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        us: Array.isArray(parsed.us) ? parsed.us : base.us,
        cn: (() => {
          if (!Array.isArray(parsed.cn) || !parsed.cn.length) return base.cn;
          return CN_NAMES.map((name) => {
            const found = parsed.cn.find((r) => r && r.name === name) || {};
            return {
              id: found.id || uid(),
              name,
              cny: Number(found.cny) || 0,
              example: !!found.example,
            };
          });
        })(),
        crypto: Array.isArray(parsed.crypto) && parsed.crypto.length
          ? parsed.crypto
          : base.crypto,
        cash: Array.isArray(parsed.cash) ? parsed.cash : base.cash,
      };
    } catch {
      return defaultState();
    }
  }

  function persist() {
    const payload = {
      us: state.us.map(({ id, ticker, qty, price, example, manualPrice }) => ({
        id,
        ticker,
        qty,
        price,
        example: !!example,
        manualPrice: !!manualPrice,
      })),
      cn: state.cn.map(({ id, name, cny, example }) => ({
        id,
        name,
        cny,
        example: !!example,
      })),
      crypto: state.crypto.map(({ id, symbol, qty, price, example }) => ({
        id,
        symbol,
        qty,
        price,
        example: !!example,
      })),
      cash: state.cash.map(({ id, label, usd, example }) => ({
        id,
        label,
        usd,
        example: !!example,
      })),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  }

  /* ---------- Gate ---------- */
  function isUnlocked() {
    try {
      return sessionStorage.getItem(GATE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function unlock() {
    sessionStorage.setItem(GATE_KEY, "1");
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    bootApp();
  }
  function lock() {
    sessionStorage.removeItem(GATE_KEY);
    $("#app").classList.add("hidden");
    $("#gate").classList.remove("hidden");
    $("#passcode").value = "";
    $("#gateErr").textContent = "";
    $("#passcode").focus();
  }

  function setupGate() {
    const input = $("#passcode");
    const btn = $("#gateBtn");
    const err = $("#gateErr");
    const tryUnlock = () => {
      if ((input.value || "").trim() === PASSCODE) {
        err.textContent = "";
        unlock();
      } else {
        err.textContent = "通行码不正确，请重试。";
        input.select();
      }
    };
    btn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlock();
    });
    if (isUnlocked()) unlock();
    else input.focus();
  }

  /* ---------- Price fetchers ---------- */
  async function fetchJson(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        ...opts.fetchOpts,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchUsdCny() {
    try {
      const data = await fetchJson(
        "https://api.frankfurter.dev/v1/latest?from=USD&to=CNY"
      );
      const rate = Number(data.rates.CNY);
      if (rate > 0) {
        state.usdCny = rate;
        state.priceMeta.fx = "Frankfurter · " + (data.date || "今日");
        return rate;
      }
    } catch (_) {}
    try {
      const data = await fetchJson("https://open.er-api.com/v6/latest/USD");
      const rate = Number(data.rates && data.rates.CNY);
      if (rate > 0) {
        state.usdCny = rate;
        state.priceMeta.fx = "open.er-api · 日更";
        return rate;
      }
    } catch (_) {}
    if (quotesCache.usdCny) {
      state.usdCny = quotesCache.usdCny;
      state.priceMeta.fx = "quotes.json 缓存";
      return state.usdCny;
    }
    state.priceMeta.fx = "汇率获取失败";
    return null;
  }

  async function fetchBtcUsd() {
    try {
      const data = await fetchJson(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
      );
      const p = Number(data.bitcoin && data.bitcoin.usd);
      if (p > 0) {
        state.btcUsd = p;
        state.priceMeta.btc = "CoinGecko";
        return p;
      }
    } catch (_) {}
    try {
      const data = await fetchJson(
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
      );
      const p = Number(data.price);
      if (p > 0) {
        state.btcUsd = p;
        state.priceMeta.btc = "Binance";
        return p;
      }
    } catch (_) {}
    if (quotesCache.btcUsd) {
      state.btcUsd = quotesCache.btcUsd;
      state.priceMeta.btc = "quotes.json 缓存";
      return state.btcUsd;
    }
    state.priceMeta.btc = "BTC 价格获取失败";
    return null;
  }

  async function fetchStockPrice(symbol) {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return null;

    // 1) stockprices.dev (CORS, no key) — stocks then ETFs
    for (const kind of ["stocks", "etfs"]) {
      try {
        const data = await fetchJson(
          `https://stockprices.dev/api/${kind}/${encodeURIComponent(sym)}`,
          { timeout: 8000 }
        );
        const p = Number(data.Price ?? data.price);
        if (p > 0) return { price: p, source: "stockprices.dev/" + kind };
      } catch (_) {}
    }

    // 2) Nasdaq public API (same as tesla-dashboard) — often blocked by CORS on Pages
    try {
      const data = await fetchJson(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=stocks`,
        {
          timeout: 8000,
          fetchOpts: {
            headers: {
              Accept: "application/json",
            },
          },
        }
      );
      const raw =
        data &&
        data.data &&
        data.data.primaryData &&
        data.data.primaryData.lastSalePrice;
      const p = Number(String(raw || "").replace(/[$,]/g, ""));
      if (p > 0) return { price: p, source: "nasdaq" };
    } catch (_) {}

    // 3) Local quotes.json seed / refresh cache
    const cached = quotesCache.stocks && quotesCache.stocks[sym];
    if (cached && cached.price > 0) {
      return { price: Number(cached.price), source: "quotes.json" };
    }

    return null;
  }

  async function loadQuotesJson() {
    try {
      const data = await fetchJson("quotes.json?" + Date.now(), { timeout: 6000 });
      quotesCache = data || { stocks: {} };
      if (data.usdCny && !state.usdCny) state.usdCny = data.usdCny;
      if (data.btcUsd && !state.btcUsd) state.btcUsd = data.btcUsd;
      if (data.stocks) {
        for (const row of state.us) {
          if (row.manualPrice) continue;
          const q = data.stocks[String(row.ticker || "").toUpperCase()];
          if (q && q.price > 0) row.price = q.price;
        }
      }
    } catch (_) {
      quotesCache = { stocks: {} };
    }
  }

  async function refreshAllPrices() {
    const pill = $("#livePill");
    const label = $("#liveLabel");
    const btn = $("#btnRefresh");
    btn.disabled = true;
    label.textContent = "刷新中…";
    pill.classList.add("warn");

    await loadQuotesJson();
    await Promise.all([fetchUsdCny(), fetchBtcUsd()]);

    // Apply BTC to crypto rows
    if (state.btcUsd) {
      for (const row of state.crypto) {
        if (String(row.symbol).toUpperCase() === "BTC") row.price = state.btcUsd;
      }
    }

    // US stocks in parallel (cap concurrency lightly)
    const tickers = [
      ...new Set(
        state.us
          .map((r) => String(r.ticker || "").trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
    let ok = 0;
    let fail = 0;
    let sourceNote = "";
    await Promise.all(
      tickers.map(async (sym) => {
        const result = await fetchStockPrice(sym);
        for (const row of state.us) {
          if (String(row.ticker || "").toUpperCase() !== sym) continue;
          if (row.manualPrice && row.price > 0) continue;
          if (result && result.price > 0) {
            row.price = result.price;
            row.manualPrice = false;
            ok++;
            sourceNote = result.source;
          } else if (!(row.price > 0)) {
            fail++;
          }
        }
      })
    );

    state.priceMeta.stocks = sourceNote
      ? sourceNote + (fail ? ` · ${fail} 只失败` : "")
      : fail
        ? "部分未能获取，可手改单价"
        : "无美股代码";

    persist();
    renderAll();

    const when = new Date().toLocaleString("zh-CN", { hour12: false });
    label.textContent = "已更新 " + when;
    pill.classList.remove("warn");
    btn.disabled = false;

    $("#usStatus").textContent =
      `美股来源：${state.priceMeta.stocks} · FX：${state.priceMeta.fx} · BTC：${state.priceMeta.btc}`;
    $("#usStatus").className =
      "status-line " + (ok || state.btcUsd || state.usdCny ? "ok" : "bad");
    $("#cnStatus").textContent = state.usdCny
      ? `USD/CNY = ${state.usdCny.toFixed(4)}（${state.priceMeta.fx}）· 1 USD = ${state.usdCny.toFixed(4)} CNY`
      : "汇率不可用，A股美元折算暂停";
    $("#cnStatus").className = "status-line " + (state.usdCny ? "ok" : "bad");
    $("#cryptoStatus").textContent = state.btcUsd
      ? `BTC-USD = ${fmtUSD(state.btcUsd, 0)}（${state.priceMeta.btc}）`
      : "BTC 价格不可用";
    $("#cryptoStatus").className =
      "status-line " + (state.btcUsd ? "ok" : "bad");
  }

  /* ---------- Totals ---------- */
  function usRowsValued() {
    return state.us.map((r) => {
      const qty = Number(r.qty) || 0;
      const price = Number(r.price) || 0;
      const value = qty * price;
      return { ...r, qty, price, value };
    });
  }
  function cnRowsValued() {
    const rate = state.usdCny > 0 ? state.usdCny : null;
    return state.cn.map((r) => {
      const cny = Number(r.cny) || 0;
      const value = rate ? cny / rate : 0;
      return { ...r, cny, value };
    });
  }
  function cryptoRowsValued() {
    return state.crypto.map((r) => {
      const qty = Number(r.qty) || 0;
      const price =
        String(r.symbol).toUpperCase() === "BTC" && state.btcUsd
          ? state.btcUsd
          : Number(r.price) || 0;
      const value = qty * price;
      return { ...r, qty, price, value };
    });
  }
  function cashTotal() {
    return state.cash.reduce((s, r) => s + (Number(r.usd) || 0), 0);
  }
  function categoryTotals() {
    const us = usRowsValued().reduce((s, r) => s + r.value, 0);
    const cn = cnRowsValued().reduce((s, r) => s + r.value, 0);
    const crypto = cryptoRowsValued().reduce((s, r) => s + r.value, 0);
    const cash = cashTotal();
    const total = us + cn + crypto + cash;
    return { us, cn, crypto, cash, total };
  }

  /* ---------- Render ---------- */
  function renderOverview() {
    const t = categoryTotals();
    const rows = [
      { name: "美股", key: "us", color: COLORS[0], amount: t.us },
      { name: "A股", key: "cn", color: COLORS[1], amount: t.cn },
      { name: "数字货币", key: "crypto", color: COLORS[2], amount: t.crypto },
      { name: "现金", key: "cash", color: COLORS[3], amount: t.cash },
    ];
    const tbody = $("#overviewTable tbody");
    tbody.innerHTML = rows
      .map((r) => {
        const pct = t.total > 0 ? r.amount / t.total : 0;
        return `<tr>
          <td><span class="swatch" style="background:${r.color}"></span>${r.name}</td>
          <td class="num">${fmtUSD(r.amount)}</td>
          <td class="num">${fmtPct(pct)}</td>
        </tr>`;
      })
      .join("");
    $("#ovTotal").textContent = fmtUSD(t.total);

    $("#kpiTotal").textContent = fmtUSD(t.total);
    $("#kpiUs").textContent = fmtUSD(t.us);
    $("#kpiCn").textContent = fmtUSD(t.cn);
    $("#kpiCrypto").textContent = fmtUSD(t.crypto);
    $("#kpiCash").textContent = fmtUSD(t.cash);
    $("#kpiUsPct").textContent = "占比 " + fmtPct(t.total ? t.us / t.total : 0);
    $("#kpiCnPct").textContent = "占比 " + fmtPct(t.total ? t.cn / t.total : 0);
    $("#kpiCryptoPct").textContent =
      "占比 " + fmtPct(t.total ? t.crypto / t.total : 0);
    $("#kpiCashPct").textContent =
      "占比 " + fmtPct(t.total ? t.cash / t.total : 0);
    $("#kpiFx").textContent = state.usdCny
      ? `USD/CNY ${state.usdCny.toFixed(4)}`
      : "汇率未就绪";

    const chartData = rows.map((r) => Math.max(0, r.amount));
    const allZero = chartData.every((v) => v === 0);
    if (chart) {
      chart.data.datasets[0].data = allZero ? [1, 1, 1, 1] : chartData;
      chart.data.datasets[0].backgroundColor = allZero
        ? ["#333", "#333", "#333", "#333"]
        : COLORS;
      chart.update();
    } else {
      const ctx = $("#allocChart").getContext("2d");
      chart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: rows.map((r) => r.name),
          datasets: [
            {
              data: allZero ? [1, 1, 1, 1] : chartData,
              backgroundColor: allZero
                ? ["#333", "#333", "#333", "#333"]
                : COLORS,
              borderWidth: 0,
              hoverOffset: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: "#9a9a9a",
                boxWidth: 12,
                padding: 14,
                font: { size: 12 },
              },
            },
            tooltip: {
              callbacks: {
                label(ctx) {
                  if (allZero) return " " + ctx.label + ": 暂无数据";
                  const v = ctx.parsed || 0;
                  const pct = t.total ? ((v / t.total) * 100).toFixed(1) : "0.0";
                  return ` ${ctx.label}: ${fmtUSD(v)} (${pct}%)`;
                },
              },
            },
          },
        },
      });
    }
  }

  function renderUs() {
    const valued = usRowsValued().sort((a, b) => b.value - a.value);
    // keep state order synced to sorted for weight display consistency in UI only
    const catTotal = valued.reduce((s, r) => s + r.value, 0) || 0;
    const tbody = $("#usTable tbody");
    tbody.innerHTML = "";
    for (const row of valued) {
      const tr = document.createElement("tr");
      const weight = catTotal > 0 ? row.value / catTotal : 0;
      const ex = row.example
        ? '<span class="tag-ex">示例</span>'
        : "";
      tr.innerHTML = `
        <td><input class="ticker" data-f="ticker" value="${escapeAttr(
          row.ticker || ""
        )}" placeholder="AAPL" />${ex}</td>
        <td class="num"><input data-f="qty" type="number" min="0" step="any" value="${escapeAttr(
          fmtNum(row.qty)
        )}" /></td>
        <td class="num"><input data-f="price" type="number" min="0" step="any" value="${
          row.price > 0 ? escapeAttr(String(row.price)) : ""
        }" placeholder="自动/手填" title="可手动覆盖价格" /></td>
        <td class="num">${fmtUSD(row.value)}</td>
        <td class="num">${fmtPct(weight)}</td>
        <td class="actions"><button type="button" class="icon-btn" data-act="del">删除</button></td>
      `;
      wireUsRow(tr, row.id);
      tbody.appendChild(tr);
    }
    // Reorder state.us to match sorted display so edits stay consistent
    state.us = valued.map(({ value, ...rest }) => rest);
  }

  function wireUsRow(tr, id) {
    $$("input", tr).forEach((inp) => {
      inp.addEventListener("change", () => {
        const row = state.us.find((r) => r.id === id);
        if (!row) return;
        const f = inp.getAttribute("data-f");
        if (f === "ticker") {
          row.ticker = inp.value.trim().toUpperCase();
          row.example = false;
          row.manualPrice = false;
          // fetch new ticker price async
          fetchStockPrice(row.ticker).then((res) => {
            if (res && res.price > 0 && !row.manualPrice) {
              row.price = res.price;
              persist();
              renderAll();
            }
          });
        } else if (f === "qty") {
          row.qty = Number(inp.value) || 0;
          row.example = false;
        } else if (f === "price") {
          row.price = Number(inp.value) || 0;
          row.manualPrice = true;
          row.example = false;
        }
        persist();
        renderAll();
      });
    });
    $('[data-act="del"]', tr).addEventListener("click", () => {
      state.us = state.us.filter((r) => r.id !== id);
      persist();
      renderAll();
    });
  }

  function renderCn() {
    const valued = cnRowsValued().sort((a, b) => b.value - a.value);
    const catTotal = valued.reduce((s, r) => s + r.value, 0) || 0;
    const tbody = $("#cnTable tbody");
    tbody.innerHTML = "";
    // Keep fixed names but show sorted by USD weight
    for (const row of valued) {
      const tr = document.createElement("tr");
      const weight = catTotal > 0 ? row.value / catTotal : 0;
      const ex = row.example
        ? '<span class="tag-ex">示例</span>'
        : "";
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}${ex}</td>
        <td class="num"><input data-f="cny" type="number" min="0" step="any" value="${escapeAttr(
          fmtNum(row.cny, 2)
        )}" /></td>
        <td class="num">${state.usdCny ? fmtUSD(row.value) : "—"}</td>
        <td class="num">${fmtPct(weight)}</td>
      `;
      const inp = $("input", tr);
      inp.addEventListener("change", () => {
        const target = state.cn.find((r) => r.id === row.id);
        if (!target) return;
        target.cny = Number(inp.value) || 0;
        target.example = false;
        persist();
        renderAll();
      });
      tbody.appendChild(tr);
    }
  }

  function renderCrypto() {
    const valued = cryptoRowsValued().sort((a, b) => b.value - a.value);
    const catTotal = valued.reduce((s, r) => s + r.value, 0) || 0;
    const tbody = $("#cryptoTable tbody");
    tbody.innerHTML = "";
    for (const row of valued) {
      const tr = document.createElement("tr");
      const weight = catTotal > 0 ? row.value / catTotal : 0;
      const ex = row.example
        ? '<span class="tag-ex">示例</span>'
        : "";
      tr.innerHTML = `
        <td><strong>${escapeHtml(row.symbol || "BTC")}</strong>${ex}</td>
        <td class="num"><input data-f="qty" type="number" min="0" step="any" value="${escapeAttr(
          fmtNum(row.qty)
        )}" /></td>
        <td class="num">${row.price > 0 ? fmtUSD(row.price, 0) : "—"}</td>
        <td class="num">${fmtUSD(row.value)}</td>
        <td class="num">${fmtPct(weight)}</td>
        <td class="actions"><button type="button" class="icon-btn" data-act="del">删除</button></td>
      `;
      $("input", tr).addEventListener("change", (e) => {
        const target = state.crypto.find((r) => r.id === row.id);
        if (!target) return;
        target.qty = Number(e.target.value) || 0;
        target.example = false;
        persist();
        renderAll();
      });
      $('[data-act="del"]', tr).addEventListener("click", () => {
        if (state.crypto.length <= 1) {
          alert("至少保留一行 BTC。");
          return;
        }
        state.crypto = state.crypto.filter((r) => r.id !== row.id);
        persist();
        renderAll();
      });
      tbody.appendChild(tr);
    }
    state.crypto = valued.map(({ value, ...rest }) => rest);
  }

  function renderCash() {
    const tbody = $("#cashTable tbody");
    tbody.innerHTML = "";
    for (const row of state.cash) {
      const tr = document.createElement("tr");
      const ex = row.example
        ? '<span class="tag-ex">示例</span>'
        : "";
      tr.innerHTML = `
        <td><input data-f="label" value="${escapeAttr(
          row.label || "现金"
        )}" />${ex}</td>
        <td class="num"><input data-f="usd" type="number" min="0" step="any" value="${escapeAttr(
          fmtNum(row.usd, 2)
        )}" /></td>
        <td class="actions"><button type="button" class="icon-btn" data-act="del">删除</button></td>
      `;
      $$("input", tr).forEach((inp) => {
        inp.addEventListener("change", () => {
          const f = inp.getAttribute("data-f");
          if (f === "label") row.label = inp.value.trim() || "现金";
          if (f === "usd") row.usd = Number(inp.value) || 0;
          row.example = false;
          persist();
          renderAll();
        });
      });
      $('[data-act="del"]', tr).addEventListener("click", () => {
        state.cash = state.cash.filter((r) => r.id !== row.id);
        if (!state.cash.length) {
          state.cash.push({ id: uid(), label: "美元现金", usd: 0, example: false });
        }
        persist();
        renderAll();
      });
      tbody.appendChild(tr);
    }
  }

  function renderAll() {
    renderUs();
    renderCn();
    renderCrypto();
    renderCash();
    renderOverview();
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ---------- Boot ---------- */
  let booted = false;
  function bootApp() {
    if (booted) return;
    booted = true;
    state = loadState();
    // Ensure CN fixed names
    if (state.cn.length !== 3) {
      state.cn = CN_NAMES.map((name) => ({
        id: uid(),
        name,
        cny: 0,
        example: false,
      }));
    } else {
      state.cn.forEach((r, i) => {
        r.name = CN_NAMES[i];
      });
    }
    if (!state.crypto.length) {
      state.crypto = [{ id: uid(), symbol: "BTC", qty: 0, price: null }];
    }

    $("#btnRefresh").addEventListener("click", () => refreshAllPrices());
    $("#btnLock").addEventListener("click", lock);
    $("#btnAddUs").addEventListener("click", () => {
      state.us.push({
        id: uid(),
        ticker: "",
        qty: 0,
        price: null,
        example: false,
      });
      persist();
      renderAll();
    });
    $("#btnAddCrypto").addEventListener("click", () => {
      state.crypto.push({
        id: uid(),
        symbol: "BTC",
        qty: 0,
        price: state.btcUsd || null,
        example: false,
      });
      persist();
      renderAll();
    });
    $("#btnAddCash").addEventListener("click", () => {
      state.cash.push({
        id: uid(),
        label: "现金",
        usd: 0,
        example: false,
      });
      persist();
      renderAll();
    });

    renderAll();
    refreshAllPrices();
  }

  setupGate();
})();
