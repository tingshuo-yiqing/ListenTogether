import { randomInt } from 'node:crypto';

/** 与 APK 内置图片及协议枚举一致；头像身份只由服务端分配，不随昵称或重连变化。 */
export const AVATAR_IDS = [
  'panda', 'cat', 'corgi', 'rabbit', 'fox', 'bear', 'koala', 'penguin',
  'otter', 'red_panda', 'hamster', 'deer', 'hedgehog', 'seal', 'tiger',
] as const;
export type AvatarId = typeof AVATAR_IDS[number];

/** 同步调用、不跨 await：从未被在房成员占用的头像中等概率随机选择；离线成员仍占用。 */
export function availableAvatar(used: Iterable<AvatarId>): AvatarId {
  const occupied = new Set(used);
  const candidates = AVATAR_IDS.filter(id => !occupied.has(id));
  if (!candidates.length) throw new Error('房间头像已用完');
  return candidates[randomInt(candidates.length)];
}
