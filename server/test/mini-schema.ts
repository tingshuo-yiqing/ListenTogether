/**
 * 仓库内的最小 JSON Schema 校验器：只覆盖 docs/protocol.md 里 schema 用到的关键字
 * （$ref / type / const / enum / required / properties / additionalProperties / items / minLength / maxLength /
 * minimum / maximum / maxItems / pattern / oneOf），不引入 ajv 等运行时依赖、不做 codegen。
 * 用途只有一个：让 protocol.md 的 schema 去校验实现产出的真实消息，任何一侧漂移都会让 server/test 变红。
 * 校验失败返回人类可读的错误列表（空数组＝通过），路径形如 `$.members[0].online`。
 */
type Schema = Record<string, any>;

export function validate(schema: Schema, value: unknown): string[] {
  return check(schema, value, '$', schema);
}

/** 解析文档内 `#/...` 形式的 JSON Pointer（只支持本文件内的 $defs 引用）。 */
export function resolveRef(root: Schema, ref: string): Schema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: any = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !(key in current)) return undefined;
    current = current[key];
  }
  return current as Schema;
}

function typeName(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function matchesType(expected: string | string[], value: unknown) {
  const names = Array.isArray(expected) ? expected : [expected];
  return names.some(name => (name === 'integer' ? typeof value === 'number' && Number.isInteger(value) : typeName(value) === name));
}

function check(schema: Schema, value: unknown, path: string, root: Schema): string[] {
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    return target ? check(target, value, path, root) : [`${path}: 无法解析 $ref ${schema.$ref}`];
  }
  const errors: string[] = [];
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: 期望 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema.enum)} 内`);
  if (schema.type && !matchesType(schema.type, value)) return [...errors, `${path}: 类型应为 ${[].concat(schema.type).join('|')}，实际 ${typeName(value)}`];
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 长度 ${value.length} < ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: 长度 ${value.length} > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} 不匹配 ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < 最小值 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > 最大值 ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 元素数 ${value.length} > ${schema.maxItems}`);
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 元素数 ${value.length} < ${schema.minItems}`);
    if (schema.items) value.forEach((item, index) => errors.push(...check(schema.items, item, `${path}[${index}]`, root)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${path}: 缺少必需字段 ${key}`);
    const properties: Record<string, Schema> = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) if (!(key in properties)) errors.push(`${path}: 文档未定义的字段 ${key}`);
    }
    for (const [key, sub] of Object.entries(properties)) if (key in object) errors.push(...check(sub, object[key], `${path}.${key}`, root));
  }
  if (schema.oneOf) {
    const matched = schema.oneOf.filter((sub: Schema) => check(sub, value, path, root).length === 0).length;
    if (matched !== 1) errors.push(`${path}: oneOf 应恰好命中 1 个分支，实际 ${matched} 个`);
  }
  return errors;
}
