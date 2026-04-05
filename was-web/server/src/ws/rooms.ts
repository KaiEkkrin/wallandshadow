import type { WebSocket } from 'ws';

interface RoomMember {
  ws: WebSocket;
  uid: string;
}

export class MapRoomManager {
  private rooms = new Map<string, Set<RoomMember>>();

  join(mapId: string, ws: WebSocket, uid: string): void {
    let room = this.rooms.get(mapId);
    if (!room) {
      room = new Set();
      this.rooms.set(mapId, room);
    }
    room.add({ ws, uid });
  }

  leave(mapId: string, ws: WebSocket): void {
    const room = this.rooms.get(mapId);
    if (room) {
      for (const member of room) {
        if (member.ws === ws) {
          room.delete(member);
          break;
        }
      }
      if (room.size === 0) {
        this.rooms.delete(mapId);
      }
    }
  }

  /** Broadcast a message to all clients in a room, optionally excluding a user by UID. */
  broadcast(mapId: string, message: string, excludeUid?: string): void {
    const room = this.rooms.get(mapId);
    if (!room) return;
    for (const member of room) {
      if (member.uid !== excludeUid && member.ws.readyState === member.ws.OPEN) {
        member.ws.send(message);
      }
    }
  }

  hasRoom(mapId: string): boolean {
    return this.rooms.has(mapId);
  }

  roomSize(mapId: string): number {
    return this.rooms.get(mapId)?.size ?? 0;
  }
}
