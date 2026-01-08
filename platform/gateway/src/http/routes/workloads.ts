import { Router } from "express";
import { ingestHandler } from "../../../../../workloads/ro-assistant/src/routes/ingest";
import { searchHandler } from "../../../../../workloads/ro-assistant/src/routes/search";
import { answerHandler } from "../../../../../workloads/ro-assistant/src/routes/answer";
import { roHandler } from "../../../../../workloads/ro-assistant/src/routes/ro";

export const workloadsRouter = Router();

workloadsRouter.post("/workloads/ro/ingest", ingestHandler);

workloadsRouter.post("/workloads/ro/search", searchHandler);

workloadsRouter.post("/workloads/ro/answer", answerHandler);

workloadsRouter.get("/workloads/ro/ro/:ro_id", roHandler);


workloadsRouter.get("/workloads/ro/documents/:doc_id/download", (_req, res) => {
  res
    .status(501)
    .json({ error: "NOT_IMPLEMENTED", message: "Document download endpoint pending." });
});
