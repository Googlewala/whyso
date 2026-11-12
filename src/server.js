import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { router as api } from './routes/api.js';
import { buildUpiUri, parseQrText } from './upi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 12000);

export const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

app.use('/api', api);

// QR image for any payee — handy for "show my code" and shareable links.
app.get('/qr.png', async (req, res) => {
  const { vpa, name, amount, note, ref } = req.query;
  try {
    const uri = req.query.uri || buildUpiUri({ vpa, name, amount, note, ref });
    const QRCode = (await import('qrcode')).default;
    const png = await QRCode.toBuffer(uri, { type: 'png', width: 420, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'whyso', time: new Date().toISOString() }));

app.use(express.static(join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Unknown API route' });
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[whyso]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

initSchema();
const seed = seedIfEmpty();
void parseQrText;

// Only bind a port when this file is the process entry point, so tests can
// import the app and drive it on an ephemeral port of their own.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Whyso running on http://0.0.0.0:${PORT}${seed.seeded ? ' (demo data seeded)' : ''}`);
  });
}

export default app;

