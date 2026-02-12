import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import r2 from "@convex-dev/r2/convex.config.js";

const app = defineApp();
app.use(rag);
app.use(workflow);
app.use(r2);

export default app;
