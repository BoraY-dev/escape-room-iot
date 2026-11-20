// Validace dtoIn v typovém zápisu uuApp, jak je v Command Listu:
//   shape({ name: string(1, 100).isRequired(), timeLimitMin: integer(5, 240) })
// Výsledek: vyčištěný dtoIn (jen známé klíče), mapa chyb pro invalidDtoIn a seznam nepodporovaných klíčů.

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Každý typ je objekt s funkcí check(value, path, ctx) → vyčištěná hodnota (chyby zapisuje do ctx)
function makeType(check) {
  return {
    check,
    required: false,
    isRequired() { return { ...this, required: true }; },
  };
}

const fail = (ctx, path, message) => { ctx.invalid[path] = message; return undefined; };

// Hodnoty z query stringu (GET) přicházejí jako text – čísla se převedou
const toNumber = (value, ctx) =>
  ctx.coerce && typeof value === "string" && value.trim() !== "" && !isNaN(Number(value)) ? Number(value) : value;

export const string = (min = 0, max = Infinity) => makeType((v, path, ctx) => {
  if (typeof v !== "string") return fail(ctx, path, "must be a string");
  if (v.length < min) return fail(ctx, path, `string too short (min ${min})`);
  if (v.length > max) return fail(ctx, path, `string too long (max ${max})`);
  return v;
});

export const integer = (min = null, max = null) => makeType((v, path, ctx) => {
  v = toNumber(v, ctx);
  if (!Number.isInteger(v)) return fail(ctx, path, "must be an integer");
  if (min !== null && v < min) return fail(ctx, path, `must be >= ${min}`);
  if (max !== null && v > max) return fail(ctx, path, `must be <= ${max}`);
  return v;
});

export const number = () => makeType((v, path, ctx) => {
  v = toNumber(v, ctx);
  if (typeof v !== "number" || !Number.isFinite(v)) return fail(ctx, path, "must be a finite number");
  return v;
});

export const id = () => makeType((v, path, ctx) =>
  typeof v === "string" && OBJECT_ID.test(v) ? v : fail(ctx, path, "must be an id (ObjectId)"));

export const uuid = () => makeType((v, path, ctx) =>
  typeof v === "string" && UUID.test(v) ? v.toLowerCase() : fail(ctx, path, "must be a UUID"));

// ISO 8601 s časovou zónou → Date
export const datetime = () => makeType((v, path, ctx) => {
  if (typeof v !== "string" || !ISO_DATETIME.test(v) || isNaN(Date.parse(v))) {
    return fail(ctx, path, "must be an ISO 8601 datetime with time zone");
  }
  return new Date(v);
});

export const oneOf = (values) => makeType((v, path, ctx) =>
  values.includes(v) ? v : fail(ctx, path, `must be one of: ${values.join(", ")}`));

export const array = (itemType, min = 0, max = Infinity) => makeType((v, path, ctx) => {
  if (!Array.isArray(v)) return fail(ctx, path, "must be an array");
  if (v.length < min) return fail(ctx, path, `array too short (min ${min})`);
  if (v.length > max) return fail(ctx, path, `array too long (max ${max})`);
  return v.map((item, i) => checkValue(itemType, item, `${path}[${i}]`, ctx));
});

export const shape = (spec = {}) => makeType((v, path, ctx) => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return fail(ctx, path, "must be an object");
  const out = {};
  for (const [key, type] of Object.entries(spec)) {
    const value = checkValue(type, v[key], `${path}.${key}`, ctx);
    if (value !== undefined) out[key] = value;
  }
  for (const key of Object.keys(v)) if (!(key in spec)) ctx.unsupported.push(`${path}.${key}`);
  return out;
});

function checkValue(type, value, path, ctx) {
  if (value === undefined || value === null) {
    if (type.required) fail(ctx, path, "is required");
    return undefined;
  }
  return type.check(value, path, ctx);
}

// coerce: true pro GET (dtoIn z query stringu)
export function validate(dtoIn, type, { coerce = false } = {}) {
  const ctx = { invalid: {}, unsupported: [], coerce };
  const value = checkValue({ ...type, required: true }, dtoIn ?? {}, "$", ctx);
  return { dtoIn: value ?? {}, invalidValueKeyMap: ctx.invalid, unsupportedKeyList: ctx.unsupported };
}
