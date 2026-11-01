/** BullMQ queue names (see santha-backend skill). */
export const QUEUES = ['events', 'timers', 'dispatch', 'notifications', 'settlement', 'indexing'] as const;
export type QueueName = (typeof QUEUES)[number];

export function redisConnectionOptions(redisUrl: string) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}
