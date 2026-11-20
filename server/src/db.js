// Připojení k MongoDB (Atlas v cloudu, v testech dočasná databáze v paměti).
import mongoose from "mongoose";

export async function connectDb(uri) {
  if (!uri) throw new Error("Chybí MONGODB_URI (viz server/.env.example).");
  await mongoose.connect(uri);
  // Indexy z Persistence Layer (unikátní klíče, TTL retence) – založí jen chybějící, nic nemaže
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
