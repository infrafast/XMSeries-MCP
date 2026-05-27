#!/usr/bin/env node

import { startHttpServer } from "./http.js";

startHttpServer().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
