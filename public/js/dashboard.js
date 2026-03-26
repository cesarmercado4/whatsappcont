let dailyChartRef = null;
let monthlyChartRef = null;
let optionsChartRef = null;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function createBarChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Conversaciones",
          data: values,
          backgroundColor: color,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function renderDailyTable(rows) {
  const body = document.getElementById("daily-table-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="2" class="text-center text-muted py-3">Sin datos aun.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.fecha}</td>
        <td>${row.conversaciones}</td>
      </tr>
    `
    )
    .join("");
}

function renderMonthlyTable(rows) {
  const body = document.getElementById("monthly-table-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">Sin datos aun.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.anio}</td>
        <td>${String(row.mes).padStart(2, "0")}</td>
        <td>${row.conversaciones}</td>
      </tr>
    `
    )
    .join("");
}

function renderOptionsTable(rows) {
  const body = document.getElementById("options-table-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">Sin datos aun.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.codigo}</td>
        <td>${row.nombre}</td>
        <td>${row.conversaciones}</td>
      </tr>
    `
    )
    .join("");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error ${response.status} en ${url}`);
  }
  return response.json();
}

async function loadDashboard() {
  try {
    const [summary, daily, monthly, optionTotals] = await Promise.all([
      fetchJson("/stats/summary"),
      fetchJson("/stats/daily"),
      fetchJson("/stats/monthly"),
      fetchJson("/stats/options/totals"),
    ]);

    setText("metric-hoy", summary.hoy || 0);
    setText("metric-mes", summary.mes || 0);
    setText("metric-anio", summary.anio || 0);

    renderDailyTable(daily);
    renderMonthlyTable(monthly);
    renderOptionsTable(optionTotals);

    if (dailyChartRef) dailyChartRef.destroy();
    if (monthlyChartRef) monthlyChartRef.destroy();
    if (optionsChartRef) optionsChartRef.destroy();

    dailyChartRef = createBarChart(
      "dailyChart",
      daily.map((row) => row.fecha),
      daily.map((row) => row.conversaciones),
      "#0d6efd"
    );

    monthlyChartRef = createBarChart(
      "monthlyChart",
      monthly.map((row) => row.periodo),
      monthly.map((row) => row.conversaciones),
      "#198754"
    );

    optionsChartRef = createBarChart(
      "optionsChart",
      optionTotals.map((row) => `${row.codigo} - ${row.nombre}`),
      optionTotals.map((row) => row.conversaciones),
      "#fd7e14"
    );
  } catch (error) {
    console.error("No se pudo cargar el dashboard:", error.message);
  }
}

loadDashboard();
