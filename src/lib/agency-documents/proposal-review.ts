import type { AnalysisProposal } from "./template-analyzer";
export type ProposalStatus="proposed"|"accepted"|"modified"|"rejected";
export function eligibleForBulkAccept(proposal:AnalysisProposal){return proposal.classification==="high"&&proposal.suggestedType==="tracepoint_data"&&Boolean(proposal.suggestedSemanticKey)&&proposal.reviewRequired===false;}
export function reviewProgress(statuses:readonly ProposalStatus[]){const reviewed=statuses.filter(status=>status!=="proposed").length;return{reviewed,total:statuses.length,remaining:statuses.length-reviewed};}
