// Místnost (command-list-webapp.md, kap. 3): room/create, get, list, update, delete.
import { config } from "../config.js";
import { AppError, Errors } from "../errors.js";
import {
  isDuplicateKey, roomDao, scenarioDao, puzzleDao, gameDao, deviceDao, gatewayDao, eventDao, measurementDao,
} from "../dao/index.js";
import { shape, string, integer, id } from "../validation.js";
import { gatewaySummary, isOnline, sid } from "./common.js";

const OPERATORS = ["Operators"];
const WEB_USERS = ["Operators", "GameMasters"];

const roomNameAlreadyExists = () => new AppError("roomNameAlreadyExists", 409, "Room with this name already exists.");

const roomDto = (room, gateway = null) => ({
  id: sid(room._id),
  name: room.name,
  description: room.description ?? "",
  gateway: gatewaySummary(gateway),
  currentGameId: sid(room.currentGameId),
});

// Detail pro room/get a room/list: gateway, přehled zařízení a stav aktuální hry – pro více místností najednou
async function roomDetails(rooms) {
  const roomIds = rooms.map((r) => r._id);
  const [gateways, devices, games] = await Promise.all([
    gatewayDao.getByRooms(roomIds),
    deviceDao.listByRooms(roomIds),
    gameDao.getManyByIds(rooms.map((r) => r.currentGameId).filter(Boolean)),
  ]);
  const now = Date.now();
  return rooms.map((room) => {
    const gateway = gateways.find((g) => String(g.roomId) === String(room._id)) ?? null;
    const summary = gatewaySummary(gateway, now);
    const roomDevices = devices.filter((d) => String(d.roomId) === String(room._id));
    const online = summary?.online ? roomDevices.filter((d) => isOnline(d.lastSeenAt, now)).length : 0;
    const game = games.find((g) => String(g._id) === String(room.currentGameId));
    return {
      ...roomDto(room, gateway),
      deviceSummary: { total: roomDevices.length, online, offline: roomDevices.length - online },
      currentGameState: game?.state ?? null,
    };
  });
}

export const roomCommands = [
  {
    name: "room/create",
    profiles: OPERATORS,
    dtoInType: shape({
      name: string(1, 100).isRequired(),
      description: string(0, 1000),
      timeLimitMin: integer(5, 240),
    }),
    async handler(dtoIn, { session }) {
      const { venueId } = session;
      if ((await roomDao.count(venueId)) >= config.limits.roomsPerVenue) {
        throw new AppError("roomLimitExceeded", 409, "Venue has reached the maximum number of rooms.");
      }
      if (await roomDao.existsByName(venueId, dtoIn.name)) throw roomNameAlreadyExists();

      let room;
      try {
        room = await roomDao.create({ venueId, name: dtoIn.name, description: dtoIn.description ?? "" });
      } catch (e) {
        if (isDuplicateKey(e)) throw roomNameAlreadyExists(); // souběžné založení stejného názvu
        throw e;
      }
      try {
        await scenarioDao.create({ venueId, roomId: room._id, timeLimitMin: dtoIn.timeLimitMin ?? 60, hintDeviceId: null, revision: 1 });
      } catch (e) {
        await roomDao.delete(venueId, room._id); // místnost bez scénáře nesmí zůstat
        throw e;
      }
      return roomDto(room.toObject());
    },
  },
  {
    name: "room/get",
    method: "get",
    profiles: WEB_USERS,
    dtoInType: shape({ id: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const room = await roomDao.get(session.venueId, dtoIn.id);
      if (!room) throw Errors.doesNotExist("room", { roomId: dtoIn.id });
      const [detail] = await roomDetails([room]);
      return detail;
    },
  },
  {
    name: "room/list",
    method: "get",
    profiles: WEB_USERS,
    dtoInType: shape({ pageInfo: shape({ pageIndex: integer(0, null), pageSize: integer(1, 100) }) }),
    async handler(dtoIn, { session }) {
      const pageIndex = dtoIn.pageInfo?.pageIndex ?? 0;
      const pageSize = dtoIn.pageInfo?.pageSize ?? 50;
      const [rooms, total] = await Promise.all([
        roomDao.list(session.venueId, pageIndex, pageSize),
        roomDao.count(session.venueId),
      ]);
      return { itemList: await roomDetails(rooms), pageInfo: { pageIndex, pageSize, total } };
    },
  },
  {
    name: "room/update",
    profiles: OPERATORS,
    dtoInType: shape({
      id: id().isRequired(),
      name: string(1, 100),
      description: string(0, 1000),
    }),
    async handler(dtoIn, { session }) {
      const { venueId } = session;
      const room = await roomDao.get(venueId, dtoIn.id);
      if (!room) throw Errors.doesNotExist("room", { roomId: dtoIn.id });
      if (dtoIn.name !== undefined && dtoIn.name !== room.name && await roomDao.existsByName(venueId, dtoIn.name, room._id)) {
        throw roomNameAlreadyExists();
      }
      const set = {};
      if (dtoIn.name !== undefined) set.name = dtoIn.name;
      if (dtoIn.description !== undefined) set.description = dtoIn.description;
      let updated;
      try {
        updated = await roomDao.update(venueId, room._id, set);
      } catch (e) {
        if (isDuplicateKey(e)) throw roomNameAlreadyExists();
        throw e;
      }
      return roomDto(updated, await gatewayDao.getByRoom(room._id));
    },
  },
  {
    name: "room/delete",
    profiles: OPERATORS,
    dtoInType: shape({ id: id().isRequired() }),
    async handler(dtoIn, { session }) {
      const { venueId } = session;
      const room = await roomDao.get(venueId, dtoIn.id);
      if (!room) throw Errors.doesNotExist("room", { roomId: dtoIn.id });
      if (await gatewayDao.getByRoom(room._id)) {
        throw new AppError("roomHasGateway", 409, "Delete the room's gateway first.");
      }
      if (await gameDao.hasGameInProgress(room._id)) {
        throw new AppError("gameInProgress", 409, "A game is running or paused in the room.");
      }
      // místnost a vše, co k ní patří
      await Promise.all([
        scenarioDao.deleteByRoom(room._id), puzzleDao.deleteByRoom(room._id), deviceDao.deleteByRoom(room._id),
        gameDao.deleteByRoom(room._id), eventDao.deleteByRoom(room._id), measurementDao.deleteByRoom(room._id),
      ]);
      await roomDao.delete(venueId, room._id);
      return {};
    },
  },
];
