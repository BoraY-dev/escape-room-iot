// Zařízení (command-list-webapp.md, kap. 4): zakládá je gateway (heartbeat), provozovatel je jen pojmenuje.
import { AppError, Errors } from "../errors.js";
import { isDuplicateKey, roomDao, deviceDao, gatewayDao } from "../dao/index.js";
import { shape, string, id } from "../validation.js";
import { deviceDto, gatewaySummary } from "./common.js";

const deviceNameAlreadyExists = () =>
  new AppError("deviceNameAlreadyExists", 409, "Another device in the room already has this name.");

async function gatewayOnline(roomId) {
  return Boolean(gatewaySummary(await gatewayDao.getByRoom(roomId))?.online);
}

export const deviceCommands = [
  {
    name: "device/list",
    method: "get",
    profiles: ["Operators", "GameMasters"],
    dtoInType: shape({ roomId: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const room = await roomDao.get(session.venueId, dtoIn.roomId);
      if (!room) throw Errors.doesNotExist("room", { roomId: dtoIn.roomId });
      const [devices, online] = await Promise.all([deviceDao.listByRoom(room._id), gatewayOnline(room._id)]);
      const now = Date.now();
      return { itemList: devices.map((d) => deviceDto(d, online, now)) };
    },
  },
  {
    name: "device/update",
    profiles: ["Operators"],
    dtoInType: shape({ id: id().isRequired(), name: string(1, 100).isRequired() }),
    async handler(dtoIn, { session }) {
      const device = await deviceDao.get(session.venueId, dtoIn.id);
      if (!device) throw Errors.doesNotExist("device", { deviceId: dtoIn.id });
      if (await deviceDao.existsByName(device.roomId, dtoIn.name, device._id)) throw deviceNameAlreadyExists();
      let updated;
      try {
        updated = await deviceDao.updateName(session.venueId, device._id, dtoIn.name);
      } catch (e) {
        if (isDuplicateKey(e)) throw deviceNameAlreadyExists();
        throw e;
      }
      return deviceDto(updated, await gatewayOnline(device.roomId));
    },
  },
];
