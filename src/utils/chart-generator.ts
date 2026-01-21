import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ChartDataPoint } from '../tools/finance/chart.ts';

const execAsync = promisify(exec);

export interface ChartOptions {
  data: ChartDataPoint[];
  title?: string;
  type?: 'line' | 'bar' | 'area' | 'scatter' | 'pie' | 'doughnut' | 'radar' | 'candlestick';
  xLabel?: string;
  yLabel?: string;
}

function formatValue(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function getChartConfig(type: string, values: number[], labels: string[], yLabel: string, data: any[]) {
  const colors = [
    'rgba(54, 162, 235, 0.6)', 'rgba(255, 99, 132, 0.6)', 'rgba(75, 192, 192, 0.6)',
    'rgba(255, 206, 86, 0.6)', 'rgba(153, 102, 255, 0.6)', 'rgba(255, 159, 64, 0.6)'
  ];

  if (type === 'candlestick') {
    const ohlcData = data.map((d: any, i: number) => ({
      o: d.open ?? values[i] * 0.99,
      h: d.high ?? values[i] * 1.01,
      l: d.low ?? values[i] * 0.98,
      c: d.close ?? values[i]
    }));
    return {
      labels,
      datasets: [{
        label: 'High',
        data: ohlcData.map(d => d.h),
        backgroundColor: 'rgba(75, 192, 192, 0.3)',
        borderColor: 'rgba(75, 192, 192, 1)'
      }, {
        label: 'Open',
        data: ohlcData.map(d => d.o),
        backgroundColor: 'rgba(54, 162, 235, 0.5)',
        borderColor: 'rgba(54, 162, 235, 1)'
      }, {
        label: 'Close',
        data: ohlcData.map(d => d.c),
        backgroundColor: 'rgba(255, 206, 86, 0.5)',
        borderColor: 'rgba(255, 206, 86, 1)'
      }, {
        label: 'Low',
        data: ohlcData.map(d => d.l),
        backgroundColor: 'rgba(255, 99, 132, 0.3)',
        borderColor: 'rgba(255, 99, 132, 1)'
      }]
    };
  }

  if (type === 'pie' || type === 'doughnut') {
    return {
      labels,
      datasets: [{
        label: yLabel,
        data: values,
        backgroundColor: colors.slice(0, values.length),
        borderColor: colors.slice(0, values.length).map(c => c.replace('0.6', '1')),
        borderWidth: 2
      }]
    };
  }

  if (type === 'radar') {
    return {
      labels,
      datasets: [{
        label: yLabel,
        data: values,
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(54, 162, 235, 1)'
      }]
    };
  }

  if (type === 'scatter') {
    return {
      datasets: [{
        label: yLabel,
        data: values.map((v, i) => ({ x: i, y: v })),
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 2
      }]
    };
  }

  const bgColor = type === 'bar' ? 'rgba(54, 162, 235, 0.6)' 
    : type === 'area' ? 'rgba(54, 162, 235, 0.3)' 
    : 'rgba(54, 162, 235, 0.2)';

  return {
    labels,
    datasets: [{
      label: yLabel,
      data: values,
      backgroundColor: bgColor,
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 2,
      fill: type === 'area' || type === 'line',
      tension: (type === 'line' || type === 'area') ? 0.4 : 0
    }]
  };
}

function getChartOptions(type: string, title: string | undefined, xLabel: string, yLabel: string) {
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, labels: { color: '#e0e0e0' } },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#e0e0e0',
        bodyColor: '#e0e0e0',
        borderColor: '#58a6ff',
        borderWidth: 1,
        callbacks: {
          label: function(context: any) {
            const val = context.parsed?.y ?? context.parsed ?? context.raw;
            return `${context.dataset.label}: ${formatValue(val)}`;
          }
        }
      },
      title: {
        display: !!title,
        text: title || '',
        color: '#e0e0e0',
        font: { size: 18 }
      }
    }
  };

  if (type === 'pie' || type === 'doughnut' || type === 'radar') {
    return baseOptions;
  }

  if (type === 'scatter') {
    return {
      ...baseOptions,
      scales: {
        x: { 
          type: 'linear',
          position: 'bottom',
          ticks: { color: '#a0a0a0' }, 
          grid: { color: 'rgba(255, 255, 255, 0.1)' } 
        },
        y: {
          ticks: { color: '#a0a0a0', callback: formatValue },
          grid: { color: 'rgba(255, 255, 255, 0.1)' }
        }
      }
    };
  }

  return {
    ...baseOptions,
    scales: {
      x: { ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
      y: {
        ticks: { color: '#a0a0a0', callback: formatValue },
        grid: { color: 'rgba(255, 255, 255, 0.1)' }
      }
    }
  };
}

