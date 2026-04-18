import type { WebSocket } from 'ws';

/**
 * Key → set of WebSockets with broadcast. Used for maps (keyed by mapId),
 * adventures (keyed by adventureId) and users (keyed by userId).
 */
export class RoomManager {
  private rooms = new Map<string, Set<WebSocket>>();

  join(key: string, ws: WebSocket): void {
    let room = this.rooms.get(key);
    if (!room) {
      room = new Set();
      this.rooms.set(key, room);
    }
    room.add(ws);
  }

  leave(key: string, ws: WebSocket): void {
    const room = this.rooms.get(key);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(key);
      }
    }
  }

  broadcast(key: string, message: string): void {
    const room = this.rooms.get(key);
    if (!room) return;
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  }

  hasRoom(key: string): boolean {
    return this.rooms.has(key);
  }

  roomSize(key: string): number {
    return this.rooms.get(key)?.size ?? 0;
  }
}

export interface Rooms {
  mapRooms: RoomManager;
  adventureRooms: RoomManager;
  userRooms: RoomManager;
}
