const express = require("express");

function createStatsRouter(db) {
  const router = express.Router();

  router.get("/daily", async (req, res) => {
    try {
      const rows = await db.getDailyConversations();
      return res.json(rows);
    } catch (error) {
      console.error("[API] /stats/daily error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas diarias." });
    }
  });

  router.get("/monthly", async (req, res) => {
    try {
      const rows = await db.getMonthlyConversations();
      return res.json(
        rows.map((row) => ({
          ...row,
          periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}`,
        }))
      );
    } catch (error) {
      console.error("[API] /stats/monthly error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas mensuales." });
    }
  });

  router.get("/yearly", async (req, res) => {
    try {
      const rows = await db.getYearlyConversations();
      return res.json(rows);
    } catch (error) {
      console.error("[API] /stats/yearly error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas anuales." });
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const summary = await db.getSummary();
      return res.json(summary);
    } catch (error) {
      console.error("[API] /stats/summary error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener el resumen actual." });
    }
  });

  router.get("/options/totals", async (req, res) => {
    try {
      const rows = await db.getOptionTotals();
      return res.json(rows);
    } catch (error) {
      console.error("[API] /stats/options/totals error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas por opcion." });
    }
  });

  router.get("/options/daily", async (req, res) => {
    try {
      const rows = await db.getDailyConversationsByOption();
      return res.json(rows);
    } catch (error) {
      console.error("[API] /stats/options/daily error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas diarias por opcion." });
    }
  });

  router.get("/options/monthly", async (req, res) => {
    try {
      const rows = await db.getMonthlyConversationsByOption();
      return res.json(
        rows.map((row) => ({
          ...row,
          periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}`,
        }))
      );
    } catch (error) {
      console.error("[API] /stats/options/monthly error:", error.message);
      return res.status(500).json({ error: "No se pudo obtener estadisticas mensuales por opcion." });
    }
  });

  return router;
}

module.exports = {
  createStatsRouter,
};
