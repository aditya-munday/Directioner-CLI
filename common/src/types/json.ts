import z from 'zod/v4'

export type JSONValue =
  | null
  | string
  | number
  | boolean
  | Readonly<JSONObject>
  | JSONArray
export const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    jsonObjectSchema,
    jsonArraySchema,
  ]),
)

export const jsonObjectSchema: z.ZodType<JSONObject> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema.optional()),
)
export type JSONObject = { [key in string]: JSONValue | undefined }

export const jsonArraySchema: z.ZodType<JSONArray> = z.lazy(() =>
  z.array(jsonValueSchema),
)
// `readonly` matches the AI SDK v7 `JSONValue` shape, so provider metadata
// built from these types stays assignable to its `ProviderMetadata`.
export type JSONArray = readonly JSONValue[]
