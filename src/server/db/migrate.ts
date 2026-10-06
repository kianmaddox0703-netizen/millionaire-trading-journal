// `npm run db:migrate`: applies pending migrations to DATA_DIR/journal.db. The app also applies them
// automatically when it opens the database, so this is only needed to migrate ahead of a deploy.
import path from "node:path";
import { dataDir } from "../config";
import { openDb } from "./index";

openDb(path.join(dataDir(), "journal.db"));
console.log(`Migrations applied to ${path.join(dataDir(), "journal.db")}`);
