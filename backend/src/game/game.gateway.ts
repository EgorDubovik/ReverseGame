import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomManagerService } from './room-manager.service';
import { UseFilters, BadRequestException } from '@nestjs/common';
import { Room } from './game.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  maxHttpBufferSize: 1e7, // 10MB to support audio uploads
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly roomManagerService: RoomManagerService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const leaveResult = this.roomManagerService.leaveRoom(client.id);
    if (leaveResult) {
      const { roomId, room } = leaveResult;
      if (room) {
        // Notify others in the room
        this.server.to(roomId).emit('roomUpdated', room);
      } else {
        console.log(`Room ${roomId} deleted as it became empty`);
      }
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('nickname') nickname: string,
  ) {
    try {
      if (!nickname || nickname.trim() === '') {
        client.emit('error', 'Имя игрока не может быть пустым');
        return;
      }
      const room = this.roomManagerService.createRoom(client.id, nickname.trim());
      client.join(room.id);
      client.emit('roomJoined', room);
      console.log(`Room created: ${room.id} by ${nickname}`);
    } catch (e: any) {
      client.emit('error', e.message || 'Ошибка создания комнаты');
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; nickname: string },
  ) {
    try {
      const { roomId, nickname } = data;
      if (!roomId || roomId.trim() === '') {
        client.emit('error', 'Код комнаты обязателен');
        return;
      }
      if (!nickname || nickname.trim() === '') {
        client.emit('error', 'Имя игрока не может быть пустым');
        return;
      }

      const room = this.roomManagerService.joinRoom(
        roomId.trim().toUpperCase(),
        client.id,
        nickname.trim(),
      );

      client.join(room.id);
      client.emit('roomJoined', room);
      
      // Notify other players
      this.server.to(room.id).emit('roomUpdated', room);
      console.log(`Player ${nickname} joined room ${room.id}`);
    } catch (e: any) {
      client.emit('error', e.message || 'Ошибка входа в комнату');
    }
  }

  @SubscribeMessage('spinBottle')
  handleSpinBottle(@ConnectedSocket() client: Socket) {
    try {
      const room = this.roomManagerService.getRoomByPlayerId(client.id);
      if (!room) {
        client.emit('error', 'Вы не находитесь в комнате');
        return;
      }

      const spinResult = this.roomManagerService.spinBottle(room.id, client.id);
      
      // Emit the animation start to all players in the room
      this.server.to(room.id).emit('bottleSpun', spinResult);
      
      // Emit the updated room state after the spin finishes (handling delays on the client side)
      this.server.to(room.id).emit('roomUpdated', room);
      console.log(`Bottle spun in room ${room.id}: Active=${spinResult.activeId}, Target=${spinResult.targetId}`);
    } catch (e: any) {
      client.emit('error', e.message || 'Ошибка вращения бутылочки');
    }
  }

  @SubscribeMessage('uploadAudio')
  handleUploadAudio(
    @ConnectedSocket() client: Socket,
    @MessageBody('audio') audioData: any,
  ) {
    try {
      const room = this.roomManagerService.getRoomByPlayerId(client.id);
      if (!room) {
        client.emit('error', 'Вы не находитесь в комнате');
        return;
      }

      const currentPhase = room.status;
      if (currentPhase === 'record_a') {
        if (room.activePlayerId !== client.id) {
          client.emit('error', 'Сейчас не ваш ход для записи звука');
          return;
        }
      } else if (currentPhase === 'record_b') {
        if (room.targetPlayerId !== client.id) {
          client.emit('error', 'Только выбранный соперник должен повторять звук');
          return;
        }
      } else {
        client.emit('error', 'Сейчас нельзя записывать аудио');
        return;
      }

      // Convert payload to Buffer if it is raw array/ArrayBuffer
      const rawBuffer = Buffer.isBuffer(audioData) 
        ? audioData 
        : Buffer.from(audioData);

      if (rawBuffer.length <= 44) {
        client.emit('error', 'Аудиофайл слишком короткий или поврежден');
        return;
      }

      // Reverse mono 16-bit WAV PCM data (first 44 bytes is header)
      const header = rawBuffer.subarray(0, 44);
      const data = rawBuffer.subarray(44);
      const reversedData = Buffer.alloc(data.length);
      const sampleSize = 2; // 16-bit = 2 bytes per sample

      for (let i = 0; i < data.length; i += sampleSize) {
        const targetOffset = data.length - sampleSize - i;
        if (targetOffset >= 0) {
          reversedData.writeInt16LE(data.readInt16LE(targetOffset), i);
        }
      }

      const reversedWav = Buffer.concat([header, reversedData]);

      // Transition phase
      if (currentPhase === 'record_a') {
        room.status = 'record_b';
      } else {
        room.status = 'guess';
      }

      // Broadcast the reversed WAV ArrayBuffer to all clients in the room
      this.server.to(room.id).emit('audioBroadcast', { 
        audio: reversedWav, 
        phase: currentPhase 
      });

      // Notify clients of phase transition
      this.server.to(room.id).emit('roomUpdated', room);

      console.log(`Audio reversed and broadcasted for phase ${currentPhase} in room ${room.id}`);
    } catch (e: any) {
      console.error('Audio processing error:', e);
      client.emit('error', 'Не удалось перевернуть аудио: ' + e.message);
    }
  }

  @SubscribeMessage('guessResult')
  handleGuessResult(
    @ConnectedSocket() client: Socket,
    @MessageBody('success') success: boolean,
  ) {
    try {
      const room = this.roomManagerService.getRoomByPlayerId(client.id);
      if (!room) {
        client.emit('error', 'Вы не находитесь в комнате');
        return;
      }

      if (room.activePlayerId !== client.id) {
        client.emit('error', 'У вас нет прав подтверждать результат угадывания');
        return;
      }

      const nextActiveId = room.targetPlayerId;
      if (!nextActiveId) {
        client.emit('error', 'Целевой игрок не найден');
        return;
      }

      const host = room.players.find(p => p.id === room.activePlayerId);
      const guesser = room.players.find(p => p.id === room.targetPlayerId);
      if (host && guesser) {
        const transferAmount = 10;
        if (success) {
          const actualTransfer = Math.min(host.points, transferAmount);
          host.points -= actualTransfer;
          guesser.points += actualTransfer;
          console.log(`Points transfer: Host ${host.nickname} (-${actualTransfer}) -> Guesser ${guesser.nickname} (+${actualTransfer})`);
        } else {
          const actualTransfer = Math.min(guesser.points, transferAmount);
          guesser.points -= actualTransfer;
          host.points += actualTransfer;
          console.log(`Points transfer: Guesser ${guesser.nickname} (-${actualTransfer}) -> Host ${host.nickname} (+${actualTransfer})`);
        }
      }

      const updatedRoom = this.roomManagerService.resetTurn(room.id, nextActiveId);
      console.log(`Guess result handled (success=${success}). New active player in room ${room.id} is ${nextActiveId}`);

      this.server.to(room.id).emit('roomUpdated', updatedRoom);
    } catch (e: any) {
      client.emit('error', e.message || 'Ошибка обработки результата угадывания');
    }
  }
}
