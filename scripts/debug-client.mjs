import process from "node:process";
import { main } from "../src/debug-client.mjs";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
