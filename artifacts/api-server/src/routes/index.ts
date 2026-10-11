import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secureShareRouter from "./secureshare";

const router: IRouter = Router();

router.use(healthRouter);
router.use(secureShareRouter);

export default router;
