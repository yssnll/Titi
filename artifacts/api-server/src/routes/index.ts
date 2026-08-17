import { Router, type IRouter } from "express";
import downloadsRouter from "./downloads";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadsRouter);

export default router;
