export interface Player {
  id: string; // socket.id
  nickname: string;
  color: string; // random avatar background color
  points: number;
}

export interface Room {
  id: string; // unique code (e.g. ABCD)
  players: Player[];
  status: 'lobby' | 'record_a' | 'record_b' | 'guess';
  activePlayerId?: string; // Player currently recording/taking turn
  targetPlayerId?: string; // Player selected to guess
  creatorId: string; // Creator of the room
}
