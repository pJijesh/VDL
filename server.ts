import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { parsePdfWithGemini } from "./server/gemini.js";

// Load environment variables
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit to handle PDF base64 payloads up to 50MB safely
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API: AI-powered PDF manifest extraction
  app.post("/api/parse-pdf", async (req, res) => {
    try {
      const { fileBase64, mimeType } = req.body;
      if (!fileBase64) {
        return res.status(400).json({ error: "Missing 'fileBase64' in request body." });
      }

      console.log(`Received PDF parse request. Size: ${(fileBase64.length / 1024 / 1024).toFixed(2)} MB`);
      const result = await parsePdfWithGemini(fileBase64, mimeType || "application/pdf");
      
      return res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("Error in /api/parse-pdf:", error);
      return res.status(500).json({
        error: "Failed to parse PDF with Gemini AI",
        message: error.message || "Unknown error inside Gemini service",
      });
    }
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