export function generateChartHTML(options: ChartOptions): string {
  const { data, title, type = 'line', xLabel = 'Period', yLabel = 'Value' } = options;
  const labels = data.map(d => d.label || d.date || '');
  const values = data.map(d => d.value);
  const chartData = getChartConfig(type, values, labels, yLabel, data);
  const chartOptions = getChartOptions(type, title, xLabel, yLabel);

  const chartType = type === 'candlestick' ? 'bar' : type;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title || 'Financial Chart'}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #1e1e1e; color: #e0e0e0; }
        .container { max-width: 1200px; margin: 0 auto; background: #2d2d2d; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3); }
        h1 { margin: 0 0 20px 0; color: #58a6ff; font-size: 24px; }
        .chart-container { position: relative; height: 400px; margin: 20px 0; }
        .info { margin-top: 20px; padding: 15px; background: #3d3d3d; border-radius: 4px; font-size: 14px; }
        .info-item { margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${title || 'Financial Chart'}</h1>
        <div class="chart-container"><canvas id="chart"></canvas></div>
        <div class="info">
            <div class="info-item"><strong>Chart Type:</strong> ${type}</div>
            <div class="info-item"><strong>Data Points:</strong> ${data.length}</div>
            ${type !== 'pie' && type !== 'doughnut' ? `
            <div class="info-item"><strong>Min:</strong> ${formatValue(Math.min(...values))}</div>
            <div class="info-item"><strong>Max:</strong> ${formatValue(Math.max(...values))}</div>
            <div class="info-item"><strong>Average:</strong> ${formatValue(values.reduce((a, b) => a + b, 0) / values.length)}</div>
            ` : ''}
        </div>
    </div>
    <script>
        const ctx = document.getElementById('chart').getContext('2d');
        new Chart(ctx, {
            type: '${chartType}',
            data: ${JSON.stringify(chartData)},
            options: ${JSON.stringify(chartOptions)}
        });
        function formatValue(value) {
            if (value >= 1e12) return '\\$' + (value / 1e12).toFixed(2) + 'T';
            if (value >= 1e9) return '\\$' + (value / 1e9).toFixed(2) + 'B';
            if (value >= 1e6) return '\\$' + (value / 1e6).toFixed(2) + 'M';
            if (value >= 1e3) return '\\$' + (value / 1e3).toFixed(2) + 'K';
            return '\\$' + value.toFixed(2);
        }
    </script>
</body>
</html>`;
}

export async function saveChartAsHTML(
  options: ChartOptions,
  filename?: string,
  openInBrowser: boolean = true
): Promise<string> {
  const chartsDir = '.dexter/charts';
  if (!existsSync(chartsDir)) {
    mkdirSync(chartsDir, { recursive: true });
  }

  if (!filename) {
    const timestamp = Date.now();
    const safeTitle = (options.title || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    filename = `${safeTitle}_${timestamp}.html`;
  }

  const filepath = join(chartsDir, filename);
  writeFileSync(filepath, generateChartHTML(options), 'utf-8');

  if (openInBrowser) {
    try {
      const cmd = process.platform === 'darwin' ? `open "${filepath}"`
        : process.platform === 'win32' ? `start "" "${filepath}"`
        : `xdg-open "${filepath}"`;
      await execAsync(cmd);
    } catch {
      // Ignore browser open errors
    }
  }

  return filepath;
}
