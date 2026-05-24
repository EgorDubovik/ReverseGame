import { io } from 'socket.io-client';

// Connect to the Socket.io server using environment configuration or fallback to same origin / localhost
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.MODE === 'production' ? window.location.origin : 'http://localhost:3001');

export const socket = io(SOCKET_URL, {
  autoConnect: false,
});
