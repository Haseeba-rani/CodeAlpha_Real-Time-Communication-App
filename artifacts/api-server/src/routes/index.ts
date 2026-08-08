import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meetingsRouter from "./meetings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meetingsRouter);

export default router;
