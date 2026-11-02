import { createZodDto as baseCreateZodDto } from 'nestjs-zod';

/**
 * `createZodDto` from nestjs-zod, with one fix for the OpenAPI document: zod 4 writes nullable
 * primitives as `type: ["string", "null"]`, and @nestjs/swagger reads a top-level array `type` as
 * "array of string". That made every nullable top-level field `string[]` in the generated client types.
 * Here such properties become `type: "string", nullable: true` before Swagger sees them. Runtime
 * validation is unchanged (the zod schema is the same).
 */
type MetadataFactory = () => Record<string, Record<string, unknown>>;
type DtoClass = { _OPENAPI_METADATA_FACTORY?: MetadataFactory };

const EMPTY_TYPE_KEY = 'x-nestjs_zod-empty-type';

function fixNullable(meta: Record<string, Record<string, unknown>>) {
  for (const prop of Object.values(meta)) {
    const t = prop.type;
    if (!Array.isArray(t) || !t.includes('null')) continue;
    const rest = t.filter((x) => x !== 'null');
    if (rest.length !== 1) continue;
    prop.type = rest[0];
    prop.nullable = true;
    delete prop[EMPTY_TYPE_KEY];
  }
  return meta;
}

function patch(cls: DtoClass) {
  const original = cls._OPENAPI_METADATA_FACTORY;
  if (!original) return;
  Object.defineProperty(cls, '_OPENAPI_METADATA_FACTORY', {
    configurable: true,
    value(this: DtoClass) {
      return fixNullable(original.call(this));
    },
  });
}

export const createZodDto: typeof baseCreateZodDto = ((schema: Parameters<typeof baseCreateZodDto>[0], options?: Parameters<typeof baseCreateZodDto>[1]) => {
  const Dto = baseCreateZodDto(schema, options) as unknown as DtoClass & object;
  patch(Dto);
  const output = Object.getOwnPropertyDescriptor(Dto, 'Output');
  if (output?.get) {
    const cache = new WeakMap<object, DtoClass>();
    Object.defineProperty(Dto, 'Output', {
      configurable: true,
      get(this: object) {
        let out = cache.get(this);
        if (!out) {
          out = output.get!.call(this) as DtoClass;
          patch(out);
          cache.set(this, out);
        }
        return out;
      },
    });
  }
  return Dto;
}) as unknown as typeof baseCreateZodDto;
