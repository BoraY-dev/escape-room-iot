// Obal uuCommandu: ověření volajícího → validace dtoIn → logika → odpověď s uuAppErrorMap.
// Jednotlivé commandy (abl/) tak obsahují jen vlastní logiku.
import { authenticate } from "./auth.js";
import { validate } from "./validation.js";
import { AppError } from "./errors.js";

const APP = "escape-room-iot";

export function registerCommand(app, { name, method = "post", profiles, dtoInType, handler, middleware = [], noStore = false }) {
  const fullCode = (code) => `${APP}/${name}/${code}`;

  app[method](`/${name}`, ...middleware, async (req, res) => {
    const uuAppErrorMap = {};
    const warn = (code, message, paramMap) => {
      uuAppErrorMap[fullCode(code)] = { type: "warning", message, ...(paramMap && { paramMap }) };
    };

    try {
      const session = await authenticate(req, profiles);

      const raw = method === "get" ? req.query : req.body;
      const { dtoIn, invalidValueKeyMap, unsupportedKeyList } = validate(raw, dtoInType, { coerce: method === "get" });
      if (unsupportedKeyList.length) warn("unsupportedKeys", "DtoIn contains unsupported keys.", { unsupportedKeyList });
      if (Object.keys(invalidValueKeyMap).length) {
        throw new AppError("invalidDtoIn", 400, "DtoIn is not valid.", { invalidValueKeyMap });
      }

      const dtoOut = await handler(dtoIn, { session, warn });
      if (noStore) res.set("Cache-Control", "no-store");
      res.json({ ...dtoOut, uuAppErrorMap });
    } catch (e) {
      if (e instanceof AppError) {
        uuAppErrorMap[fullCode(e.code)] = { type: "error", message: e.message, ...(e.paramMap && { paramMap: e.paramMap }) };
        res.status(e.status).json({ uuAppErrorMap });
      } else {
        console.error(`[${name}]`, e);
        uuAppErrorMap[fullCode("unexpectedError")] = { type: "error", message: "Unexpected server error." };
        res.status(500).json({ uuAppErrorMap });
      }
    }
  });
}
