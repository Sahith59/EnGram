import { Router, type IRouter } from "express";
import healthRouter from "./health";
import engramProxyRouter from "./engram-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(engramProxyRouter);

export default router;
