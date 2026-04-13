import type { WebSocket } from 'ws';

export class MapRoomManager {
  private rooms = new Map<string, Set<WebSocket>>();

  join(mapId: string, ws: WebSocket): void {
    let room = this.rooms.get(mapId);
    if (!room) {
      room = new Set();
      this.rooms.set(mapId, room);
    }
    room.add(ws);
  }

  leave(mapId: string, ws: WebSocket): void {
    const room = this.rooms.get(mapId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(mapId);
      }
    }
  }

  /** Broadcast a message to all clients in a room. */
  broadcast(mapId: string, message: string): void {
    const room = this.rooms.get(mapId);
    if (!room) return;
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
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
