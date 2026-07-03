//! Binary entrypoint for the mymy sandbox runner.
//!
//! The implementation lives under `sandbox_runner/` so the runner's HTTP
//! surface, process registry, path policy, and isolation backends can evolve as
//! ordinary modules instead of accumulating in this binary wrapper.

mod sandbox_runner;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    sandbox_runner::run().await
}
