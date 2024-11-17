import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Client } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Inicializa o cliente do WhatsApp com configurações adicionais
const client = new Client({
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

let qrCodeData = '';
let connectionStatus = 'disconnected';
let connectedNumber = '';

// Eventos do WhatsApp
client.on('qr', async (qr) => {
  try {
    qrCodeData = await qrcode.toDataURL(qr);
    io.emit('qr', qrCodeData);
    connectionStatus = 'connecting';
    io.emit('connection-status', connectionStatus);
  } catch (err) {
    console.error('QR Code generation error:', err);
  }
});

client.on('ready', () => {
  connectionStatus = 'connected';
  io.emit('connection-status', connectionStatus);
  client.getState().then(state => {
    console.log('Client is ready!', state);
  });
  
  // Obtém o número conectado
  client.info.then(info => {
    connectedNumber = info.wid.user;
    io.emit('connected-number', connectedNumber);
  });
});

client.on('authenticated', () => {
  console.log('Authenticated');
});

client.on('auth_failure', () => {
  connectionStatus = 'disconnected';
  io.emit('connection-status', connectionStatus);
  console.log('Auth failure');
});

client.on('disconnected', () => {
  connectionStatus = 'disconnected';
  io.emit('connection-status', connectionStatus);
  console.log('Client disconnected');
});

// Eventos do Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected to socket');
  
  // Envia o status atual e QR code (se existir) para novos clientes
  socket.emit('connection-status', connectionStatus);
  if (qrCodeData) {
    socket.emit('qr', qrCodeData);
  }
  if (connectedNumber) {
    socket.emit('connected-number', connectedNumber);
  }

  // Manipula solicitações de envio de mensagem
  socket.on('send-message', async (data) => {
    try {
      const { number, message } = data;
      const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
      await client.sendMessage(formattedNumber, message);
      socket.emit('message-status', { status: 'success', number, message });
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message-status', { status: 'error', error: error.message });
    }
  });

  // Manipula solicitação de logout
  socket.on('logout', async () => {
    try {
      await client.logout();
      connectionStatus = 'disconnected';
      qrCodeData = '';
      connectedNumber = '';
      io.emit('connection-status', connectionStatus);
    } catch (error) {
      console.error('Logout error:', error);
    }
  });
});

// Tratamento de erros global
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Rota catch-all para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Inicia o cliente do WhatsApp
client.initialize().catch(err => {
  console.error('Failed to initialize client:', err);
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});