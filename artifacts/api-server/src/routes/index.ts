import { Router, type IRouter } from "express";
import downloadsRouter from "./downloads";
import healthRouter from "./health";
import streamsRouter from "./streams";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadsRouter);
router.use(streamsRouter);

export default router;
