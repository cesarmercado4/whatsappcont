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

const INVALID_OPTION_TEXT =
  "⚠️ Por favor: ingrese un numero del menu para continuar.";

const OPTION_LABELS = {
  1: "Energia",
  2: "Agua",
  3: "Telefonia / Internet / Television",
  4: "Consulta Administrativa",
};

const contactLocks = new Map();

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
  const cleaned = String(text || "").trim();
  if (!/^[1-4]$/.test(cleaned)) return null;
  return Number(cleaned);
}

function buildOptionConfirmation(optionCode) {
  const label = OPTION_LABELS[optionCode] || "la opcion";
  return `✅ Gracias, seleccionaste ${label}. En breve un responsable se comunicara con vos.`;
}

function normalizeStateForFlow(state) {
  const estado = state?.estado_conversacion || "sin_estado";
  const botActivo = state?.bot_activo === 0 ? false : true;
  return { estado, botActivo };
}

function formatStateLabel(estado, botActivo) {
  return `${estado}|bot_activo=${botActivo ? "true" : "false"}`;
}

function logBotFlow({
  telefono,
  messageId,
  tipoEvento,
  estadoAntes,
  accionTomada,
  estadoDespues,
}) {
  console.log(
    `[BotFlow] telefono=${telefono} message_id=${messageId} tipo_evento=${tipoEvento} ` +
      `estado_antes=${estadoAntes} accion_tomada=${accionTomada} estado_despues=${estadoDespues}`
  );
}

async function withContactLock(telefono, handler) {
  while (contactLocks.has(telefono)) {
    await contactLocks.get(telefono);
  }

  let release;
  const lockPromise = new Promise((resolve) => {
    release = resolve;
  });
  contactLocks.set(telefono, lockPromise);

  try {
    return await handler();
  } finally {
    contactLocks.delete(telefono);
    release();
  }
}

async function bootstrap() {
  try {
    await db.initDatabase();
    console.log("[DB] SQLite inicializada.");

    const waService = createWhatsAppService({
      onIncomingMessage: async ({
        messageId,
        tipoEvento = "incoming_message",
        telefono,
        dateObj,
        text,
      }) => {
        return withContactLock(telefono, async () => {
          const inserted = await db.saveIncomingMessage({ messageId, telefono, dateObj });
          if (!inserted) {
            const duplicatedState = normalizeStateForFlow(await db.getContactState(telefono));
            logBotFlow({
              telefono,
              messageId,
              tipoEvento,
              estadoAntes: formatStateLabel(duplicatedState.estado, duplicatedState.botActivo),
              accionTomada: "ignorar_duplicado_message_id",
              estadoDespues: formatStateLabel(duplicatedState.estado, duplicatedState.botActivo),
            });
            return { replyText: null };
          }

          const stateBefore = normalizeStateForFlow(await db.getContactState(telefono));
          const estadoAntesLabel = formatStateLabel(stateBefore.estado, stateBefore.botActivo);

          // Una vez derivado a humano o bot inactivo, el bot no interviene mas.
          if (stateBefore.estado === "derivado_a_humano" || !stateBefore.botActivo) {
            await db.touchContact({ telefono, dateObj });
            logBotFlow({
              telefono,
              messageId,
              tipoEvento,
              estadoAntes: estadoAntesLabel,
              accionTomada: "ignorar_bot_inactivo",
              estadoDespues: estadoAntesLabel,
            });
            return { replyText: null };
          }

          if (stateBefore.estado === "esperando_opcion") {
            const optionCode = parseOptionCode(text);
            if (optionCode) {
              const optionName = OPTION_LABELS[optionCode];
              await db.recordOptionSelection({
                telefono,
                dateObj,
                opcionCodigo: optionCode,
                opcionNombre: optionName,
              });
              logBotFlow({
                telefono,
                messageId,
                tipoEvento,
                estadoAntes: estadoAntesLabel,
                accionTomada: `confirmar_opcion_${optionCode}`,
                estadoDespues: "derivado_a_humano|bot_activo=false",
              });
              return { replyText: buildOptionConfirmation(optionCode) };
            }

            await db.recordMenuSent({ telefono, dateObj });
            logBotFlow({
              telefono,
              messageId,
              tipoEvento,
              estadoAntes: estadoAntesLabel,
              accionTomada: "opcion_invalida_reenviar_menu",
              estadoDespues: "esperando_opcion|bot_activo=true",
            });
            return { replyText: `${INVALID_OPTION_TEXT}\n\n${MENU_TEXT}` };
          }

          // Primer contacto (sin estado): enviar menu inicial y quedar esperando opcion.
          await db.recordMenuSent({ telefono, dateObj });
          logBotFlow({
            telefono,
            messageId,
            tipoEvento,
            estadoAntes: estadoAntesLabel,
            accionTomada: "enviar_menu_inicial",
            estadoDespues: "esperando_opcion|bot_activo=true",
          });
          return { replyText: MENU_TEXT };
        });
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
