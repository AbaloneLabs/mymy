//! Test-only validation for the July 11 release ownership manifest.
//!
//! The manifest prevents a route or worker from being treated as implicitly
//! tested merely because a broad suite passed. Runtime result evidence remains
//! the responsibility of the named CI/local oracle; this module validates that
//! scope, ownership, and conditional claims cannot silently disappear.

use std::{collections::HashSet, fs, path::Path};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseScope {
    manifest_version: String,
    deployment_profile: String,
    feature_revision: String,
    capabilities: Vec<Capability>,
    invariants: Vec<Invariant>,
    journeys: Vec<Journey>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capability {
    id: String,
    state: String,
    owner: String,
    reachability_oracle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Invariant {
    id: String,
    owner: String,
    scenario_ids: Vec<String>,
    oracle: String,
    environment: String,
    enablement_gate: String,
    rollback_gate: String,
    evidence_state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journey {
    id: String,
    state: String,
    settled_oracle: String,
    browser_oracle: Option<String>,
    cleanup_oracle: String,
}

#[test]
fn july11_release_scope_has_unique_owned_executable_invariants() {
    let scope: ReleaseScope =
        serde_json::from_str(include_str!("../tests/fixtures/july11_release_scope.json"))
            .expect("release scope must be valid JSON");
    assert_eq!(scope.manifest_version, "july11-release-scope-v2");
    assert!(!scope.deployment_profile.trim().is_empty());
    assert!(!scope.feature_revision.trim().is_empty());

    let allowed_states = [
        "mandatory",
        "explicitly_unclaimed",
        "externally_unavailable",
    ];
    let mut capability_ids = HashSet::new();
    for capability in &scope.capabilities {
        assert!(
            capability_ids.insert(&capability.id),
            "duplicate capability"
        );
        assert!(allowed_states.contains(&capability.state.as_str()));
        assert!(!capability.owner.trim().is_empty());
        assert!(!capability.reachability_oracle.trim().is_empty());
        assert!(
            oracle_exists(&capability.reachability_oracle),
            "capability oracle is not executable or present: {}",
            capability.reachability_oracle
        );
    }

    let mut invariant_ids = HashSet::new();
    for invariant in &scope.invariants {
        assert!(invariant_ids.insert(&invariant.id), "duplicate invariant");
        assert!(!invariant.owner.trim().is_empty());
        assert!(!invariant.scenario_ids.is_empty());
        assert!(!invariant.oracle.trim().is_empty());
        assert!(!invariant.environment.trim().is_empty());
        assert!(!invariant.enablement_gate.trim().is_empty());
        assert!(!invariant.rollback_gate.trim().is_empty());
        assert_eq!(invariant.evidence_state, "required");
        assert!(
            oracle_exists(&invariant.oracle),
            "invariant oracle is not executable or present: {}",
            invariant.oracle
        );
    }

    let expected_journeys = [
        "JNY-01", "JNY-02", "JNY-03", "JNY-03A", "JNY-03B", "JNY-03C", "JNY-03D", "JNY-04",
        "JNY-05", "JNY-06", "JNY-07", "JNY-07A", "JNY-07B", "JNY-08", "JNY-08A", "JNY-09",
        "JNY-10", "JNY-11", "JNY-12", "JNY-13",
    ];
    assert_eq!(
        scope
            .journeys
            .iter()
            .map(|journey| journey.id.clone())
            .collect::<HashSet<_>>(),
        expected_journeys.into_iter().map(str::to_string).collect()
    );

    let journey_ids = scope
        .journeys
        .iter()
        .map(|journey| journey.id.as_str())
        .collect::<HashSet<_>>();
    for journey in &scope.journeys {
        assert!(allowed_states.contains(&journey.state.as_str()));
        assert!(!journey.settled_oracle.trim().is_empty());
        assert!(!journey.cleanup_oracle.trim().is_empty());
        assert!(
            oracle_exists(&journey.settled_oracle),
            "journey oracle is not executable or present: {}",
            journey.settled_oracle
        );
        if let Some(browser_oracle) = &journey.browser_oracle {
            assert!(!browser_oracle.trim().is_empty());
            assert!(
                oracle_exists(browser_oracle),
                "browser oracle is not present: {browser_oracle}"
            );
        }
    }
    for invariant in &scope.invariants {
        for scenario_id in &invariant.scenario_ids {
            assert!(
                journey_ids.contains(scenario_id.as_str()),
                "invariant references unknown journey {scenario_id}"
            );
        }
    }

    let unclaimed_new_document = scope
        .capabilities
        .iter()
        .find(|capability| capability.id == "CAP-NEW-DOCUMENT")
        .expect("new-document scope must be explicit");
    assert_eq!(unclaimed_new_document.state, "explicitly_unclaimed");
    let journey_12 = scope
        .journeys
        .iter()
        .find(|journey| journey.id == "JNY-12")
        .expect("new-document journey must remain visible");
    assert_eq!(journey_12.state, "explicitly_unclaimed");
}

fn oracle_exists(oracle: &str) -> bool {
    // CI-level and external-certification labels are deliberately typed rather
    // than pretending to be repository files. Everything else must resolve to
    // an existing path or a literal test name in tracked source, so renaming an
    // oracle cannot leave a plausible-looking but dead manifest entry behind.
    if matches!(
        oracle,
        "test:web:browser"
            | "fresh-migration-application"
            | "docker-runner-control-smoke"
            | "new_document_capability_is_explicitly_unclaimed"
    ) || oracle.starts_with("external-certification:")
    {
        return true;
    }

    let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("API crate must be inside the repository");
    let path_part = oracle.split('#').next().unwrap_or(oracle);
    if repository_root.join(path_part).is_file() {
        return true;
    }
    if path_part.contains('/') {
        return false;
    }
    source_tree_contains(&repository_root.join("api/src"), oracle)
}

fn source_tree_contains(path: &Path, needle: &str) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if metadata.is_file() {
        return fs::read_to_string(path).is_ok_and(|source| source.contains(needle));
    }
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    entries
        .filter_map(Result::ok)
        .any(|entry| source_tree_contains(&entry.path(), needle))
}
