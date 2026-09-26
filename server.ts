import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const BANNED_LINKS = [
  'https://forms.gle/gQ42fB3pRniV5GPv7',
  'https://link.be10x.in/24/7-LMS-Support-Bot-gif'
];

function isBanned(url: string): boolean {
  const clean = url.trim().replace(/\/+$/, '');
  return BANNED_LINKS.some(banned => banned.trim().replace(/\/+$/, '') === clean);
}

// Heuristic fallback in case AI models are temporarily down or experiencing high demand (503)
function extractLinksHeuristically(text: string): Array<{ name: string; url: string }> {
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  const matches = text.match(urlRegex) || [];
  const uniqueUrls = Array.from(new Set(matches)).filter(url => !isBanned(url));

  const lines = text.split(/\r?\n/);
  const results: Array<{ name: string; url: string }> = [];

  for (const url of uniqueUrls) {
    let bestName = "";

    // Find the line containing this URL
    for (const line of lines) {
      if (line.includes(url)) {
        // Strip zoom chat prefixes: e.g. "14:22:15 From John Doe to Everyone: "
        let cleanLine = line.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s+(?:From\s+.+?\s+to\s+.+?:\s*)?/i, "");
        // Strip standard sender prefix: e.g. "John: "
        cleanLine = cleanLine.replace(/^[^:]+:\s*/, "");
        
        // Find text before the URL
        const urlIndex = cleanLine.indexOf(url);
        if (urlIndex > 0) {
          let preText = cleanLine.substring(0, urlIndex).trim();
          // Remove trailing punctuation like colons, dashes, pipes, parens
          preText = preText.replace(/[:\-–—|(\[\{]+$/, "").trim();
          if (preText.length > 2 && preText.length < 80) {
            bestName = preText;
            break;
          }
        }
      }
    }

    if (!bestName) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, "");
        const pathPart = parsed.pathname.split("/").filter(Boolean).pop();
        if (pathPart && pathPart.length < 40 && !/^[0-9a-f-]{20,}$/i.test(pathPart)) {
          bestName = `${host} - ${decodeURIComponent(pathPart).replace(/[-_]/g, " ")}`;
        } else {
          bestName = host;
        }
      } catch {
        bestName = "Resource Link";
      }
    }

    results.push({ name: bestName, url });
  }

  return results;
}

async function callGeminiWithFallback(ai: GoogleGenAI, text: string) {
  const prompt = `Extract all URLs from the following Zoom chat transcript. 
For each URL, determine a descriptive "name" for the resource based on the surrounding context (e.g., if someone says "Here is the PRD template: https://...", the name should be "PRD Template"). If no clear name is present, use a generic name based on the domain or just say "Resource Link".
Do not extract email addresses unless they are actual URLs.
Ensure you return a valid JSON array.

Transcript:
${text}`;

  const schema = {
    type: Type.ARRAY,
    description: "List of extracted links with their descriptive names.",
    items: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "The descriptive name of the resource (e.g., 'Instructor LinkedIn Profile', 'PRD Template', etc.)."
        },
        url: {
          type: Type.STRING,
          description: "The exact, unmodified URL."
        }
      },
      required: ["name", "url"]
    }
  };

  // Primary model: gemini-3.8-flash, Secondary: gemini-3.1-flash-lite
  const modelsToTry = ["gemini-3.8-flash", "gemini-3.1-flash-lite"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });

      const resultText = response.text;
      if (resultText) {
        return JSON.parse(resultText);
      }
    } catch (err: any) {
      console.warn(`Model ${model} failed: ${err?.message || err}. Attempting next option...`);
    }
  }

  throw new Error("All Gemini models temporarily unavailable");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" })); // Transcripts might be large

  app.post("/api/extract-links", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      // Quick check: if there are no URLs in the text, return immediately
      const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/;
      if (!urlRegex.test(text)) {
        return res.json({ links: [] });
      }

      let extractedLinks: Array<{ name: string; url: string }> = [];

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          extractedLinks = await callGeminiWithFallback(ai, text);
        } catch (apiError) {
          console.warn("Gemini API call failed, using heuristic extraction fallback:", apiError);
          // Resilient fallback: extract links directly from transcript
          extractedLinks = extractLinksHeuristically(text);
        }
      } else {
        extractedLinks = extractLinksHeuristically(text);
      }

      // Deduplicate by URL and filter banned links
      const uniqueLinksMap = new Map();
      for (const link of extractedLinks) {
        if (link && link.url && !isBanned(link.url) && !uniqueLinksMap.has(link.url)) {
          uniqueLinksMap.set(link.url, link);
        }
      }

      res.json({ links: Array.from(uniqueLinksMap.values()) });
    } catch (error: any) {
      console.error("Error extracting links:", error);
      res.status(500).json({ error: error?.message || "Failed to extract links. Please try again." });
    }
  });

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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
