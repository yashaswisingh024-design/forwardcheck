import { Router, type IRouter } from "express";
import healthRouter from "./health";
import verifyRouter from "./verify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(verifyRouter);

export default router;
