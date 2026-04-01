const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

function normalizePhone(rawId) {
  if (!rawId) return null;
  const idPart = String(rawId).split("@")[0];
  const digits = idPart.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function toDateFromMessageTimestamp(timestamp) {
  if (!timestamp) return new Date();
  return new Date(Number(timestamp) * 1000);
}

function getMessageId(message, chatId) {
  const serialized = message?.id?._serialized;
  if (serialized && typeof serialized === "string") return serialized;

  const fallbackSource = [
    chatId || "",
    String(message?.timestamp || ""),
    String(message?.body || ""),
    String(message?.type || ""),
  ].join("|");

  return `fallback_${crypto.createHash("sha1").update(fallbackSource).digest("hex")}`;
}

const WA_CLIENT_ID = process.env.WA_CLIENT_ID || "conversaciones";
const WA_AUTH_PATH = path.resolve(process.env.WA_AUTH_PATH || ".wwebjs_auth");
const BOT_START_TIME = "2026-04-01 10:30:00";

function parseBotStartTimeToMs(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) {
    throw new Error(`[WhatsApp] BOT_START_TIME invalido: ${value}`);
  }
  const [, yy, mm, dd, hh, mi, ss] = match;
  const date = new Date(
    Number(yy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss)
  );
  return date.getTime();
}

function formatDateTime(dateObj) {
  const y = String(dateObj.getFullYear());
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const mi = String(dateObj.getMinutes()).padStart(2, "0");
  const ss = String(dateObj.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mi}:${ss}`;
}

const BOT_START_TIME_MS = parseBotStartTimeToMs(BOT_START_TIME);

function clearStaleChromiumLocks() {
  const sessionDir = path.join(WA_AUTH_PATH, `session-${WA_CLIENT_ID}`);
  const lockFiles = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    path.join("Default", "LOCK"),
  ];

  for (const file of lockFiles) {
    try {
      fs.rmSync(path.join(sessionDir, file), { force: true });
    } catch (_) {
      // Ignore stale lock cleanup errors and continue startup.
    }
  }
}

function createWhatsAppService({ onIncomingMessage }) {
  let client = null;
  let reconnectTimer = null;
  let stopping = false;

  const buildClient = () => {
    clearStaleChromiumLocks();
    return new Client({
      authStrategy: new LocalAuth({
        clientId: WA_CLIENT_ID,
        dataPath: WA_AUTH_PATH,
      }),
      puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      },
    });
  };

  const scheduleReconnect = () => {
    if (stopping || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      console.log("[WhatsApp] Intentando reconectar...");
      try {
        if (client) await client.destroy();
      } catch (error) {
        console.error("[WhatsApp] Error al cerrar cliente anterior:", error.message);
      }
      client = buildClient();
      bindClientEvents(client);
      client.initialize().catch((err) => {
        console.error("[WhatsApp] Fallo al reinicializar:", err.message);
        scheduleReconnect();
      });
    }, 5000);
  };

  const bindClientEvents = (waClient) => {
    if (waClient.listenerCount("message") > 0) {
      console.warn("[WhatsApp] Se detectaron listeners previos de 'message'. Limpiando duplicados.");
      waClient.removeAllListeners("message");
    }

    waClient.on("qr", (qr) => {
      console.log("[WhatsApp] Escanea este QR para iniciar sesion:");
      qrcode.generate(qr, { small: true });
    });

    waClient.on("ready", () => {
      console.log("[WhatsApp] Cliente listo y conectado.");
    });

    waClient.on("authenticated", () => {
      console.log("[WhatsApp] Sesion autenticada.");
    });

    waClient.on("auth_failure", (msg) => {
      console.error("[WhatsApp] Fallo de autenticacion:", msg);
      scheduleReconnect();
    });

    waClient.on("disconnected", (reason) => {
      console.warn("[WhatsApp] Desconectado:", reason);
      scheduleReconnect();
    });

    waClient.on("change_state", (state) => {
      console.log("[WhatsApp] Estado:", state);
    });

    waClient.on("message", async (message) => {
      try {
        if (message.fromMe) return;
        const chatId = String(message.from || message.author || "");
        if (!chatId) return;
        if (chatId === "status@broadcast") return;
        if (chatId.endsWith("@g.us")) return;
        if (String(message.type || "").toLowerCase() === "notification_template") return;

        const telefono = normalizePhone(chatId);
        if (!telefono) return;

        const dateObj = toDateFromMessageTimestamp(message.timestamp);
        const messageId = getMessageId(message, chatId);
        const msgTimestampMs = dateObj.getTime();
        const msgTimestampLabel = formatDateTime(dateObj);

        if (msgTimestampMs < BOT_START_TIME_MS) {
          console.log(
            `[INFO] msg_id=${messageId} telefono=${telefono} timestamp=${msgTimestampLabel} ` +
              `BOT_START_TIME=${BOT_START_TIME} -> IGNORADO (antes del BOT_START_TIME)`
          );
          return;
        }

        console.log(
          `[INFO] msg_id=${messageId} telefono=${telefono} timestamp=${msgTimestampLabel} ` +
            `BOT_START_TIME=${BOT_START_TIME} -> PROCESADO`
        );

        const text = String(message.body || "").trim();
        console.log(`[WhatsApp] Mensaje entrante de ${telefono} [${messageId}]: "${text}"`);

        const result = await onIncomingMessage({
          messageId,
          tipoEvento: "incoming_message",
          telefono,
          dateObj,
          text,
          chatId,
        });

        if (result?.replyText) {
          await waClient.sendMessage(chatId, result.replyText);
          console.log(`[WhatsApp] Respuesta enviada a ${telefono} [${messageId}].`);
        }
      } catch (error) {
        console.error("[WhatsApp] Error procesando mensaje:", error.message);
      }
    });
  };

  const start = async () => {
    stopping = false;
    client = buildClient();
    bindClientEvents(client);
    try {
      await client.initialize();
      console.log("[WhatsApp] Inicializacion solicitada.");
    } catch (error) {
      console.error("[WhatsApp] Fallo al iniciar cliente:", error.message);
      scheduleReconnect();
    }
  };

  const stop = async () => {
    stopping = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (client) {
      await client.destroy();
      client = null;
    }
  };

  return { start, stop };
}

module.exports = {
  createWhatsAppService,
  normalizePhone,
};
