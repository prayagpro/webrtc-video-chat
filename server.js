import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import axios from 'axios';

// __dirname replacement for ES modules
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === MIDDLEWARE ===
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// === API ROUTES (must be before static middleware) ===

// Secure code execution endpoint
app.post('/api/execute', async (req, res) => {
  try {
    const { source_code, language_id } = req.body;
    
    if (!source_code || !language_id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const options = {
      method: 'POST',
      url: 'https://judge0-ce.p.rapidapi.com/submissions',
      params: { base64_encoded: 'false', wait: 'false' },
      headers: {
        'content-type': 'application/json',
        'x-rapidapi-host': 'judge0-ce.p.rapidapi.com',
        'x-rapidapi-key': process.env.JUDGE0_API_KEY
      },
      data: { source_code, language_id }
    };

    const response = await axios.request(options);
    res.json(response.data);
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ error: 'Failed to execute code' });
  }
});

// Get execution result
app.get('/api/execution/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const options = {
      method: 'GET',
      url: `https://judge0-ce.p.rapidapi.com/submissions/${token}`,
      headers: {
        'x-rapidapi-host': 'judge0-ce.p.rapidapi.com',
        'x-rapidapi-key': process.env.JUDGE0_API_KEY
      }
    };
    const response = await axios.request(options);
    res.json(response.data);
  } catch (error) {
    console.error('Execution status error:', error);
    res.status(500).json({ error: 'Failed to get execution status' });
  }
});

// === STATIC FILES (must be after API routes) ===
app.use(express.static(path.join(__dirname, "public"))); // Serve HTML, CSS, JS

// === ROUTES ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// === SOCKET.IO HANDLING ===
const rooms = {};

io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  socket.on("join", (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    const room = rooms[roomId];

    if (room.length >= 2) {
      socket.emit("room-full");
      return;
    }

    room.push(socket.id);
    socket.join(roomId);

    const isInitiator = room.length === 1;
    socket.emit("joined", isInitiator);

    console.log(`🧑‍🤝‍🧑 User joined room ${roomId}:`, room);

    // Notify the other peer
    socket.to(roomId).emit("peer-joined");
  });

  socket.on("offer", ({ offer, room }) => {
    socket.to(room).emit("offer", { offer });
  });

  socket.on("answer", ({ answer, room }) => {
    socket.to(room).emit("answer", { answer });
  });

  socket.on("candidate", ({ candidate, room }) => {
    socket.to(room).emit("candidate", { candidate });
  });

  socket.on("chat-message", ({ message, room }) => {
    socket.to(room).emit("chat-message", { message });
  });

  socket.on("code-change", ({ code, room }) => {
    socket.to(room).emit("code-change", { code });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);

    // Clean up user from all rooms
    for (const roomId in rooms) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
