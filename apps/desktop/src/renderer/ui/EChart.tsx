import { useEffect, useRef } from 'react'
import { BarChart, LineChart, PieChart, type BarSeriesOption, type LineSeriesOption, type PieSeriesOption } from 'echarts/charts'
import {
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  type GraphicComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption
} from 'echarts/components'
import { init, use, type ComposeOption } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([BarChart, LineChart, PieChart, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

export type DashboardChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GraphicComponentOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
>

export function EChart({ option, height, ariaLabel }: { option: DashboardChartOption; height: number; ariaLabel: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current) return
    const chart = init(container.current, undefined, { renderer: 'canvas' })
    chart.setOption(option)
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [option])
  return <div ref={container} className="chart-container" style={{ height }} role="img" aria-label={ariaLabel} />
}
