// Přihlášení uživatele webové aplikace (application-profiles.md, otevřený bod 1): e-mail + heslo → JWT.
import bcrypt from "bcryptjs";
import { PUBLIC, signUserToken } from "../auth.js";
import { AppError } from "../errors.js";
import { userDao } from "../dao/index.js";
import { shape, string } from "../validation.js";
import { createRateLimiter, sid } from "./common.js";

// Porovnání s fiktivním hashem u neexistujícího e-mailu: odpověď trvá stejně dlouho jako u špatného hesla
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export const userCommands = [
  {
    name: "user/login",
    method: "post",
    profiles: [PUBLIC],
    middleware: [createRateLimiter("user/login", 20)],
    dtoInType: shape({
      email: string(3, 254).isRequired(),
      password: string(1, 200).isRequired(),
    }),
    async handler({ email, password }) {
      const user = await userDao.getByEmail(email);
      const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !valid) throw new AppError("invalidCredentials", 401, "Invalid e-mail or password.");
      return {
        token: signUserToken(user),
        user: { id: sid(user._id), venueId: sid(user.venueId), email: user.email, name: user.name, role: user.role },
      };
    },
  },
];
