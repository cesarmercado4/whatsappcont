const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "whatsapp.sqlite");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

function formatDateParts(dateObj) {
  const anio = dateObj.getFullYear();
  const mes = dateObj.getMonth() + 1;
  const dia = dateObj.getDate();
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const mi = String(dateObj.getMinutes()).padStart(2, "0");
  const ss = String(dateObj.getSeconds()).padStart(2, "0");

  return {
    anio,
    mes,
    dia,
    fecha: `${anio}-${mm}-${dd}`,
    fecha_hora: `${anio}-${mm}-${dd} ${hh}:${mi}:${ss}`,
  };
}

async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT NOT NULL,
      fecha_hora TEXT NOT NULL,
      fecha TEXT NOT NULL,
      anio INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      dia INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS conversacion_opciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT NOT NULL,
      fecha_hora TEXT NOT NULL,
      fecha TEXT NOT NULL,
      anio INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      dia INTEGER NOT NULL,
      opcion_codigo INTEGER NOT NULL,
      opcion_nombre TEXT NOT NULL,
      UNIQUE(telefono, fecha)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS contacto_estado (
      telefono TEXT PRIMARY KEY,
      ultima_interaccion_at TEXT NOT NULL,
      ultimo_menu_at TEXT,
      ultima_opcion_codigo INTEGER,
      ultima_opcion_nombre TEXT,
      ultima_opcion_at TEXT
    )
  `);

  await run("CREATE INDEX IF NOT EXISTS idx_mensajes_fecha ON mensajes(fecha)");
  await run("CREATE INDEX IF NOT EXISTS idx_mensajes_telefono ON mensajes(telefono)");
  await run("CREATE INDEX IF NOT EXISTS idx_mensajes_anio_mes ON mensajes(anio, mes)");
  await run("CREATE INDEX IF NOT EXISTS idx_mensajes_telefono_fecha ON mensajes(telefono, fecha)");

  await run("CREATE INDEX IF NOT EXISTS idx_conv_opt_fecha ON conversacion_opciones(fecha)");
  await run("CREATE INDEX IF NOT EXISTS idx_conv_opt_anio_mes ON conversacion_opciones(anio, mes)");
  await run("CREATE INDEX IF NOT EXISTS idx_conv_opt_codigo ON conversacion_opciones(opcion_codigo)");
}

async function saveIncomingMessage({ telefono, dateObj }) {
  const values = formatDateParts(dateObj);
  await run(
    `
      INSERT INTO mensajes (telefono, fecha_hora, fecha, anio, mes, dia)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      telefono,
      values.fecha_hora,
      values.fecha,
      values.anio,
      values.mes,
      values.dia,
    ]
  );
}

async function touchContact({ telefono, dateObj }) {
  const { fecha_hora } = formatDateParts(dateObj);
  await run(
    `
      INSERT INTO contacto_estado (telefono, ultima_interaccion_at)
      VALUES (?, ?)
      ON CONFLICT(telefono) DO UPDATE
      SET ultima_interaccion_at = excluded.ultima_interaccion_at
    `,
    [telefono, fecha_hora]
  );
}

async function getContactState(telefono) {
  const row = await get(
    `
      SELECT
        telefono,
        ultima_interaccion_at,
        ultimo_menu_at,
        ultima_opcion_codigo,
        ultima_opcion_nombre,
        ultima_opcion_at
      FROM contacto_estado
      WHERE telefono = ?
    `,
    [telefono]
  );
  return row || null;
}

async function recordMenuSent({ telefono, dateObj }) {
  const { fecha_hora } = formatDateParts(dateObj);
  await run(
    `
      INSERT INTO contacto_estado (telefono, ultima_interaccion_at, ultimo_menu_at)
      VALUES (?, ?, ?)
      ON CONFLICT(telefono) DO UPDATE
      SET
        ultima_interaccion_at = excluded.ultima_interaccion_at,
        ultimo_menu_at = excluded.ultimo_menu_at
    `,
    [telefono, fecha_hora, fecha_hora]
  );
}

