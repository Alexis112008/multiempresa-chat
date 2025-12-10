import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import mysql from "mysql2/promise";
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

// ✅ Conexión a MySQL (Railway)
// ✅ Conexión a MySQL (InfinityFree)
let db;
try {
  db = await mysql.createConnection({
    host: "sql207.infinityfree.com",
    port: 3306,
    user: "if0_40643133",
    password: "ClrFHxDzwy",
    database: "if0_40643133_multivent"
  });

  console.log("✅ Conectado correctamente a la base de datos Railway");
} catch (error) {
  console.error("❌ Error de conexión con Railway:", error.message);
  process.exit(1);
}

// Mapa para guardar sockets conectados por usuario
const usuariosConectados = new Map();

// 📡 Lógica de Socket.IO
io.on("connection", (socket) => {
  console.log("🟢 Nuevo cliente conectado", socket.id);

  // Registrar usuario conectado
  socket.on("registrarUsuario", (idUsuario) => {
    usuariosConectados.set(idUsuario, socket.id);
    console.log(`👤 Usuario ${idUsuario} conectado. Total conectados: ${usuariosConectados.size}`);
    // ✅ Notificar a todos que este usuario está en línea
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
      // 🔹 Normalizar IDs (menor primero)
      const usuario1 = Math.min(idRemitente, idReceptor);
      const usuario2 = Math.max(idRemitente, idReceptor);

      // 🔹 Buscar o crear chat
      const [chatRows] = await db.execute(
        `SELECT idChat FROM chat 
         WHERE idUsuario1 = ? AND idUsuario2 = ?
         LIMIT 1`,
        [usuario1, usuario2]
      );

      let idChat;
      if (chatRows.length === 0) {
        const [insertChat] = await db.execute(
          `INSERT INTO chat (idUsuario1, idUsuario2, fechaInicio, ultimoMensaje, fechaUltimoMensaje)
           VALUES (?, ?, NOW(), ?, NOW())`,
          [usuario1, usuario2, mensaje]
        );
        idChat = insertChat.insertId;
        console.log(`💬 Nuevo chat creado: ${idChat} entre usuarios ${usuario1} y ${usuario2}`);
      } else {
        idChat = chatRows[0].idChat;
        
        // Actualizar último mensaje
        await db.execute(
          `UPDATE chat SET ultimoMensaje = ?, fechaUltimoMensaje = NOW() WHERE idChat = ?`,
          [mensaje, idChat]
        );
      }

      // 🔹 Insertar mensaje
      const [insertMensaje] = await db.execute(
        `INSERT INTO mensaje (idChat, idRemitente, contenido, fechaEnvio, leido)
         VALUES (?, ?, ?, NOW(), FALSE)`,
        [idChat, idRemitente, mensaje]
      );

      const mensajeData = {
        idMensaje: insertMensaje.insertId,
        idChat,
        idRemitente,
        mensaje,
        contenido: mensaje,
        fechaEnvio: new Date().toISOString(),
      };

      // 🔹 Enviar al receptor si está conectado
      const idSocketReceptor = usuariosConectados.get(idReceptor);
      if (idSocketReceptor) {
        io.to(idSocketReceptor).emit("nuevoMensaje", mensajeData);
        console.log(`📨 Mensaje enviado a usuario ${idReceptor} (socket: ${idSocketReceptor})`);
      } else {
        console.log(`⚠️ Usuario ${idReceptor} no está conectado`);
      }

      // 🔹 Confirmar al remitente
      socket.emit("mensajeEnviado", mensajeData);
      console.log(`✅ Mensaje guardado: Chat ${idChat}, de ${idRemitente} a ${idReceptor}`);

    } catch (err) {
      console.error("❌ Error al guardar mensaje:", err.message);
      socket.emit("error", { message: "Error al enviar mensaje" });
    }
  });

  // 🔹 Marcar mensajes como leídos
  socket.on("marcarLeido", async (data) => {
    const { idChat, idUsuario } = data;
    
    try {
      await db.execute(
        `UPDATE mensaje 
         SET leido = TRUE 
         WHERE idChat = ? AND idRemitente != ? AND leido = FALSE`,
        [idChat, idUsuario]
      );
      console.log(`✅ Mensajes marcados como leídos en chat ${idChat}`);
    } catch (err) {
      console.error("❌ Error al marcar mensajes:", err.message);
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
        console.log(`🔴 Usuario ${idUsuario} desconectado. Total conectados: ${usuariosConectados.size}`);
        // ✅ Notificar a todos que este usuario se desconectó
        socket.broadcast.emit('usuarioConectado', { idUsuario, enLinea: false });
        break;
      }
    }
  });
});

// 🚀 Iniciar servidor - CAMBIOS PARA RENDER
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor Socket.IO corriendo en puerto ${PORT}`);
});