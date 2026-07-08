use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronBlueprint {
    pub key: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub default_schedule: &'static str,
    pub form_schema: Value,
    pub prompt_template: &'static str,
    pub suggested_skills: Vec<&'static str>,
    pub deliver: &'static str,
}

pub fn builtin_blueprints() -> Vec<CronBlueprint> {
    vec![
        blueprint(
            "morning_briefing",
            "Morning Briefing",
            "Daily summary of calendar, tasks, and selected topics.",
            "productivity",
            "0 8 * * *",
            vec![
                field_bool("include_calendar", true),
                field_bool("include_tasks", true),
                field_text("focus_topics", false),
            ],
            "Prepare a concise morning briefing. Include calendar: {{include_calendar}}. Include tasks: {{include_tasks}}. Focus topics: {{focus_topics}}.",
        ),
        blueprint(
            "daily_wrapup",
            "Daily Wrap-up",
            "End-of-day summary and next-day priorities.",
            "productivity",
            "0 18 * * *",
            vec![field_text("project_scope", false)],
            "Summarize today's progress, unresolved work, and suggested priorities for tomorrow. Project scope: {{project_scope}}.",
        ),
        blueprint(
            "weekly_review",
            "Weekly Review",
            "Weekly progress review across projects and goals.",
            "planning",
            "0 9 * * 1",
            vec![field_text("review_scope", false)],
            "Prepare a weekly review. Cover completed work, blocked work, goal progress, and next-week risks. Scope: {{review_scope}}.",
        ),
        blueprint(
            "project_healthcheck",
            "Project Healthcheck",
            "Recurring risk and status scan for active projects.",
            "planning",
            "0 17 * * 5",
            vec![field_text("project_filter", false)],
            "Review active projects for stale tasks, schedule risk, missing decisions, and next actions. Project filter: {{project_filter}}.",
        ),
        {
            let mut item = blueprint(
                "news_digest",
                "News Digest",
                "Digest recent news for chosen topics.",
                "research",
                "0 7 * * *",
                vec![field_text("topics", true), field_bool("include_sources", true)],
                "Create a news digest for topics: {{topics}}. Include sources: {{include_sources}}. Summarize only material found through available tools.",
            );
            item.suggested_skills = vec!["news-digest"];
            item
        },
        blueprint(
            "reading_digest",
            "Reading Digest",
            "Summarize saved reading or knowledge updates.",
            "research",
            "0 16 * * 5",
            vec![field_text("collection", false)],
            "Prepare a reading digest from available knowledge or saved material. Collection or topic: {{collection}}.",
        ),
        blueprint(
            "inbox_triage",
            "Inbox Triage",
            "Recurring triage plan for unread or pending communications.",
            "operations",
            "0 10 * * *",
            vec![field_text("channels", false)],
            "Triage pending communications for these channels: {{channels}}. Return urgent items, follow-ups, and low-priority backlog.",
        ),
        blueprint(
            "finance_summary",
            "Finance Summary",
            "Weekly finance and expense review.",
            "finance",
            "0 20 * * 0",
            vec![field_text("scope", false)],
            "Prepare a finance summary for scope: {{scope}}. Highlight unusual spending, pending payments, and next actions.",
        ),
        blueprint(
            "meal_planning",
            "Meal Planning",
            "Plan meals and shopping actions for the week.",
            "personal",
            "0 9 * * 6",
            vec![field_text("diet_notes", false), field_text("budget", false)],
            "Create a weekly meal plan. Diet notes: {{diet_notes}}. Budget: {{budget}}. Include a compact shopping list.",
        ),
        blueprint(
            "gratitude_journal",
            "Gratitude Journal",
            "Prompt a short recurring reflection.",
            "personal",
            "30 21 * * *",
            vec![field_text("reflection_prompt", false)],
            "Write a short gratitude journal prompt and summarize any recurring themes if prior context is available. Prompt: {{reflection_prompt}}.",
        ),
        blueprint(
            "habit_checkin",
            "Habit Check-in",
            "Recurring check-in for tracked habits.",
            "personal",
            "0 20 * * *",
            vec![field_text("habits", true)],
            "Check in on these habits: {{habits}}. Return status, friction, and one small adjustment.",
        ),
        blueprint(
            "learning_plan",
            "Learning Plan",
            "Weekly learning review and next study plan.",
            "learning",
            "0 19 * * 0",
            vec![field_text("subject", true), field_text("time_budget", false)],
            "Create a learning plan for subject: {{subject}}. Time budget: {{time_budget}}. Include review, practice, and next resources.",
        ),
        blueprint(
            "backup_reminder",
            "Backup Reminder",
            "Periodic reminder to verify backups and recovery readiness.",
            "operations",
            "0 12 1 * *",
            vec![field_text("systems", false)],
            "Prepare a backup verification checklist for systems: {{systems}}. Include last-known risks and concrete checks.",
        ),
    ]
}

pub fn instantiate_blueprint_prompt(template: &str, values: &Value) -> String {
    let mut prompt = template.to_string();
    if let Some(object) = values.as_object() {
        for (key, value) in object {
            let replacement = match value {
                Value::String(value) => value.clone(),
                Value::Bool(value) => value.to_string(),
                Value::Number(value) => value.to_string(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            prompt = prompt.replace(&format!("{{{{{key}}}}}"), &replacement);
        }
    }
    let placeholder =
        regex::Regex::new(r"\{\{[a-zA-Z0-9_]+\}\}").expect("blueprint placeholder regex compiles");
    placeholder.replace_all(&prompt, "").trim().to_string()
}

fn blueprint(
    key: &'static str,
    title: &'static str,
    description: &'static str,
    category: &'static str,
    default_schedule: &'static str,
    fields: Vec<Value>,
    prompt_template: &'static str,
) -> CronBlueprint {
    CronBlueprint {
        key,
        title,
        description,
        category,
        default_schedule,
        form_schema: serde_json::json!({ "fields": fields }),
        prompt_template,
        suggested_skills: Vec::new(),
        deliver: "local",
    }
}

fn field_bool(name: &'static str, default: bool) -> Value {
    serde_json::json!({
        "name": name,
        "type": "boolean",
        "default": default
    })
}

fn field_text(name: &'static str, required: bool) -> Value {
    serde_json::json!({
        "name": name,
        "type": "string",
        "required": required
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blueprint_catalog_has_thirteen_templates() {
        let blueprints = builtin_blueprints();
        assert_eq!(blueprints.len(), 13);
        assert!(blueprints
            .iter()
            .any(|blueprint| blueprint.key == "morning_briefing"));
    }

    #[test]
    fn blueprint_prompt_instantiates_values_and_clears_missing_placeholders() {
        let prompt = instantiate_blueprint_prompt(
            "Calendar: {{include_calendar}}. Topic: {{topic}}. Missing: {{missing}}.",
            &serde_json::json!({
                "include_calendar": true,
                "topic": "release planning"
            }),
        );
        assert_eq!(
            prompt,
            "Calendar: true. Topic: release planning. Missing: ."
        );
    }
}
