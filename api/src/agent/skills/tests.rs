use std::collections::HashSet;
use std::fs;

use super::invocation::{expand_inline_shell, preprocess_skill_content};
use super::*;

fn temp_root() -> PathBuf {
    std::env::temp_dir().join(format!("mymy-skills-{}", uuid::Uuid::new_v4()))
}

#[test]
fn skill_list_and_view_work() {
    let root = temp_root();
    let skill_dir = root.join("dev").join("sample");
    fs::create_dir_all(skill_dir.join("references")).unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: sample\ndescription: Sample skill\n---\n# Sample\nUse it.",
    )
    .unwrap();
    fs::write(skill_dir.join("references/api.md"), "API").unwrap();

    let registry = SkillRegistry::new(root.clone());
    assert_eq!(registry.root(), root.as_path());
    let skills = registry.list(Some("dev")).unwrap();
    assert_eq!(skills.len(), 1);
    let view = registry.view("sample", None).unwrap();
    assert!(view.linked_files["references"].contains(&"references/api.md".to_string()));
    let linked = registry.view("sample", Some("references/api.md")).unwrap();
    assert_eq!(linked.content, "API");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn invalid_skill_name_is_rejected() {
    assert!(validate_skill_name("../bad").is_err());
    assert!(validate_skill_name("good-skill_1").is_ok());
}

#[tokio::test]
async fn advanced_skill_preprocessing_and_bundles_work() {
    let root = temp_root();
    let skill_dir = root.join("sample");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: sample\ndescription: Sample skill\n---\nUse ${MYMY_SESSION_ID} in ${MYMY_SKILL_DIR}.",
    )
    .unwrap();

    let registry = SkillRegistry::new(root.clone());
    let bundle_registry = BundleRegistry::new(root.join("bundles"), registry);
    let bundle = SkillBundle {
        name: "backend-dev".to_string(),
        description: "Backend bundle".to_string(),
        skills: vec!["sample".to_string()],
        instruction: Some("Extra guidance".to_string()),
    };
    bundle_registry.create_or_update(&bundle).unwrap();
    assert_eq!(bundle_registry.list().unwrap().len(), 1);
    assert!(bundle_registry.resolve("/backend_dev").unwrap().is_some());
    let invocation = bundle_registry
        .build_invocation_message(&bundle, "ship it", "session1", &SkillsConfig::default())
        .await
        .unwrap();
    assert!(invocation.contains("Extra guidance"));
    assert!(invocation.contains("ship it"));
    assert_eq!(slugify("/Backend Dev"), "backend-dev");

    let processed = preprocess_skill_content("Hello ${MYMY_SESSION_ID}", &skill_dir, "session1");
    assert_eq!(processed, "Hello session1");
    let shell_off = preprocess_skill_content_with_config(
        "!`printf hi`",
        &skill_dir,
        "session1",
        &SkillsConfig::default(),
    )
    .await;
    assert_eq!(shell_off, "!`printf hi`");
    let shell_on = expand_inline_shell(
        "!`printf hi` and !`rm -rf /`",
        &skill_dir,
        std::time::Duration::from_secs(2),
    )
    .await;
    assert!(shell_on.contains("hi"));
    assert!(shell_on.contains("inline shell blocked"));

    let message = build_skill_message("sample", "body", "do the thing");
    assert_eq!(
        extract_user_instruction_from_skill_message(&message).unwrap(),
        "do the thing"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn curator_protects_pinned_and_cron_referenced_skills() {
    let root = temp_root();
    for name in ["pinned", "referenced", "unused"] {
        let skill_dir = root.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name}\n---\nBody."),
        )
        .unwrap();
    }
    let registry = SkillRegistry::new(root.clone());
    registry.set_pinned("pinned", true).unwrap();
    let referenced = HashSet::from(["referenced".to_string()]);
    let report = registry.curate(&referenced, 0, 0).unwrap();
    assert!(report.protected.contains(&"pinned".to_string()));
    assert!(report.protected.contains(&"referenced".to_string()));
    assert!(report.archived.contains(&"unused".to_string()));
    assert!(root.join(".archive").exists());
    assert!(root.join("pinned").exists());
    assert!(root.join("referenced").exists());
    let _ = fs::remove_dir_all(root);
}
