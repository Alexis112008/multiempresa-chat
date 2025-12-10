import fetch from "node-fetch";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// URL de tu API PHP en InfinityFree
const API_URL = "https://multivent.42web.io/backend/Chat/socket_api.php";

// Mapa para guardar sockets conectados por usuario
const usuariosConectados = new Map();

// 📡 Lógica de Socket.IO
io.on("connection", (socket) => {
  console.log("🟢 Nuevo cliente conectado", socket.id);

  // Registrar usuario conectado
  socket.on("registrarUsuario", (idUsuario) => {
    usuariosConectados.set(idUsuario, socket.id);
    console.log(`👤 Usuario ${idUsuario} conectado. Total: ${usuariosConectados.size}`);
    socket.broadcast.emit('usuarioConectado', { idUsuario, enLinea: true });
  });

  // Escuchar envío de mensajes
  socket.on("enviarMensaje", async (data) => {
    const { idRemitente, idReceptor, mensaje } = data;
    
    if (!idRemitente || !idReceptor || !mensaje) {
      socket.emit("error", { message: "Datos incompletos" });
      return;
    }

    try {
      // 🔹 Crear o buscar chat
      const chatResponse = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'crearChat',
          idUsuario1: idRemitente,
          idUsuario2: idReceptor
        })
      });
      
      const chatData = await chatResponse.json();
      
      if (!chatData.success) {
        throw new Error('Error al crear chat');
      }
      
      const idChat = chatData.idChat;

      // 🔹 Guardar mensaje
      const mensajeResponse = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'guardarMensaje',
          idChat: idChat,
          idRemitente: idRemitente,
          mensaje: mensaje
        })
      });
      
      const mensajeData = await mensajeResponse.json();

      if (!mensajeData.success) {
        throw new Error('Error al guardar mensaje');
      }

      const mensajeCompleto = {
        idMensaje: mensajeData.idMensaje,
        idChat,
        idRemitente,
        mensaje,
        contenido: mensaje,
        fechaEnvio: new Date().toISOString(),
      };

      // 🔹 Enviar al receptor si está conectado
      const idSocketReceptor = usuariosConectados.get(idReceptor);
      if (idSocketReceptor) {
        io.to(idSocketReceptor).emit("nuevoMensaje", mensajeCompleto);
        console.log(`📨 Mensaje enviado a usuario ${idReceptor}`);
      } else {
        console.log(`⚠️ Usuario ${idReceptor} no está conectado`);
      }

      // 🔹 Confirmar al remitente
      socket.emit("mensajeEnviado", mensajeCompleto);
      console.log(`✅ Mensaje guardado: Chat ${idChat}`);

    } catch (err) {
  console.error("❌ ERROR REAL EN NODE:", err);
  socket.emit("error", {
    message: err.message || "Fallo Node → PHP"
  });
}
  });

  // 🔹 Usuario está escribiendo
  socket.on("escribiendo", (data) => {
    const { idReceptor, escribiendo } = data;
    
    const idSocketReceptor = usuariosConectados.get(idReceptor);
    if (idSocketReceptor) {
      io.to(idSocketReceptor).emit("usuarioEscribiendo", {
        idUsuario: data.idRemitente,
        escribiendo: escribiendo
      });
    }
  });

  // Desconexión
  socket.on("disconnect", () => {
    for (const [idUsuario, idSocket] of usuariosConectados.entries()) {
      if (idSocket === socket.id) {
        usuariosConectados.delete(idUsuario);
        console.log(`🔴 Usuario ${idUsuario} desconectado. Total: ${usuariosConectados.size}`);
        socket.broadcast.emit('usuarioConectado', { idUsuario, enLinea: false });
        break;
      }
    }
  });
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor Socket.IO corriendo en puerto ${PORT}`);
});