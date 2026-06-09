pub(super) mod codex;

pub(super) enum CandidateUpstreamDecision {
    RespondUpstream(super::GatewayUpstreamResponse),
    Failover,
    Terminal { status_code: u16, message: String },
}