async function recordOptionSelection({
  telefono,
  dateObj,
  opcionCodigo,
  opcionNombre,
}) {
  const values = formatDateParts(dateObj);

  await run(
    `
      INSERT INTO conversacion_opciones (
        telefono, fecha_hora, fecha, anio, mes, dia, opcion_codigo, opcion_nombre
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telefono, fecha) DO UPDATE
      SET
        fecha_hora = excluded.fecha_hora,
        opcion_codigo = excluded.opcion_codigo,
        opcion_nombre = excluded.opcion_nombre
    `,
    [
      telefono,
      values.fecha_hora,
      values.fecha,
      values.anio,
      values.mes,
      values.dia,
      opcionCodigo,
      opcionNombre,
    ]
  );

  await run(
    `
      INSERT INTO contacto_estado (
        telefono,
        ultima_interaccion_at,
        ultima_opcion_codigo,
        ultima_opcion_nombre,
        ultima_opcion_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telefono) DO UPDATE
      SET
        ultima_interaccion_at = excluded.ultima_interaccion_at,
        ultima_opcion_codigo = excluded.ultima_opcion_codigo,
        ultima_opcion_nombre = excluded.ultima_opcion_nombre,
        ultima_opcion_at = excluded.ultima_opcion_at
    `,
    [
      telefono,
      values.fecha_hora,
      opcionCodigo,
      opcionNombre,
      values.fecha_hora,
    ]
  );
}

async function getDailyConversations() {
  return all(
    `
      SELECT fecha, COUNT(DISTINCT telefono) AS conversaciones
      FROM mensajes
      GROUP BY fecha
      ORDER BY fecha
    `
  );
}

async function getMonthlyConversations() {
  return all(
    `
      SELECT
        anio,
        mes,
        COUNT(DISTINCT telefono || '|' || fecha) AS conversaciones
      FROM mensajes
      GROUP BY anio, mes
      ORDER BY anio, mes
    `
  );
}

async function getYearlyConversations() {
  return all(
    `
      SELECT
        anio,
        COUNT(DISTINCT telefono || '|' || fecha) AS conversaciones
      FROM mensajes
      GROUP BY anio
      ORDER BY anio
    `
  );
}

async function getTodayConversations() {
  const { fecha } = formatDateParts(new Date());
  const row = await get(
    `
      SELECT COUNT(DISTINCT telefono) AS conversaciones
      FROM mensajes
      WHERE fecha = ?
    `,
    [fecha]
  );
  return row?.conversaciones || 0;
}

async function getCurrentMonthConversations() {
  const now = new Date();
  const row = await get(
    `
      SELECT COUNT(DISTINCT telefono || '|' || fecha) AS conversaciones
      FROM mensajes
      WHERE anio = ? AND mes = ?
    `,
    [now.getFullYear(), now.getMonth() + 1]
  );
  return row?.conversaciones || 0;
}

async function getCurrentYearConversations() {
  const now = new Date();
  const row = await get(
    `
      SELECT COUNT(DISTINCT telefono || '|' || fecha) AS conversaciones
      FROM mensajes
      WHERE anio = ?
    `,
    [now.getFullYear()]
  );
  return row?.conversaciones || 0;
}

async function getSummary() {
  const [hoy, mes, anio] = await Promise.all([
    getTodayConversations(),
    getCurrentMonthConversations(),
    getCurrentYearConversations(),
  ]);

  return { hoy, mes, anio };
}

async function getOptionTotals() {
  return all(
    `
      SELECT
        opcion_codigo AS codigo,
        opcion_nombre AS nombre,
        COUNT(*) AS conversaciones
      FROM conversacion_opciones
      GROUP BY opcion_codigo, opcion_nombre
      ORDER BY opcion_codigo
    `
  );
}

async function getDailyConversationsByOption() {
  return all(
    `
      SELECT
        fecha,
        opcion_codigo AS codigo,
        opcion_nombre AS nombre,
        COUNT(*) AS conversaciones
      FROM conversacion_opciones
      GROUP BY fecha, opcion_codigo, opcion_nombre
      ORDER BY fecha, opcion_codigo
    `
  );
}

async function getMonthlyConversationsByOption() {
  return all(
    `
      SELECT
        anio,
        mes,
        opcion_codigo AS codigo,
        opcion_nombre AS nombre,
        COUNT(*) AS conversaciones
      FROM conversacion_opciones
      GROUP BY anio, mes, opcion_codigo, opcion_nombre
      ORDER BY anio, mes, opcion_codigo
    `
  );
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

module.exports = {
  initDatabase,
  saveIncomingMessage,
  touchContact,
  getContactState,
  recordMenuSent,
  recordOptionSelection,
  getDailyConversations,
  getMonthlyConversations,
  getYearlyConversations,
  getTodayConversations,
  getCurrentMonthConversations,
  getCurrentYearConversations,
  getSummary,
  getOptionTotals,
  getDailyConversationsByOption,
  getMonthlyConversationsByOption,
  closeDatabase,
};
