import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Player, Room } from './game.types';

@Injectable()
export class RoomManagerService {
  // Map of roomId -> Room
  private rooms = new Map<string, Room>();

  // Map of playerId (socketId) -> roomId
  private playerRoomMap = new Map<string, string>();

  // List of stylish avatar colors
  private avatarColors = [
    '#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee',
    '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#fb7185'
  ];

  private generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  private getRandomColor(): string {
    return this.avatarColors[Math.floor(Math.random() * this.avatarColors.length)];
  }

  createRoom(creatorId: string, nickname: string): Room {
    const roomId = this.generateRoomId();
    const player: Player = {
      id: creatorId,
      nickname,
      color: this.getRandomColor(),
      points: 100,
    };

    const room: Room = {
      id: roomId,
      players: [player],
      status: 'lobby',
      creatorId,
    };

    this.rooms.set(roomId, room);
    this.playerRoomMap.set(creatorId, roomId);
    return room;
  }

  joinRoom(roomId: string, playerId: string, nickname: string): Room {
    const upperRoomId = roomId.toUpperCase();
    const room = this.rooms.get(upperRoomId);

    if (!room) {
      throw new NotFoundException(`Комната ${upperRoomId} не найдена`);
    }

    if (room.status !== 'lobby') {
      throw new BadRequestException('Игра в этой комнате уже началась');
    }

    // Check if player is already in a room
    const currentRoomId = this.playerRoomMap.get(playerId);
    if (currentRoomId) {
      this.leaveRoom(playerId);
    }

    const player: Player = {
      id: playerId,
      nickname,
      color: this.getRandomColor(),
      points: 100,
    };

    room.players.push(player);
    this.playerRoomMap.set(playerId, upperRoomId);
    return room;
  }

  leaveRoom(playerId: string): { roomId: string; room: Room | null } | null {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    this.playerRoomMap.delete(playerId);

    if (!room) return null;

    room.players = room.players.filter((p) => p.id !== playerId);

    // If room is empty, delete it
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return { roomId, room: null };
    }

    // If the creator left, assign a new creator
    if (room.creatorId === playerId && room.players.length > 0) {
      room.creatorId = room.players[0].id;
    }

    // Clean up active/target IDs if they disconnected
    if (room.activePlayerId === playerId) {
      room.activePlayerId = undefined;
      room.targetPlayerId = undefined;
      room.status = 'lobby';
    } else if (room.targetPlayerId === playerId) {
      room.targetPlayerId = undefined;
    }

    return { roomId, room };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  getRoomByPlayerId(playerId: string): Room | undefined {
    const roomId = this.playerRoomMap.get(playerId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  spinBottle(roomId: string, activePlayerId: string): { activeId: string; targetId: string } {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      throw new NotFoundException('Комната не найдена');
    }

    if (room.players.length < 2) {
      throw new BadRequestException('Для игры нужно как минимум 2 игрока');
    }

    // Only creator or active player can spin
    const canSpin = room.status === 'lobby'
      ? activePlayerId === room.creatorId
      : activePlayerId === room.activePlayerId;

    if (!canSpin) {
      throw new BadRequestException('У вас нет права крутить бутылочку');
    }

    // The spinner is the active player
    // If we're starting a new game (status lobby), creator is the active player
    const activeId = room.status === 'lobby' ? room.creatorId : activePlayerId;

    // Filter out active player
    let eligibleOpponents = room.players.filter((p) => p.id !== activeId);

    // If more than 2 players, also filter out the previous active player (if exists)
    // to prevent back-and-forth repetition.
    if (room.players.length > 2 && room.previousActivePlayerId) {
      const filtered = eligibleOpponents.filter((p) => p.id !== room.previousActivePlayerId);
      if (filtered.length > 0) {
        eligibleOpponents = filtered;
      }
    }

    const targetPlayer = eligibleOpponents[Math.floor(Math.random() * eligibleOpponents.length)];

    room.status = 'record_a';
    room.activePlayerId = activeId;
    room.targetPlayerId = targetPlayer.id;

    return { activeId, targetId: targetPlayer.id };
  }

  resetTurn(roomId: string, nextActivePlayerId: string): Room {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      throw new NotFoundException('Комната не найдена');
    }

    // Save previous active player ID
    room.previousActivePlayerId = room.activePlayerId;

    room.activePlayerId = nextActivePlayerId;
    
    if (room.players.length === 2) {
      const otherPlayer = room.players.find(p => p.id !== nextActivePlayerId);
      room.targetPlayerId = otherPlayer ? otherPlayer.id : undefined;
      room.status = 'record_a';
    } else {
      room.targetPlayerId = undefined;
      room.status = 'record_a';
    }
    
    return room;
  }

  resetTargetPlayer(roomId: string): Room {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      throw new NotFoundException('Комната не найдена');
    }

    room.targetPlayerId = undefined;
    room.status = 'record_a';
    return room;
  }
}
