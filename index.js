// --- Backend: Express + Gemini + File Handling ---

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

app.use(cors());
// Manually set CORS headers (important for Render and complex POST requests)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Or "http://localhost:3000" for tighter security
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

// Handle preflight (OPTIONS) requests
app.options('*', cors());

app.use(bodyParser.json());

// Gemini API setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Generate raw HTML/CSS/JS from Gemini
const generateHTMLCode = async (prompt) => {
  const history = [{ role: 'user', parts: [{ text: prompt }] }];
  const systemInstruction = `
You are an expert frontend developer specializing in cutting-edge web design. Create a stunning, 
modern website that demonstrates advanced CSS techniques and interactive JavaScript functionality.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>…</head>
<body>…</body>
</html>
\`\`\`

\`\`\`css
…style.css contents…
\`\`\`

\`\`\`js
…script.js contents…
\`\`\`

Design Guidelines:
- Use clean layout with Flexbox/Grid.
- Apply smooth transitions and hover animations.
- Use responsive design with media queries.
- Use Google Fonts (e.g., "Poppins", "Inter").
- Use modern color schemes (e.g., gradient backgrounds or subtle shadows).
- Make sure all <img> tags or CSS background-image styles use **actual image URLs** (from unsplash, pexels, or picsum).

✅ Adds real, high-quality images related to the topic
✅ Makes the website visually rich, full-page layout
✅ Ensures it's responsive and not just a small boxed section
✅ Forces proper use of layout, fonts, spacing, and imagery

Do **NOT** embed CSS or JS inside HTML. Always include both link and script tags.
Output only the three code blocks in order, no extra text.`;

  const response = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: history,
    config: { systemInstruction },
  });

  return response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

// Parse markdown-style code blocks into separate strings
const parseCodeBlocks = (text) => {
  const blocks = { html: "", css: "", js: "" };
  const regex = /```(html|css|javascript|js)\n([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(text))) {
    const lang = match[1].toLowerCase();
    const code = match[2];
    if (lang === "html") blocks.html = code;
    if (lang === "css") blocks.css = code;
    if (lang === "js" || lang === "javascript") blocks.js = code;
  }
  return blocks;
};

// POST /generate → create project files
app.post("/generate", async (req, res) => {
  const { prompt } = req.body;
  const id = uuidv4();
  const dirPath = path.join(__dirname, "projects", id);
  fs.mkdirSync(dirPath, { recursive: true });

  const raw = await generateHTMLCode(prompt);
  const code = parseCodeBlocks(raw);
  console.log("[Gemini Raw]\n", raw);
  console.log("[Parsed JS]\n", code.js);

  // Inject CSS & JS if missing
  let html = code.html;
  if (!html.includes("href=\"style.css\"")) {
    html = html.replace("</head>", `  <link rel="stylesheet" href="style.css">\n</head>`);
  }
  if (!html.includes("src=\"script.js\"")) {
    html = html.replace("</body>", `  <script src="script.js"></script>\n</body>`);
  }

  fs.writeFileSync(path.join(dirPath, "index.html"), html);
  fs.writeFileSync(path.join(dirPath, "style.css"), code.css || "/* no CSS generated */");
  fs.writeFileSync(path.join(dirPath, "script.js"), code.js || "// no JS generated");

  res.json({ id, code });
});

// Serve static files for live preview (HTML, CSS, JS)
app.get("/preview/:id/:file", (req, res) => {
  const { id, file } = req.params;
  const filePath = path.join(__dirname, "projects", id, file);
  res.sendFile(filePath);
});


// Ensure index.html is served on preview URL
app.get("/preview/:id", (req, res) => {
  const filePath = path.join(__dirname, "projects", req.params.id, "index.html");
  res.sendFile(filePath);
});

// Download the project as a ZIP
app.get("/download/:id", (req, res) => {
  const dirPath = path.join(__dirname, "projects", req.params.id);
  const zipPath = path.join(__dirname, "projects", `${req.params.id}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip");

  archive.pipe(output);
  archive.directory(dirPath, false);
  archive.finalize();

  output.on("close", () => {
    res.download(zipPath);
  });
});

app.listen(PORT, () => console.log(`🚀 Backend server running at http://localhost:${PORT}`));
