const fs = require("fs");
const path = require("path");
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

const WA_CLIENT_ID = process.env.WA_CLIENT_ID || "conversaciones";
const WA_AUTH_PATH = path.resolve(process.env.WA_AUTH_PATH || ".wwebjs_auth");

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
        if (!message.from) return;
        if (message.from === "status@broadcast") return;
        if (!message.from.endsWith("@c.us")) return;

        const telefono = normalizePhone(message.from);
        if (!telefono) return;

        const dateObj = toDateFromMessageTimestamp(message.timestamp);
        const text = String(message.body || "").trim();

        const result = await onIncomingMessage({
          telefono,
          dateObj,
          text,
          chatId: message.from,
        });

        if (result?.replyText) {
          await waClient.sendMessage(message.from, result.replyText);
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
