import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ConfigProvider, theme, Layout, Typography, Space, Input, Select, Button, Modal, Table, DatePicker, InputNumber, Drawer, Form, message, Card } from 'antd'
import Highcharts from 'highcharts/highstock'
import HCHeatmap from 'highcharts/modules/heatmap'
import HighchartsReact from 'highcharts-react-official'
import axios from 'axios'
import CopilotChat from './components/CopilotChat';

// 初始化 Highcharts 扩展模块
HCHeatmap(Highcharts)

const { Header, Content } = Layout
const { Title, Text } = Typography

const API_BASE = (window as any).API_BASE || 'http://127.0.0.1:8000'

type ChartType = 'none' | 'pnl' | 'pnl_dd' | 'monthly_heatmap' | 'histogram' | 'rolling_sharpe' | 'rolling_vol' | 'ic_series' | 'decile_spread'

export default function App() {
  const [expr, setExpr] = useState('cs_rank(close - pre_close) / ts_std(close, 20)')
  const [positionMode, setPositionMode] = useState<'long_only'|'short_only'|'long_short'>('long_only')
  const [initialCapital, setInitialCapital] = useState<number>(500000)
  const [chartType, setChartType] = useState<ChartType>('pnl_dd')
  const [loading, setLoading] = useState<boolean>(false)
  const [metrics, setMetrics] = useState<Record<string, number>>({})
  const [pnl, setPnl] = useState<any[]>([])
  const [dd, setDd] = useState<any[]>([])
  const [extra, setExtra] = useState<any>({})
  const [signals, setSignals] = useState<any[]>([])
  const [overlayOpen, setOverlayOpen] = useState<boolean>(false)
  const [dateRange, setDateRange] = useState<any>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [tPlus, setTPlus] = useState<'t0'|'t1'>('t1')
  const [maxWeight, setMaxWeight] = useState<number>(0.05)
  const [chartModalOpen, setChartModalOpen] = useState<boolean>(false)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [infToNan, setInfToNan] = useState<'on'|'off'>('on')
  // 选股分位阈值（做多/做空），范围 [0,1]
  const [longThreshold, setLongThreshold] = useState<number>(0.7)
  const [shortThreshold, setShortThreshold] = useState<number>(0.3)
  const [funcs, setFuncs] = useState<string[]>([])
  const [suggestOpen, setSuggestOpen] = useState<boolean>(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeIdx, setActiveIdx] = useState<number>(0)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [caretPos, setCaretPos] = useState<number>(0)
  const [caretCoords, setCaretCoords] = useState<{ top: number; left: number } | null>(null)
  const [previewColumns, setPreviewColumns] = useState<string[]>([])
  const [previewSample, setPreviewSample] = useState<any[]>([])
  // 可拖拽左右分隔：默认左侧占比 0.74
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [splitRatio, setSplitRatio] = useState<number>(0.74)
  const [draggingSplit, setDraggingSplit] = useState<boolean>(false)

  useEffect(() => {
    if (!draggingSplit) return
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const r = Math.min(Math.max(x / rect.width, 0.2), 0.85)
      setSplitRatio(r)
    }
    const onUp = () => setDraggingSplit(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draggingSplit])

  const previewExpr = async () => {
    setLoading(true)
    try {
      const res = await axios.post(`${API_BASE}/api/v1/factor/preview`, { expr, inf_to_nan: infToNan === 'on' })
      const out = res.data
      if (!out.ok) throw new Error(out.error || '预检失败')
      setPreviewColumns(Array.isArray(out.columns) ? out.columns : [])
      setPreviewSample(Array.isArray(out.sample) ? out.sample : [])
      message.success(`预检通过：示例行数 ${(out.sample||[]).length}`)
    } catch (e: any) {
      console.error(e)
      message.error(e?.message || '预检失败')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    // 仅从后端接口获取可用函数列表（严格来源 operators.py），不做任何回退
    axios.get(`${API_BASE}/api/v1/factor/operators`).then(res => {
      const out = res.data
      if (out?.ok && Array.isArray(out.functions)) {
        setFuncs(out.functions)
      } else {
        throw new Error('operators list not available')
      }
    }).catch((err) => {
      console.error('获取 operators 列表失败：', err)
      setFuncs([])
      message.warning('无法获取可用函数列表：请检查后端服务与 operators.py')
    })
  }, [])

  // 计算光标处前缀（由字母、数字、下划线组成）
  const calcPrefix = (text: string, index: number) => {
    const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch)
    let i = index - 1
    while (i >= 0 && isWord(text[i])) i--
    const start = i + 1
    const prefix = text.slice(start, index)
    return { prefix, start }
  }

  // 计算 textarea 光标的屏幕坐标（使用镜像节点方法）
  const getCaretCoordinates = (el: HTMLTextAreaElement, pos: number) => {
    const div = document.createElement('div')
    const style = window.getComputedStyle(el)
    const props = ['direction','boxSizing','width','height','overflowX','overflowY','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontFamily','lineHeight','textAlign','textTransform','textIndent','textDecoration','letterSpacing','wordSpacing'] as const
    div.style.whiteSpace = 'pre-wrap'
    div.style.position = 'absolute'
    div.style.visibility = 'hidden'
    props.forEach((p) => { (div.style as any)[p] = style.getPropertyValue(p) })
    div.style.overflow = 'auto'
    div.style.width = style.getPropertyValue('width')
    div.style.height = style.getPropertyValue('height')
    const text = el.value.substring(0, pos)
    const span = document.createElement('span')
    span.textContent = el.value.substring(pos) || '.'
    div.textContent = text
    div.appendChild(span)
    document.body.appendChild(div)
    const rect = span.getBoundingClientRect()
    const base = el.getBoundingClientRect()
    const top = base.top + (rect.top - div.getBoundingClientRect().top)
    const left = base.left + (rect.left - div.getBoundingClientRect().left)
    document.body.removeChild(div)
    return { top, left }
  }

  const runBacktest = async () => {
    setLoading(true)
    try {
      const start_date = dateRange?.[0] ? dateRange[0].format('YYYYMMDD') : null
      const end_date = dateRange?.[1] ? dateRange[1].format('YYYYMMDD') : null
      const res = await axios.post(`${API_BASE}/api/v1/backtest/run`, {
        expr,
        position_mode: positionMode,
        start_nav: initialCapital,
        long_threshold: longThreshold,
        short_threshold: shortThreshold,
        start_date,
        end_date,
        codes: (codes && codes.length > 0) ? codes : null,
        t_plus: tPlus,
        max_weight_per_stock: maxWeight,
        inf_to_nan: infToNan === 'on',
      })
      const out = res.data
      if (!out.ok) throw new Error(out.error || '回测失败')
      setPnl(out.pnl || [])
      setDd(out.drawdown || [])
      setMetrics(out.metrics || {})
      setExtra(out.extra || {})
      setSignals(Array.isArray(out.signals) ? out.signals : [])
      // 仅设置默认图表类型，不再自动弹出任何弹窗
      setChartType('pnl_dd')
      if ((!out.pnl || out.pnl.length === 0) && (!out.drawdown || out.drawdown.length === 0)) {
        message.warning('接口返回为空：请缩短时间窗口或检查表达式')
      }
    } catch (e: any) {
      console.error(e)
      message.error(e?.message || '回测失败')
    } finally { setLoading(false) }
  }

  // 颜色生成：在系列数量很多时提供稳定的可读调色板
  const hslToHex = (h: number, s: number, l: number) => {
    s /= 100; l /= 100
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs((h / 60) % 2 - 1))
    const m = l - c/2
    let r = 0, g = 0, b = 0
    if (0 <= h && h < 60) { r = c; g = x; b = 0 }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0 }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c }
    else { r = c; g = 0; b = x }
    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  const buildColors = (count: number) => {
    const baseColors = (Highcharts.getOptions().colors || []) as Array<string | Highcharts.GradientColorObject | Highcharts.PatternObject>
    const colors: Array<string | Highcharts.GradientColorObject | Highcharts.PatternObject> = []
    // 先用 Highcharts 默认色填充
    for (let i = 0; i < Math.min(baseColors.length, count); i++) colors.push(baseColors[i])
    if (colors.length >= count) return colors
    // 均匀分布色相，暗色背景下保证对比度
    const remain = count - colors.length
    for (let i = 0; i < remain; i++) {
      const hue = Math.round(360 * (i / Math.max(1, remain)))
      const sat = 70
      const light = 50
      colors.push(hslToHex(hue, sat, light))
    }
    return colors
  }

  const lineOptionsSingle = (title: string, series: any[]) => ({
    chart: { backgroundColor: '#0b0e13', zoomType: 'x' },
    title: { text: title, style: { color: '#e6edf3' } },
    xAxis: { type: 'datetime', labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: null }, labels: { style: { color: '#9aa4af' } } },
    legend: { enabled: false },
    rangeSelector: { selected: 5, buttons: [
      { type: 'month', count: 1, text: '1m' },
      { type: 'month', count: 3, text: '3m' },
      { type: 'month', count: 6, text: '6m' },
      { type: 'ytd', text: 'YTD' },
      { type: 'year', count: 1, text: '1y' },
      { type: 'all', text: 'All' },
    ] },
    scrollbar: { enabled: true },
    navigator: { enabled: true },
    tooltip: { shared: true, valueDecimals: 6 },
    series: [{ type: 'line', data: series, color: '#2f81f7', name: title }],
    credits: { enabled: false }
  })

  const lineOptionsMulti = (title: string, lines: { name: string; data: any[] }[]) => ({
    chart: { backgroundColor: '#0b0e13', zoomType: 'x' },
    title: { text: title, style: { color: '#e6edf3' } },
    xAxis: { type: 'datetime', labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: null }, labels: { style: { color: '#9aa4af' } } },
    legend: { enabled: true },
    rangeSelector: { selected: 5, buttons: [
      { type: 'month', count: 1, text: '1m' },
      { type: 'month', count: 3, text: '3m' },
      { type: 'month', count: 6, text: '6m' },
      { type: 'ytd', text: 'YTD' },
      { type: 'year', count: 1, text: '1y' },
      { type: 'all', text: 'All' },
    ] },
    scrollbar: { enabled: true },
    navigator: { enabled: true },
    tooltip: { shared: true, valueDecimals: 6 },
    series: (() => {
      const colors = buildColors((lines || []).length)
      return (lines || []).map((ln, i) => ({ type: 'line', data: ln.data, name: ln.name, color: colors[i % colors.length] }))
    })(),
    credits: { enabled: false }
  })

  const heatmapOptions = (monthly: any[]) => {
    const cats = (monthly||[]).map(m => m.month)
    const data = (monthly||[]).map((m: any, i: number) => [i, 0, m.ret])
    return {
      chart: { type: 'heatmap', backgroundColor: '#0b0e13' },
      title: { text: '月度热力图', style: { color: '#e6edf3' } },
      xAxis: { categories: cats, labels: { style: { color: '#9aa4af' } } },
      yAxis: { categories: ['ret'], title: null, labels: { style: { color: '#9aa4af' } } },
      colorAxis: { min: -0.05, max: 0.05, stops: [[0, '#8b0000'], [0.5, '#0b0e13'], [1, '#006400']] },
      series: [{ name: '月度收益', borderWidth: 0, data, dataLabels: { enabled: true, format: '{point.value:.2%}', color: '#e6edf3' } }],
      credits: { enabled: false }
    } as any
  }

  // 多因子热力图：x 为月份，y 为因子标签
  const heatmapOptionsMulti = (signalsMonthly: { label: string; data: any[] }[]) => {
    const monthSet = new Set<string>()
    signalsMonthly.forEach(s => (s.data||[]).forEach((m: any) => monthSet.add(String(m.month))))
    const months = Array.from(monthSet).sort()
    const yCats = signalsMonthly.map(s => s.label)
    const monthIndex = new Map<string, number>(months.map((m, i) => [m, i]))
    const data: any[] = []
    signalsMonthly.forEach((s, yi) => {
      (s.data||[]).forEach((m: any) => {
        const xi = monthIndex.get(String(m.month)) ?? 0
        data.push([xi, yi, m.ret])
      })
    })
    return {
      chart: { type: 'heatmap', backgroundColor: '#0b0e13', height: Math.max(360, yCats.length * 28 + 120) },
      title: { text: '月度热力图（多因子）', style: { color: '#e6edf3' } },
      xAxis: { categories: months, labels: { style: { color: '#9aa4af' } } },
      yAxis: { categories: yCats, title: null, labels: { style: { color: '#9aa4af' } } },
      colorAxis: { min: -0.05, max: 0.05, stops: [[0, '#8b0000'], [0.5, '#0b0e13'], [1, '#006400']] },
      series: [{ name: '月度收益', borderWidth: 0, data, dataLabels: { enabled: false } }],
      credits: { enabled: false }
    } as any
  }

  const histogramOptions = (hist: any[]) => ({
    chart: { type: 'column', backgroundColor: '#0b0e13' },
    title: { text: '收益分布', style: { color: '#e6edf3' } },
    xAxis: { categories: (hist||[]).map(b => `${(b.left*100).toFixed(2)}~${(b.right*100).toFixed(2)}%`), labels: { style: { color: '#9aa4af' } } },
    yAxis: { title: { text: '频数' }, labels: { style: { color: '#9aa4af' } } },
    series: [{ name: 'count', data: (hist||[]).map(b => b.count), color: '#2f81f7' }],
    credits: { enabled: false }
  })

  // 多因子收益分布：改为折线图（x 为区间中心，避免不同分箱无法共用类目）
  const histogramOptionsMulti = (signalsHist: { label: string; data: any[] }[]) => ({
    chart: { type: 'line', backgroundColor: '#0b0e13' },
    title: { text: '收益分布（多因子）', style: { color: '#e6edf3' } },
    xAxis: { title: { text: '收益率' }, labels: { style: { color: '#9aa4af' } }, type: 'linear' },
    yAxis: { title: { text: '频数' }, labels: { style: { color: '#9aa4af' } } },
    tooltip: { shared: true },
    series: (() => {
      const colors = buildColors(signalsHist.length)
      return signalsHist.map((s, i) => ({
        type: 'line',
        name: s.label,
        color: colors[i % colors.length],
        data: (s.data||[]).map((b: any) => [((b.left + b.right) / 2.0), b.count])
      }))
    })(),
    credits: { enabled: false }
  })

  const toSeries = (ts: any[]) => (ts||[]).map(p => [new Date(/\d{8}/.test(p.date||p.time) ? `${String(p.date||p.time).slice(0,4)}-${String(p.date||p.time).slice(4,6)}-${String(p.date||p.time).slice(6,8)}` : p.date||p.time).getTime(), p.value])

  const mainChartOpt = useMemo(() => {
    if (chartType === 'pnl') {
      const linesPnl = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: s.label || `signal_${i+1}`, data: toSeries(s.pnl || []) }))
        : [{ name: '累计净值', data: toSeries(pnl) }]
      return lineOptionsMulti('累计净值', linesPnl)
    }
    if (chartType === 'pnl_dd') {
      const linesDd = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: (s.label || `signal_${i+1}`) + ' DD', data: toSeries(s.drawdown || []) }))
        : [{ name: '水下回撤', data: toSeries(dd) }]
      return lineOptionsMulti('水下回撤', linesDd)
    } else if (chartType === 'monthly_heatmap') {
      return (signals && signals.length > 1)
        ? heatmapOptionsMulti(signals.map((s, i) => ({ label: s.label || `signal_${i+1}`, data: (s.extra?.monthly_heatmap || []) })))
        : heatmapOptions(extra.monthly_heatmap || [])
    } else if (chartType === 'histogram') {
      return (signals && signals.length > 1)
        ? histogramOptionsMulti(signals.map((s, i) => ({ label: s.label || `signal_${i+1}`, data: (s.extra?.histogram || []) })))
        : histogramOptions(extra.histogram || [])
    } else if (chartType === 'rolling_sharpe') {
      const linesSharpe = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: s.label || `signal_${i+1}`, data: toSeries((s.extra?.rolling_sharpe)||[]) }))
        : [{ name: '累计夏普', data: toSeries(extra.rolling_sharpe||[]) }]
      return lineOptionsMulti('累计夏普', linesSharpe)
    } else if (chartType === 'rolling_vol') {
      const linesVol = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: s.label || `signal_${i+1}`, data: toSeries((s.extra?.rolling_vol)||[]) }))
        : [{ name: '累计波动率', data: toSeries(extra.rolling_vol||[]) }]
      return lineOptionsMulti('累计波动率', linesVol)
    } else if (chartType === 'ic_series') {
      const linesIC = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: s.label || `signal_${i+1}`, data: toSeries((s.extra?.ic_series)||[]) }))
        : [{ name: 'IC时间序列', data: toSeries(extra.ic_series||[]) }]
      return lineOptionsMulti('IC时间序列', linesIC)
    } else if (chartType === 'decile_spread') {
      const linesSpread = (signals && signals.length > 1)
        ? signals.map((s, i) => ({ name: s.label || `signal_${i+1}`, data: toSeries((s.extra?.decile_spread)||[]) }))
        : [{ name: '分位收益差', data: toSeries(extra.decile_spread||[]) }]
      return lineOptionsMulti('分位收益差', linesSpread)
    }
    // 默认：显示水下回撤
    const linesDd = (signals && signals.length > 1)
      ? signals.map((s, i) => ({ name: (s.label || `signal_${i+1}`) + ' DD', data: toSeries(s.drawdown || []) }))
      : [{ name: '水下回撤', data: toSeries(dd) }]
    return lineOptionsMulti('水下回撤', linesDd)
  }, [chartType, pnl, dd, extra, signals])

  const columns = Object.entries(metrics || {}).map(([k,v]) => ({ key: k, name: k, value: v }))

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Layout style={{ minHeight: '100vh', background: '#0d0f14' }}>
        <Header style={{ background: '#121620', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={4} style={{ color: '#e6edf3', margin: 0 }}>SCUTQUANT 回测终端（React + AntD 暗色）</Title>
          <Space>
            <Button onClick={() => setSettingsOpen(true)}>回测设置</Button>
          </Space>
        </Header>
        <Drawer title="回测设置（顶部下拉）" placement="top" open={settingsOpen} onClose={() => setSettingsOpen(false)} height={320}>
          <Form layout="inline" style={{ rowGap: 12 }}>
            <Form.Item label="持仓模式">
              <Select value={positionMode} onChange={setPositionMode} style={{ width: 150 }} options={[
                { value: 'long_only', label: '只做多' },
                { value: 'short_only', label: '只做空' },
                { value: 'long_short', label: '多空均可' },
              ]} />
            </Form.Item>
            <Form.Item label="初始资金量（元）">
              <InputNumber value={initialCapital} onChange={(v) => setInitialCapital(Number(v||500000))} style={{ width: 180 }} formatter={(v) => v ? `${v}` : ''} parser={(v) => Number((v||'').replace(/\s/g,''))} />
            </Form.Item>
            <Form.Item label="做多分位阈值">
              <InputNumber value={longThreshold} onChange={(v) => setLongThreshold(Number(v||0.7))} step={0.01} min={0} max={1} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="做空分位阈值">
              <InputNumber value={shortThreshold} onChange={(v) => setShortThreshold(Number(v||0.3))} step={0.01} min={0} max={1} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="日期范围">
              <DatePicker.RangePicker onChange={setDateRange} placeholder={["开始日期", "结束日期"]} />
            </Form.Item>
            <Form.Item label="股票代码">
              <Select
                mode="tags"
                value={codes}
                onChange={(vals) => setCodes(vals as string[])}
                style={{ minWidth: 260 }}
                placeholder="输入/选择股票代码，留空为全部"
                options={[]}
              />
            </Form.Item>
            <Form.Item label="T+选项">
              <Select value={tPlus} onChange={(v) => setTPlus(v as 't0'|'t1')} style={{ width: 120 }} options={[
                { value: 't0', label: 'T+0' },
                { value: 't1', label: 'T+1' },
              ]} />
            </Form.Item>
            <Form.Item label="单支权重上限">
              <InputNumber value={maxWeight} onChange={(v) => setMaxWeight(Number(v||0.05))} step={0.01} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="INF处理">
              <Select value={infToNan} onChange={(v) => setInfToNan(v as 'on'|'off')} style={{ width: 160 }} options={[
                { value: 'on', label: '将 ±inf 置为 NaN (默认)' },
                { value: 'off', label: '保留 ±inf' },
              ]} />
            </Form.Item>
            
          </Form>
        </Drawer>
        <Content style={{ padding: 16 }}>
          {/* 可拖拽左右分隔容器 */}
          <div ref={containerRef} style={{ display: 'flex', width: '100%', position: 'relative', userSelect: draggingSplit ? 'none' : 'auto' }}>
            {/* 左侧：表达式与预检 */}
            <div style={{ width: `${(splitRatio * 100).toFixed(2)}%`, paddingRight: 10, position: 'relative' }}>
              <Input.TextArea
                rows={16}
                value={expr}
                placeholder="例如: cs_rank(close - pre_close) / ts_std(close, 20)"
                style={{ fontFamily: 'Menlo, Monaco, Consolas, \"Courier New\", monospace' }}
                ref={textRef as any}
                onChange={(e) => {
                  const el = e.target as HTMLTextAreaElement
                  setExpr(el.value)
                  const idx = el.selectionStart || 0
                  setCaretPos(idx)
                  const { prefix } = calcPrefix(el.value, idx)
                  if (prefix && funcs.length > 0) {
                    const list = funcs.filter(f => f.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 50)
                    setSuggestions(list)
                    setSuggestOpen(list.length > 0)
                    setActiveIdx(0)
                    // 更新光标屏幕坐标
                    try {
                      const coords = getCaretCoordinates(el, idx)
                      setCaretCoords(coords)
                    } catch {
                      setCaretCoords(null)
                    }
                  } else {
                    setSuggestOpen(false)
                  }
                }}
                onKeyDown={(e) => {
                  if (!suggestOpen) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIdx(i => Math.min(i + 1, Math.max(suggestions.length - 1, 0)))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIdx(i => Math.max(i - 1, 0))
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    const el = textRef.current
                    if (!el) return
                    const idx = caretPos
                    const { prefix, start } = calcPrefix(expr, idx)
                    const pick = suggestions[activeIdx]
                    if (!pick) return
                    const newText = expr.slice(0, start) + pick + expr.slice(idx)
                    setExpr(newText)
                    // 将光标移到插入后的函数名末尾
                    setTimeout(() => {
                      try {
                        el.selectionStart = el.selectionEnd = start + pick.length
                        const coords = getCaretCoordinates(el, el.selectionEnd)
                        setCaretCoords(coords)
                      } catch {}
                    }, 0)
                    setCaretPos(start + pick.length)
                    setSuggestOpen(false)
                  } else if (e.key === 'Escape') {
                    setSuggestOpen(false)
                  }
                }}
                onClick={(e) => {
                  const el = e.target as HTMLTextAreaElement
                  const idx = el.selectionStart || 0
                  setCaretPos(idx)
                  try {
                    const coords = getCaretCoordinates(el, idx)
                    setCaretCoords(coords)
                  } catch {}
                }}
              />
              {suggestOpen && caretCoords && (
                <div
                  style={{
                    position: 'fixed',
                    top: caretCoords.top + 18,
                    left: caretCoords.left,
                    zIndex: 2000,
                    background: '#0d1117',
                    border: '1px solid #1f2328',
                    borderRadius: 6,
                    boxShadow: '0 8px 24px rgba(1,4,9,0.3)',
                    width: 280,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {suggestions.map((s, i) => (
                    <div
                      key={s}
                      onMouseDown={(ev) => {
                        ev.preventDefault()
                        const el = textRef.current
                        if (!el) return
                        const idx = caretPos
                        const { start } = calcPrefix(expr, idx)
                        const newText = expr.slice(0, start) + s + expr.slice(idx)
                        setExpr(newText)
                        setTimeout(() => {
                          try {
                            el.focus()
                            el.selectionStart = el.selectionEnd = start + s.length
                            const coords = getCaretCoordinates(el, el.selectionEnd)
                            setCaretCoords(coords)
                          } catch {}
                        }, 0)
                        setCaretPos(start + s.length)
                        setSuggestOpen(false)
                      }}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        background: i === activeIdx ? '#1b2230' : 'transparent',
                        color: '#e6edf3',
                        borderBottom: '1px solid #1f2328'
                      }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
              <Space style={{ marginTop: 12 }}>
                <Button onClick={previewExpr} disabled={loading}>表达式预检</Button>
                <Button type="primary" onClick={runBacktest} loading={loading}>运行回测</Button>
              </Space>
              {previewSample && previewSample.length > 0 && (
                <Card size="small" style={{ marginTop: 12, background: '#121620', border: '1px solid #1f2328' }} title={<span style={{ color: '#e6edf3' }}>预检结果（示例行，固定显示）</span>}>
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={previewSample.map((row, idx) => ({ key: idx, ...row }))}
                    columns={(previewColumns||[]).map((c) => ({ title: c, dataIndex: c }))}
                  />
                </Card>
              )}
            </div>
            {/* 分隔线 */}
            <div
              onMouseDown={() => setDraggingSplit(true)}
              style={{
                position: 'absolute',
                left: `${(splitRatio * 100).toFixed(2)}%`,
                top: 0,
                bottom: 0,
                width: 8,
                marginLeft: -4,
                cursor: 'col-resize',
                borderLeft: '1px solid #1f2328',
                borderRight: '1px solid #1f2328'
              }}
            />
            {/* 右侧：图表展示 */}
            <div style={{ width: `${((1 - splitRatio) * 100).toFixed(2)}%`, background: '#121620', padding: 12, borderRadius: 8, border: '1px solid #1f2328' }}>
              <Title level={5} style={{ color: '#e6edf3' }}>结果展示</Title>
              <Select value={chartType} onChange={v => setChartType(v as ChartType)} style={{ width: 240, marginBottom: 8 }} options={[
                { value: 'none', label: '不展示图表' },
                { value: 'pnl', label: '净值' },
                { value: 'pnl_dd', label: '回撤' },
                { value: 'monthly_heatmap', label: '月度热力图' },
                { value: 'histogram', label: '收益分布' },
                { value: 'rolling_sharpe', label: '累计夏普' },
                { value: 'rolling_vol', label: '累计波动率' },
                { value: 'ic_series', label: 'IC时间序列' },
                { value: 'decile_spread', label: '分位收益差' },
              ]} />
              {chartType === 'none' ? (
                <Text style={{ color: '#9aa4af' }}>未选择图表，右侧仅占 1/4 宽度。</Text>
               ) : (
                <div style={{ width: '100%' }}>
                  <HighchartsReact key={chartType} highcharts={Highcharts} constructorType={chartType==='monthly_heatmap'||chartType==='histogram'?'chart':'stockChart'} options={mainChartOpt} />
                  {/* 指标（分因子）固定展示在图表下方 */}
                  <Card size="small" style={{ marginTop: 12, background: '#121620', border: '1px solid #1f2328' }} title={<span style={{ color: '#e6edf3' }}>指标（分因子）</span>}>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={(Array.isArray(signals) && signals.length > 0)
                        ? signals.map((s, i) => ({
                            key: s.label || `signal_${i+1}`,
                            factor: s.label || `signal_${i+1}`,
                            days: s.metrics?.days,
                            cum_ret: s.metrics?.cum_ret,
                            avg_ret: s.metrics?.avg_ret,
                            vol: s.metrics?.vol,
                            sharpe: s.metrics?.sharpe,
                            ic_mean: s.metrics?.ic_mean,
                            ic_ir: s.metrics?.ic_ir,
                            start_nav: s.metrics?.start_nav,
                            final_nav: s.metrics?.final_nav,
                          }))
                        : [{
                            key: 'signal',
                            factor: 'signal',
                            days: (metrics as any)?.days,
                            cum_ret: (metrics as any)?.cum_ret,
                            avg_ret: (metrics as any)?.avg_ret,
                            vol: (metrics as any)?.vol,
                            sharpe: (metrics as any)?.sharpe,
                            ic_mean: (metrics as any)?.ic_mean,
                            ic_ir: (metrics as any)?.ic_ir,
                            start_nav: (metrics as any)?.start_nav,
                            final_nav: (metrics as any)?.final_nav,
                          }]}
                      columns={[
                        { title: '因子', dataIndex: 'factor' },
                        { title: 'days', dataIndex: 'days' },
                        { title: 'cum_ret', dataIndex: 'cum_ret' },
                        { title: 'avg_ret', dataIndex: 'avg_ret' },
                        { title: 'vol', dataIndex: 'vol' },
                        { title: 'sharpe', dataIndex: 'sharpe' },
                        { title: 'ic_mean', dataIndex: 'ic_mean' },
                        { title: 'ic_ir', dataIndex: 'ic_ir' },
                        { title: 'start_nav', dataIndex: 'start_nav' },
                        { title: 'final_nav', dataIndex: 'final_nav' },
                      ]}
                    />
                  </Card>
                </div>
               )}
            </div>
          </div>

        </Content>
        <CopilotChat />
        
      </Layout>
    </ConfigProvider>
  )
}
