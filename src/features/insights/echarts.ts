/**
 * Tree-shaken ECharts. Registering only what's used keeps the Insights chunk
 * small, and the Insights route is itself lazy-loaded so the logging path never
 * downloads any of this.
 */

import * as core from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

core.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  MarkLineComponent,
  CanvasRenderer,
])

export const echarts = core
