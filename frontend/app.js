const API_BASE = (window.API_BASE || "http://127.0.0.1:8000") + "/api/v1";

function toSeries(ts) {
  return (ts || []).map(p => {
    const raw = (p.time != null ? p.time : p.date);
    const normalized = (typeof raw === 'string' && raw.length === 8)
      ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`
      : raw;
    return [new Date(normalized).getTime(), p.value];
  });
}

function renderChart(container, title, series) {
  Highcharts.chart(container, {
    chart: { backgroundColor: '#0b0e13' },
    title: { text: title, style: { color: '#e6edf3' } },
    xAxis: { type: 'datetime', labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: null }, labels: { style: { color: '#9aa4af' } } },
    legend: { enabled: false },
    series: [{ type: 'line', data: series, color: '#2f81f7' }],
    credits: { enabled: false }
  });
}

function renderMetricsTable(metrics) {
  const tbl = document.getElementById('metricsTable');
  tbl.innerHTML = '';
  const rows = Object.entries(metrics || {});
  rows.forEach(([k,v]) => {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    const td2 = document.createElement('td');
    td1.textContent = k;
    td2.textContent = typeof v === 'number' ? v.toFixed(6) : v;
    tr.appendChild(td1); tr.appendChild(td2);
    tbl.appendChild(tr);
  });
}

function toggleOverlay(show) {
  const el = document.getElementById('overlay');
  if (show) el.classList.remove('hidden'); else el.classList.add('hidden');
}

document.getElementById('closeOverlay').addEventListener('click', () => toggleOverlay(false));
document.getElementById('showOverlay').addEventListener('change', (e) => toggleOverlay(e.target.checked));

async function previewExpression() {
  const statusEl = document.getElementById('status');
  const expr = document.getElementById('expr').value.trim();
  const infSel = document.getElementById('inf_to_nan');
  const inf_to_nan = infSel ? (infSel.value === 'on' || infSel.checked === true) : true;
  if (!expr) { statusEl.textContent = '表达式为空'; return; }
  statusEl.textContent = '预检中...';
  try {
    const res = await fetch(`${API_BASE}/factor/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expr, inf_to_nan })
    });
    const out = await res.json();
    if (!out.ok) {
      statusEl.textContent = `预检失败：${out.error || '未知错误'}`;
      return;
    }
    statusEl.textContent = `预检通过，示例行数：${(out.sample||[]).length}`;
  } catch (e) {
    statusEl.textContent = `预检错误：${e.message}`;
  }
}

function renderHeatmap(container, monthly) {
  // 使用Highcharts heatmap: x为月份序号，y仅一行；简化展示
  const cats = (monthly||[]).map(m => m.month);
  const data = (monthly||[]).map((m, i) => [i, 0, m.ret]);
  Highcharts.chart(container, {
    chart: { type: 'heatmap', backgroundColor: '#0b0e13' },
    title: { text: '月度热力图', style: { color: '#e6edf3' } },
    xAxis: { categories: cats, labels: { style: { color: '#9aa4af' } } },
    yAxis: { categories: ['ret'], title: null, labels: { style: { color: '#9aa4af' } } },
    colorAxis: { min: -0.05, max: 0.05, stops: [[0, '#8b0000'], [0.5, '#0b0e13'], [1, '#006400']] },
    series: [{ name: '月度收益', borderWidth: 0, data, dataLabels: { enabled: true, format: '{point.value:.2%}', color: '#e6edf3' } }],
    credits: { enabled: false }
  });
}

function renderHistogram(container, hist) {
  Highcharts.chart(container, {
    chart: { type: 'column', backgroundColor: '#0b0e13' },
    title: { text: '收益分布', style: { color: '#e6edf3' } },
    xAxis: { categories: (hist||[]).map(b => `${(b.left*100).toFixed(2)}~${(b.right*100).toFixed(2)}%`), labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: '频数' }, labels: { style: { color: '#9aa4af' } } },
    series: [{ name: 'count', data: (hist||[]).map(b => b.count), color: '#2f81f7' }],
    credits: { enabled: false }
  });
}

function renderLine(container, title, series) {
  Highcharts.chart(container, {
    chart: { backgroundColor: '#0b0e13' },
    title: { text: title, style: { color: '#e6edf3' } },
    xAxis: { type: 'datetime', labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: null }, labels: { style: { color: '#9aa4af' } } },
    legend: { enabled: false },
    series: [{ type: 'line', data: series, color: '#2f81f7' }],
    credits: { enabled: false }
  });
}

async function runBacktest() {
  const statusEl = document.getElementById('status');
  const expr = document.getElementById('expr').value.trim() || null;
  const start_date = document.getElementById('start_date').value.trim() || null;
  const end_date = document.getElementById('end_date').value.trim() || null;
  const initial_capital = parseFloat(document.getElementById('initial_capital').value || '1');
  const max_weight_per_stock = parseFloat(document.getElementById('max_weight').value || '0.05');
  const t_plus = document.getElementById('t_plus').value;
  const position_mode = document.getElementById('position_mode').value;
  const codesStr = document.getElementById('codes').value.trim();
  const codes = codesStr ? codesStr.split(',').map(s=>s.trim()).filter(Boolean) : null;
  const chartType = document.getElementById('chartType').value;
  const infSel = document.getElementById('inf_to_nan');
  const inf_to_nan = infSel ? (infSel.value === 'on' || infSel.checked === true) : true;

  statusEl.textContent = '回测运行中...';
  try {
    const res = await fetch(`${API_BASE}/backtest/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expr, position_mode, start_nav: initial_capital, inf_to_nan })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const out = await res.json();
    if (!out.ok) {
      throw new Error(out.error || '回测失败');
    }
    if (chartType === 'pnl_dd') {
      renderChart('pnlChart', '累计净值', toSeries(out.pnl));
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'monthly_heatmap') {
      renderHeatmap('pnlChart', out.extra?.monthly_heatmap || []);
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'histogram') {
      renderHistogram('pnlChart', out.extra?.histogram || []);
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'rolling_sharpe') {
      renderLine('pnlChart', '滚动Sharpe', toSeries(out.extra?.rolling_sharpe || []));
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'rolling_vol') {
      renderLine('pnlChart', '滚动波动率', toSeries(out.extra?.rolling_vol || []));
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'ic_series') {
      renderLine('pnlChart', 'IC时间序列', toSeries(out.extra?.ic_series || []));
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    } else if (chartType === 'decile_spread') {
      renderLine('pnlChart', '分位收益差(top-bottom)', toSeries(out.extra?.decile_spread || []));
      renderChart('ddChart', '水下回撤', toSeries(out.drawdown));
    }
    renderMetricsTable(out.metrics || {});
    statusEl.textContent = out.notes || '完成';

    const autoShow = document.getElementById('showOverlay').checked;
    if (autoShow) toggleOverlay(true);
  } catch (e) {
    statusEl.textContent = `错误：${e.message}`;
  }
}

document.getElementById('previewBtn').addEventListener('click', previewExpression);
document.getElementById('runBtn').addEventListener('click', runBacktest);