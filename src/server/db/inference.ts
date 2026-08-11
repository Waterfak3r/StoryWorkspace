/** Phase 2 inference read/write surface. Proposal writes stay transactional
 * in canon-patch.ts so model output can never bypass Pending Patch review. */
export {
  getInference,
  getModelRun,
  listInferences,
} from "./canon-patch";
