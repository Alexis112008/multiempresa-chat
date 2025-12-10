import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import mysql from "mysql2/promise";
import url from "url";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 🔹 Conexión a MySQL usando variable de entorno MYSQL_URL
if (!process.env.MYSQL_URL) {
  console.error("❌ No se encontró la variable de entorno MYSQL_URL");
  process.exit(1);
}

const params = new url.URL(process.env.MYSQL_URL);
const db = await mysql.createConnection({
  host: params.hostname,
  user: params.username,
  password: params.password,
  database: params.pathname.substring(1),
  port: params.port
});

// 🔹 Guardar sockets conectados
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
      // 🔹 Buscar o crear chat
      const [rows] = await db.execute(
        'SELECT idChat FROM chat WHERE (idUsuario1=? AND idUsuario2=?) OR (idUsuario1=? AND idUsuario2=?)',
        [idRemitente, idReceptor, idReceptor, idRemitente]
      );

      let idChat;
      if (rows.length > 0) {
        idChat = rows[0].idChat;
      } else {
        const [result] = await db.execute(
          'INSERT INTO chat (idUsuario1, idUsuario2, fechaInicio) VALUES (?, ?, NOW())',
          [Math.min(idRemitente, idReceptor), Math.max(idRemitente, idReceptor)]
        );
        idChat = result.insertId;
      }

      // 🔹 Guardar mensaje
      const [msgResult] = await db.execute(
        'INSERT INTO mensaje (idChat, idRemitente, contenido, fechaEnvio, leido) VALUES (?, ?, ?, NOW(), FALSE)',
        [idChat, idRemitente, mensaje]
      );

      const mensajeCompleto = {
        idMensaje: msgResult.insertId,
        idChat,
        idRemitente,
        mensaje,
        contenido: mensaje,
        fechaEnvio: new Date().toISOString(),
      };

      // 🔹 Enviar al receptor si está conectado
      const idSocketReceptor = usuariosConectados.get(idReceptor);
      if (idSocketReceptor) io.to(idSocketReceptor).emit("nuevoMensaje", mensajeCompleto);

      // 🔹 Confirmar al remitente
      socket.emit("mensajeEnviado", mensajeCompleto);
      console.log(`✅ Mensaje guardado: Chat ${idChat}`);

    } catch (err) {
      console.error("❌ ERROR EN NODE:", err);
      socket.emit("error", { message: err.message || "Fallo Node → MySQL" });
    }
  });

  // Usuario está escribiendo
  socket.on("escribiendo", (data) => {
    const { idReceptor, escribiendo } = data;
    const idSocketReceptor = usuariosConectados.get(idReceptor);
    if (idSocketReceptor) {
      io.to(idSocketReceptor).emit("usuarioEscribiendo", {
        idUsuario: data.idRemitente,
        escribiendo
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
