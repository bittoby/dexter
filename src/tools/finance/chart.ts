import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { saveChartAsHTML } from '../../utils/chart-generator.js';

export interface ChartDataPoint {
  value: number;
  label?: string;
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}`;
  } catch {
    return dateStr.slice(0, 10);
  }
}

export function pricesToChartData(prices: unknown[], valueField: string = 'close'): ChartDataPoint[] {
  if (!Array.isArray(prices)) return [];
  
  const chartData: ChartDataPoint[] = [];
  for (const price of prices) {
    const p = price as Record<string, unknown>;
    const value = p[valueField] as number | undefined;
    if (value === undefined || isNaN(value)) continue;

    const date = (p.date || p.timestamp || '') as string;
    chartData.push({
      value,
      label: date ? formatDateLabel(date) : undefined,
      date,
    });
  }
  return chartData;
}

export function metricsToChartData(metrics: unknown[], metricField: string): ChartDataPoint[] {
  if (!Array.isArray(metrics)) return [];
  
  const chartData: ChartDataPoint[] = [];
  for (const metric of metrics) {
    const m = metric as Record<string, unknown>;
    const value = m[metricField] as number | undefined;
    if (value === undefined || isNaN(value)) continue;

    const date = (m.report_period || m.date || '') as string;
    let label: string | undefined;
    
    if (date) {
      label = formatDateLabel(date);
    } else if (m.fiscal_year && m.quarter) {
      label = `Q${m.quarter} ${m.fiscal_year}`;
    } else if (m.year && m.quarter) {
      label = `Q${m.quarter} ${m.year}`;
    } else if (m.fiscal_year || m.year) {
      label = String(m.fiscal_year || m.year);
    }

    chartData.push({ value, label, date: date || undefined });
  }
  return chartData;
}

const ChartInputSchema = z.object({
  data: z.any(),
  title: z.string().optional(),
  type: z.enum(['line', 'bar', 'area', 'scatter', 'pie', 'doughnut', 'radar', 'candlestick']).default('line'),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});

function normalizeChartData(data: unknown): ChartDataPoint[] {
  if (!data) {
    throw new Error('Data is required');
  }

  const result: ChartDataPoint[] = [];

  // Handle object format (e.g., segmented revenues: { "iPhone": 50000000000, "Services": 20000000000 })
  if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
    const obj = data as Record<string, unknown>;
    
    // Check if it's a segmented revenue object (keys are segment names, values are numbers)
    const entries = Object.entries(obj);
    if (entries.length > 0) {
      const firstValue = entries[0][1];
      // If first value is a number, treat keys as labels
      if (typeof firstValue === 'number' || (typeof firstValue === 'string' && !isNaN(parseFloat(firstValue)))) {
        for (const [key, value] of entries) {
          const num = typeof value === 'number' ? value : parseFloat(String(value));
          if (!isNaN(num)) {
            result.push({ value: num, label: key });
          }
        }
        if (result.length > 0) return result;
      }
      
      // If first value is an object, might be time-series with segments (e.g., { "2024-01-31": { "iPhone": 50B, "Services": 20B } })
      if (firstValue && typeof firstValue === 'object' && !Array.isArray(firstValue)) {
        // Get the most recent period's segments
        const latestPeriod = entries[entries.length - 1];
        const segments = latestPeriod[1] as Record<string, unknown>;
        for (const [segmentName, segmentValue] of Object.entries(segments)) {
          const num = typeof segmentValue === 'number' ? segmentValue : parseFloat(String(segmentValue));
          if (!isNaN(num)) {
            result.push({ value: num, label: segmentName });
          }
        }
        if (result.length > 0) return result;
      }
    }
  }

  // Handle array format
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array or object with numeric values');
  }

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    
    if (typeof item === 'number') {
      result.push({ value: item, label: `Point ${i + 1}` });
    } else if (typeof item === 'string') {
      const num = parseFloat(item);
      if (!isNaN(num)) {
        result.push({ value: num, label: `Point ${i + 1}` });
      }
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const value = typeof obj.value === 'number' ? obj.value 
        : typeof obj.value === 'string' ? parseFloat(obj.value) || 0
        : typeof obj.net_income === 'number' ? obj.net_income
        : typeof obj.total_revenue === 'number' ? obj.total_revenue
        : typeof obj.revenue === 'number' ? obj.revenue
        : typeof obj.close === 'number' ? obj.close
        : 0;
      
      if (value === 0 && !obj.value && !obj.net_income && !obj.total_revenue && !obj.revenue && !obj.close) {
        continue;
      }

      result.push({
        value,
        label: typeof obj.label === 'string' ? obj.label
          : typeof obj.report_period === 'string' ? formatDateLabel(obj.report_period)
          : typeof obj.date === 'string' ? formatDateLabel(obj.date)
          : typeof obj.fiscal_year === 'number' && typeof obj.quarter === 'number' ? `Q${obj.quarter} ${obj.fiscal_year}`
          : typeof obj.year === 'number' && typeof obj.quarter === 'number' ? `Q${obj.quarter} ${obj.year}`
          : typeof obj.fiscal_year === 'number' ? String(obj.fiscal_year)
          : typeof obj.year === 'number' ? String(obj.year)
          : undefined,
        date: typeof obj.date === 'string' ? obj.date
          : typeof obj.report_period === 'string' ? obj.report_period
          : undefined,
        open: typeof obj.open === 'number' ? obj.open : typeof obj.open === 'string' ? parseFloat(obj.open) : undefined,
        high: typeof obj.high === 'number' ? obj.high : typeof obj.high === 'string' ? parseFloat(obj.high) : undefined,
        low: typeof obj.low === 'number' ? obj.low : typeof obj.low === 'string' ? parseFloat(obj.low) : undefined,
        close: typeof obj.close === 'number' ? obj.close : typeof obj.close === 'string' ? parseFloat(obj.close) : undefined,
      });
    }
  }

  if (result.length === 0) {
    throw new Error('No valid numeric data found in input');
  }

  return result;
}

export const generateChart = new DynamicStructuredTool({
  name: 'generate_chart',
  description: `Generates interactive HTML chart from financial time series data. Opens automatically in browser. Use when user asks to visualize, chart, graph, or plot data.
  
  Input data can be:
  - Array of numbers: [100, 200, 150]
  - Array of objects with 'value' field: [{value: 100, label: "Q1"}, {value: 200, label: "Q2"}]
  - Array of financial statement objects: Will auto-extract revenue/income/close values
  
  Supported chart types:
  - line: Line chart for trends over time
  - bar: Bar chart for comparisons
  - area: Filled area chart for cumulative data
  - scatter: Scatter plot for correlations
  - pie: Pie chart for proportions
  - doughnut: Doughnut chart for proportions
  - radar: Radar chart for multi-metric comparison
  - candlestick: Candlestick chart for OHLC price data (requires open, high, low, close fields)`,
  schema: ChartInputSchema,
  func: async (input) => {
    try {
      const normalizedData = normalizeChartData(input.data);
      
      const filepath = await saveChartAsHTML({
        data: normalizedData,
        title: input.title || 'Financial Chart',
        type: input.type || 'line',
        xLabel: input.xLabel || 'Period',
        yLabel: input.yLabel || 'Value',
      }, undefined, true);

      return formatToolResult({
        success: true,
        message: 'Chart generated and opened in browser',
        filepath,
        chartType: input.type || 'line',
        dataPoints: normalizedData.length,
      }, []);
    } catch (error) {
      return formatToolResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, []);
    }
  },
});
