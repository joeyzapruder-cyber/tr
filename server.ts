import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, FunctionDeclaration, Content } from '@google/genai';
import gplay from 'google-play-scraper';
import { ZipArchive } from 'archiver';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const app = express();
app.use(express.json());

const PORT = 3000;

const searchAppStoreFunction: FunctionDeclaration = {
  name: "search_app_store",
  description: "Fetch app metadata and screenshot URLs from the iTunes Search API (no key required).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      term: { type: Type.STRING }
    },
    required: ["term"]
  }
};

const getNegativeReviewsFunction: FunctionDeclaration = {
  name: "get_negative_reviews",
  description: "Fetch 1-star and 2-star reviews for a given app ID using google-play-scraper.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      app_id: { type: Type.STRING },
      limit: { type: Type.NUMBER }
    },
    required: ["app_id"]
  }
};

async function searchAppStore(term: string) {
  try {
    const url = `https://itunes.apple.com/search?entity=software&limit=5&term=${encodeURIComponent(term)}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.results?.map((r: any) => ({
      appId: r.trackId,
      bundleId: r.bundleId,
      name: r.trackName,
      description: r.description?.substring(0, 500) + '...',
      averageRating: r.averageUserRating
    })) || [];
  } catch (e: any) {
    return { error: e.message };
  }
}

async function getNegativeReviews(appId: string, limit: number = 10) {
  try {
    const reviews = await gplay.reviews({
      appId,
      sort: (gplay.sort as any).HELPFULNESS,
      num: limit,
      lang: 'en'
    });
    return reviews.data.filter(r => r.score <= 2).map(r => ({ score: r.score, text: r.text }));
  } catch (error: any) {
    return { error: `Failed to fetch reviews for ${appId}: ${error.message}` };
  }
}

const systemInstruction = `You are an expert product strategist and systems architect operating inside a server-side pipeline. You have access to custom functions for fetching app store metadata and reviews.

Rules:
1. Use function calls to retrieve real review/metadata data before making claims. Do not fabricate pain points — ground every claim in retrieved data.
2. When asked for the final JSON output, respond strictly against the provided schema — no markdown, no prose outside the JSON.
3. Never generate, reference, or reserve a field for an API key, token, or secret in any PWA output content. All generated app code must be fully static and functional with zero network calls to any AI provider.`;

app.post('/api/generate', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea) {
      return res.status(400).json({ error: 'Idea is required' });
    }

    let contents: Content[] = [
      { role: 'user', parts: [{ text: `Analyze the following app idea or competitor domain, search for market context, get app reviews, and then prepare to output the PWA config.\n\nTarget Idea/App: ${idea}` }] }
    ];

    let finalResponse = null;
    let turnCount = 0;
    const maxTurns = 5;

    // Call 1: Agentic loop
    while (turnCount < maxTurns) {
      if (turnCount > 0) {
        // Add a delay between calls to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          systemInstruction,
          tools: [
            { functionDeclarations: [searchAppStoreFunction, getNegativeReviewsFunction] }
          ]
        }
      });

      turnCount++;

      if (response.candidates && response.candidates[0].content) {
        contents.push(response.candidates[0].content);
      }

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses = [];
        for (const call of response.functionCalls) {
          if (call.name === 'search_app_store') {
            const result = await searchAppStore(call.args.term as string);
            functionResponses.push({
              name: call.name,
              response: { result }
            });
          } else if (call.name === 'get_negative_reviews') {
            const result = await getNegativeReviews(call.args.app_id as string, (call.args.limit as number) || 10);
            functionResponses.push({
              name: call.name,
              response: { result }
            });
          }
        }
        
        contents.push({
          role: 'user',
          parts: functionResponses.map(fr => ({
            functionResponse: { name: fr.name, response: fr.response }
          }))
        });
      } else {
        // No more function calls, agentic phase is done.
        break;
      }
    }

    // Call 2: Structured output
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const finalResponseObj = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        ...contents,
        { role: 'user', parts: [{ text: 'Now, based on the research and context gathered, generate the final PWA configuration JSON.' }] }
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            app_name: { type: Type.STRING },
            core_pain_points: { type: Type.ARRAY, items: { type: Type.STRING } },
            key_differentiators: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  feature: { type: Type.STRING },
                  solution: { type: Type.STRING },
                  value_add: { type: Type.STRING }
                },
                required: ["feature", "solution", "value_add"]
              }
            },
            pwa_app_config: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                tagline: { type: Type.STRING },
                primary_color: { type: Type.STRING },
                navigation_links: { type: Type.ARRAY, items: { type: Type.STRING } },
                initial_state_data: { type: Type.STRING }
              },
              required: ["title", "tagline", "primary_color", "navigation_links"]
            }
          },
          required: ["app_name", "core_pain_points", "key_differentiators", "pwa_app_config"]
        }
      }
    });

    const outputText = finalResponseObj.text;
    if (outputText) {
      res.json(JSON.parse(outputText));
    } else {
      res.status(500).json({ error: 'Failed to generate output' });
    }

  } catch (error: any) {
    console.error('Error generating config:', error);
    
    // Check if it's a 429 rate limit error
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ 
        error: 'You have exceeded your Gemini API quota. Please check your plan and billing details at https://ai.dev/rate-limit or wait a moment and try again.' 
      });
    }

    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// Create zip of the PWA
app.post('/api/export-zip', (req, res) => {
  try {
    const config = req.body;
    if (!config || !config.pwa_app_config) {
      return res.status(400).json({ error: 'Valid config required to export' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${config.app_name.toLowerCase().replace(/\s+/g, '-')}-pwa.zip"`);

    const archive = new ZipArchive({
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    // index.html
    archive.append(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.pwa_app_config.title}</title>
  <link rel="manifest" href="/manifest.json">
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #fafafa; }
    header { background-color: ${config.pwa_app_config.primary_color}; color: white; padding: 1rem; text-align: center; }
    main { padding: 2rem; max-width: 800px; margin: 0 auto; }
    nav { display: flex; gap: 1rem; justify-content: center; background: #eee; padding: 0.5rem; }
    nav a { text-decoration: none; color: #333; font-weight: bold; }
  </style>
</head>
<body>
  <header>
    <h1>${config.pwa_app_config.title}</h1>
    <p>${config.pwa_app_config.tagline}</p>
  </header>
  <nav>
    ${config.pwa_app_config.navigation_links.map((link: string) => `<a href="#">${link}</a>`).join('\n    ')}
  </nav>
  <main>
    <h2>Welcome to ${config.pwa_app_config.title}</h2>
    <p>This is your generated PWA.</p>
    <script>
      const initialState = ${config.pwa_app_config.initial_state_data || '{}'};
      console.log('App initialized with state:', initialState);
      
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js');
        });
      }
    </script>
  </main>
</body>
</html>`, { name: 'index.html' });

    // manifest.json
    archive.append(JSON.stringify({
      name: config.pwa_app_config.title,
      short_name: config.app_name,
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: config.pwa_app_config.primary_color,
      icons: [
        {
          src: "/icon-192.png",
          type: "image/png",
          sizes: "192x192"
        },
        {
          src: "/icon-512.png",
          type: "image/png",
          sizes: "512x512"
        }
      ]
    }, null, 2), { name: 'manifest.json' });

    // sw.js
    archive.append(`
const CACHE_NAME = '${config.app_name.toLowerCase().replace(/\s+/g, '-')}-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
`, { name: 'sw.js' });

    // Simple placeholder icons (1x1 transparent png)
    const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    archive.append(emptyPng, { name: 'icon-192.png' });
    archive.append(emptyPng, { name: 'icon-512.png' });

    archive.finalize();

  } catch (error: any) {
    console.error('Error generating zip:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }
});


async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
