require("dotenv").config();

const path = require("path");
const express = require("express");

const db = require("./database");
const { createStatsRouter } = require("./routes/stats");
const { createWhatsAppService } = require("./whatsapp");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const MENU_TEXT = [
  "👋 ¡Hola! Bienvenido/a a Corpico.",
  "Gracias por comunicarte con nosotros 🤝",
  "",
  "Por favor selecciona una opcion para ayudarte mejor:",
  "1️⃣ Energia",
  "2️⃣ Agua",
  "3️⃣ Telefonia / Internet / Television",
  "4️⃣ Consulta Administrativa",
  "",
  "Responde con el numero de opcion (1, 2, 3 o 4).",
].join("\n");

const OPTION_LABELS = {
  1: "Energia",
  2: "Agua",
  3: "Telefonia / Internet / Television",
  4: "Consulta Administrativa",
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("dashboard", {
    appName: "Conversaciones WhatsApp",
  });
});

app.use("/stats", createStatsRouter(db));

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

app.use((err, req, res, next) => {
  console.error("[Server] Error no controlado:", err);
  res.status(500).json({ error: "Error interno del servidor." });
});

function parseOptionCode(text) {
  const cleaned = String(text || "").trim().toLowerCase();
  const match = cleaned.match(/[1-4]/);
  if (!match) return null;
  return Number(match[0]);
}

function isMenuKeyword(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return cleaned === "hola" || cleaned === "menu" || cleaned === "opciones";
}

function dateOnlyFromDateTime(value) {
  if (!value || typeof value !== "string") return null;
  return value.slice(0, 10);
}

function dateOnlyFromDateObj(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function diffDays(olderIsoDate, newerIsoDate) {
  if (!olderIsoDate || !newerIsoDate) return Infinity;
  const [y1, m1, d1] = olderIsoDate.split("-").map(Number);
  const [y2, m2, d2] = newerIsoDate.split("-").map(Number);
  const ms1 = Date.UTC(y1, m1 - 1, d1);
  const ms2 = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((ms2 - ms1) / 86400000);
}

function shouldShowMenu({ state, dateObj }) {
  const currentDate = dateOnlyFromDateObj(dateObj);
  const lastOptionDate = dateOnlyFromDateTime(state?.ultima_opcion_at);
  const lastMenuDate = dateOnlyFromDateTime(state?.ultimo_menu_at);

  const noPreviousOption = !lastOptionDate;
  const daysSinceLastOption = diffDays(lastOptionDate, currentDate);
  const optionExpired = daysSinceLastOption >= 3;
  const menuAlreadySentToday = lastMenuDate === currentDate;

  return (noPreviousOption || optionExpired) && !menuAlreadySentToday;
}

function buildOptionConfirmation(optionCode) {
  const label = OPTION_LABELS[optionCode] || "la opcion";
  return `✅ Gracias, seleccionaste ${label}. En breve un responsable se comunicara con vos.`;
}

async function bootstrap() {
  try {
    await db.initDatabase();
    console.log("[DB] SQLite inicializada.");

    const waService = createWhatsAppService({
      onIncomingMessage: async ({ telefono, dateObj, text }) => {
        await db.saveIncomingMessage({ telefono, dateObj });
        await db.touchContact({ telefono, dateObj });

        const optionCode = parseOptionCode(text);
        if (optionCode) {
          const optionName = OPTION_LABELS[optionCode];
          await db.recordOptionSelection({
            telefono,
            dateObj,
            opcionCodigo: optionCode,
            opcionNombre: optionName,
          });
          return { replyText: buildOptionConfirmation(optionCode) };
        }

        if (isMenuKeyword(text)) {
          await db.recordMenuSent({ telefono, dateObj });
          return { replyText: MENU_TEXT };
        }

        const state = await db.getContactState(telefono);
        if (shouldShowMenu({ state, dateObj })) {
          await db.recordMenuSent({ telefono, dateObj });
          return { replyText: MENU_TEXT };
        }

        return { replyText: null };
      },
    });

    waService.start().catch((error) => {
      console.error("[WhatsApp] Error al iniciar servicio:", error.message);
    });

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Dashboard disponible en http://0.0.0.0:${PORT}`);
    });

    const shutdown = async () => {
      console.log("\n[Server] Cerrando servicios...");
      try {
        await waService.stop();
      } catch (error) {
        console.error("[Server] Error cerrando WhatsApp:", error.message);
      }
      try {
        await db.closeDatabase();
      } catch (error) {
        console.error("[Server] Error cerrando DB:", error.message);
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("[Bootstrap] Error critico:", error);
    process.exit(1);
  }
}

bootstrap();
