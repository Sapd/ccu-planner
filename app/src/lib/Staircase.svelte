<script>
  import { onMount } from 'svelte';
  import * as echarts from 'echarts/core';
  import { LineChart } from 'echarts/charts';
  import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { staircase, chartSeries, tooltipText } from './view/staircase.mjs';
  import { backend } from './backend.js';
  import { usd } from '$logic/format.mjs';

  echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

  let { route, ships } = $props();
  const stair = $derived(staircase(route, ships));
  // Same kind colours as GraphTab: owned = own (grey), Warbond = buy now (green), Standard = wait (purple); values of --own/--now/--wait.
  const COLORS = { owned: '#64748b', standard: '#a78bfa', warbond: '#3ddc97' };
  const LABELS = { owned: 'Owned', standard: 'Standard', warbond: 'Warbond' };

  let el;
  let chart;

  function option(s) {
    const series = chartSeries(s);
    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 56, right: 16, top: 30, bottom: 56 },
      legend: { top: 0, textStyle: { color: '#a3afc2' } },
      tooltip: {
        trigger: 'axis',
        formatter: (items) => tooltipText(s, items, backend.imageSrc),
      },
      xAxis: {
        type: 'value', min: 0, max: Math.max(1, s.points.length - 1), interval: 1,
        axisLabel: { color: '#a3afc2', rotate: 35, hideOverlap: true, formatter: (v) => s.points[v]?.ship ?? '' },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
      },
      yAxis: {
        type: 'value', axisLabel: { color: '#a3afc2', formatter: (v) => usd(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
      },
      series: Object.entries(series).map(([kind, data]) => ({
        name: LABELS[kind] ?? kind, type: 'line', data, showSymbol: true, symbolSize: 7,
        lineStyle: { color: COLORS[kind] ?? '#a3afc2', width: 3 }, itemStyle: { color: COLORS[kind] ?? '#a3afc2' },
      })),
    };
  }

  onMount(() => {
    chart = echarts.init(el);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => { ro.disconnect(); chart.dispose(); chart = null; };
  });

  $effect(() => {
    const s = stair;
    if (chart && !s.empty) chart.setOption(option(s), true);
  });
</script>

{#if stair.empty}
  <p class="none">No route today</p>
{/if}
<div class="chart" bind:this={el} hidden={stair.empty}></div>

<style>
  .chart { height: 280px; width: 100%; }
  .chart[hidden] { display: none; }
  .none { color: var(--muted); padding: 8px 0; margin: 0; }
</style>
