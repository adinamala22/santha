import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService } from '../identity-kyc/token.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';

/**
 * Socket.IO gateway at /v1/realtime. Clients connect with `auth: { token, deviceId }` (the same access
 * token as REST, device-bound). Rooms: `user:{id}` (every signed-in user) and `merchant:{id}` (store
 * owners) — order updates and new-order alerts are pushed there the moment their domain event is
 * handled. Single instance for the pilot; a Redis adapter is needed once the API scales out.
 */
@WebSocketGateway({ path: '/v1/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server | undefined;

  constructor(
    private readonly tokens: TokenService,
    private readonly merchants: MerchantsService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const auth = socket.handshake.auth as { token?: string; deviceId?: string };
      const claims = await this.tokens.verifyAccess(auth.token ?? '');
      if (auth.deviceId && claims.did !== auth.deviceId) throw new Error('device mismatch');
      await socket.join(`user:${claims.sub}`);
      if (claims.roles.includes('merchant')) {
        const m = await this.merchants.ownedBy(claims.sub).catch(() => null);
        if (m) await socket.join(`merchant:${m.id}`);
      }
      socket.emit('ready', { userId: claims.sub });
    } catch {
      socket.emit('error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
    }
  }

  emit(room: string, event: string, payload: Record<string, unknown>): void {
    this.server?.to(room).emit(event, payload);
  }
}
