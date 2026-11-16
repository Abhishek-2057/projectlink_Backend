import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;
const userSocketMap = new Map<string, string[]>();

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.handshake.query.userId as string;

    if (userId) {
      const existing = userSocketMap.get(userId) || [];
      userSocketMap.set(userId, [...existing, socket.id]);
    }

    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conv_${conversationId}`);
    });

    socket.on('join_workspace', (workspaceId: string) => {
      socket.join(`ws_${workspaceId}`);
    });

    socket.on('leave_workspace', (workspaceId: string) => {
      socket.leave(`ws_${workspaceId}`);
    });

    socket.on('disconnect', () => {
      if (userId) {
        const remaining = (userSocketMap.get(userId) || []).filter((id) => id !== socket.id);
        if (remaining.length > 0) {
          userSocketMap.set(userId, remaining);
        } else {
          userSocketMap.delete(userId);
        }
      }
    });
  });

  return io;
}

export function emitToUser(userId: string, event: string, data: any) {
  if (!io) return;
  const socketIds = userSocketMap.get(userId);
  if (socketIds && socketIds.length > 0) {
    socketIds.forEach((id) => {
      io?.to(id).emit(event, data);
    });
  }
}

export function emitToConversation(conversationId: string, event: string, data: any) {
  if (!io) return;
  io.to(`conv_${conversationId}`).emit(event, data);
}

export function emitToWorkspace(workspaceId: string, event: string, data: any) {
  if (!io) return;
  io.to(`ws_${workspaceId}`).emit(event, data);
}

export function getIO(): SocketIOServer | null {
  return io;
}
