(function () {

const TIMEFRAMES = [
  { id: 'M1', label: '1m' },
  { id: 'M5', label: '5m' },
  { id: 'M15', label: '15m' },
  { id: 'H1', label: '1H' },
  { id: 'H4', label: '4H' },
  { id: 'D', label: '1D' }
];

const state = {
  instruments: [],
  symbol: null,
  tf: 'M15',
  chart: null,
  series: null,
  lastCandle: null,
  watchPrices: {}
};

function fmt(v, decimals) {
  return Number(v).toFixed(decimals);
}

function getInstrument(id) {
  return state.instruments.find((i) => i.id === id);
}

async function fetchInstruments() {
  const res = await fetch('/api/instruments');
  state.instruments = await res.json();
}

async function fetchCandles(symbol, tf) {
  const res = await fetch(`/api/candles?instrument=${symbol}&granularity=${tf}&count=150`);
  if (!res.ok) throw new Error('failed to load candles');
  return res.json();
}

function initChart() {
  const container = document.getElementById('chartContainer');
  state.chart = LightweightCharts.createChart(container, {
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#9097a3' },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' }
    },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#262b35' },
    rightPriceScale: { borderColor: '#262b35' },
    crosshair: { mode: 0 }
  });
  state.series = state.chart.addCandlestickSeries({
    upColor: '#1dae8f', downColor: '#e0563f', borderVisible: false,
    wickUpColor: '#1dae8f', wickDownColor: '#e0563f'
  });
  new ResizeObserver(() => {
    state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }).observe(container);
}

function buildTfBar() {
  const el = document.getElementById('tfBar');
  el.innerHTML = '';
  TIMEFRAMES.forEach((tf) => {
    const btn = document.createElement('button');
    btn.textContent = tf.label;
    btn.className = tf.id === state.tf ? 'active' : '';
    btn.onclick = () => selectTf(tf.id);
    el.appendChild(btn);
  });
}

function buildWatchlist() {
  const el = document.getElementById('watchlist');
  el.innerHTML = '';
  state.instruments.forEach((inst) => {
    const row = document.createElement('div');
    row.className = 'watch-row' + (inst.id === state.symbol ? ' active' : '');
    row.dataset.symid = inst.id;
    row.innerHTML = `
      <div class="top">
        <span class="symid">${inst.label}</span>
        <span class="pct" data-pct>-</span>
      </div>
      <div class="bottom">
        <span class="label">${inst.name}</span>
        <span class="price" data-price>-</span>
      </div>`;
    row.onclick = () => selectSymbol(inst.id);
    el.appendChild(row);
  });
}

function updateWatchRow(symbol, price, decimals) {
  const row = document.querySelector(`.watch-row[data-symid="${symbol}"]`);
  if (!row) return;
  row.querySelector('[data-price]').textContent = fmt(price, decimals);
}

function updateHeader(inst, candle) {
  document.getElementById('symName').textContent = inst.label;
  document.getElementById('symPrice').textContent = fmt(candle.close, inst.decimals);
  document.getElementById('ohlcO').textContent = fmt(candle.open, inst.decimals);
  document.getElementById('ohlcH').textContent = fmt(candle.high, inst.decimals);
  document.getElementById('ohlcL').textContent = fmt(candle.low, inst.decimals);
  document.getElementById('ohlcC').textContent = fmt(candle.close, inst.decimals);
}

async function selectSymbol(symbol) {
  state.symbol = symbol;
  document.querySelectorAll('.watch-row').forEach((r) => {
    r.classList.toggle('active', r.dataset.symid === symbol);
  });
  await loadChart();
}

function selectTf(tf) {
  state.tf = tf;
  buildTfBar();
  loadChart();
}

async function loadChart() {
  const inst = getInstrument(state.symbol);
  try {
    const candles = await fetchCandles(state.symbol, state.tf);
    state.series.setData(candles);
    state.chart.timeScale().fitContent();
    state.lastCandle = candles[candles.length - 1];
    if (state.lastCandle) updateHeader(inst, state.lastCandle);
  } catch (err) {
    console.error(err);
  }
}

function applyTick(symbol, tick) {
  const inst = getInstrument(symbol);
  if (!inst) return;
  updateWatchRow(symbol, tick.mid, inst.decimals);

  if (symbol === state.symbol && state.lastCandle) {
    const c = state.lastCandle;
    c.close = tick.mid;
    c.high = Math.max(c.high, tick.mid);
    c.low = Math.min(c.low, tick.mid);
    state.series.update(c);
    updateHeader(inst, c);
  }
}

function setConnStatus(status) {
  const el = document.getElementById('connStatus');
  if (status === 'connected') {
    el.textContent = 'live';
    el.classList.add('connected');
  } else {
    el.textContent = status === 'missing-credentials' ? 'no API key set' : 'reconnecting…';
    el.classList.remove('connected');
  }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'snapshot') {
      setConnStatus(msg.streamStatus);
      Object.entries(msg.ticks || {}).forEach(([symbol, tick]) => applyTick(symbol, tick));
    } else if (msg.type === 'price') {
      applyTick(msg.instrument, msg.tick);
    } else if (msg.type === 'status') {
      setConnStatus(msg.streamStatus);
    }
  };

  ws.onclose = () => {
    setConnStatus('reconnecting');
    setTimeout(connectWebSocket, 2000);
  };
  ws.onerror = () => ws.close();
}

async function main() {
  await fetchInstruments();
  state.symbol = state.instruments[0].id;
  buildTfBar();
  buildWatchlist();
  initChart();
  await loadChart();
  connectWebSocket();
}

main();

})();
