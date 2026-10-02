import { Ajv2020 } from 'ajv/dist/2020.js';
import { protocolSchema } from './protocol-schema.generated.js';

/** 文档 schema 编译一次；只允许客户端分支入站，不将服务端事件当作指令。 */
const names = ['sync', 'command', 'queueSync', 'queueAdd', 'queueAddRandom', 'queueRemove', 'queueMove', 'skipNext', 'chatSend', 'chatSync'] as const;
const definitions = protocolSchema.$defs as Record<string, any>;
const ajv = new Ajv2020({ strict: false, allErrors: false, allowUnionTypes: true });
const validators = new Map(names.map(name => [definitions[name].properties.type.const as string,
  ajv.compile({ $schema: protocolSchema.$schema, $defs: definitions, ...definitions[name] })]));

export function validClientMessage(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  const validate = typeof message.type === 'string' ? validators.get(message.type) : undefined;
  return validate?.(message) === true;
}
