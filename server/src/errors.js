// Chyba commandu. Kód je krátký (např. "roomDoesNotExist"); obal commandu z něj složí plný
// kód "escape-room-iot/<command>/<kód>" a zapíše ho do uuAppErrorMap.
export class AppError extends Error {
  constructor(code, status, message, paramMap) {
    super(message);
    this.code = code;
    this.status = status;
    this.paramMap = paramMap;
  }
}

// Společné chyby všech commandů (Command List, kap. 1)
export const Errors = {
  userNotAuthenticated: () => new AppError("userNotAuthenticated", 401, "User is not authenticated."),
  userNotAuthorized: () => new AppError("userNotAuthorized", 403, "User is not authorized to call this command."),
  doesNotExist: (entity, paramMap) => new AppError(`${entity}DoesNotExist`, 404, `${capitalize(entity)} does not exist.`, paramMap),
};

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
