use std::sync::Arc;

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::agent::tools::{tool_result, ToolError, ToolHandler};
use crate::error::AppError;
use crate::models::drive::{CreateDriveFolderRequest, WriteDriveFileRequest};
use crate::models::knowledge::KnowledgeTreeQuery;
use crate::models::sandbox::StartSandboxProcessRequest;
use crate::services::agent_prompts::AgentPromptQuery;
use crate::services::agents as agents_service;
use crate::services::calendar::{self as calendar_service, EventQuery};
use crate::services::chat::{self, SessionQuery};
use crate::services::drive as drive_service;
use crate::services::goals::{self as goals_service, GoalQuery};
use crate::services::investments::{self as investments_service, InvestmentListQuery};
use crate::services::knowledge as knowledge_service;
use crate::services::notes::{self as notes_service, NoteQuery};
use crate::services::sandbox;
use crate::services::tasks::{self as tasks_service, TaskFilter};
use crate::services::transactions::{self as transactions_service, TransactionQuery};
use crate::state::AppState;

pub(super) enum AppAction {
    GetAgentPrompts { agent_profile: Option<String> },
    UpdateAgentPrompts { agent_profile: Option<String> },
    SessionList,
    SessionRead,
    GoalList,
    GoalGet,
    GoalCreate,
    GoalUpdate,
    GoalDelete,
    KeyResultCreate,
    KeyResultUpdate,
    KeyResultDelete,
    CalendarList,
    CalendarCreate,
    CalendarUpdate,
    CalendarDelete,
    TaskList,
    TaskCreate,
    TaskUpdate,
    TaskDelete,
    KnowledgeTree,
    KnowledgeSearch,
    KnowledgeGet,
    KnowledgeList,
    KnowledgeCreate,
    KnowledgeUpdate,
    KnowledgeMove,
    KnowledgeDelete,
    NoteList,
    NoteSearch,
    NoteCreate,
    NoteUpdate,
    NoteDelete,
    DriveList,
    DriveRead,
    DriveWrite,
    DriveMkdir,
    DriveDelete,
    DriveRestore,
    ProcessList { agent_profile: Option<String> },
    ProcessStart { agent_profile: Option<String> },
    ProcessLogs,
    ProcessStop,
    ProcessKill,
    TransactionList,
    TransactionSummary,
    TransactionCreate,
    TransactionUpdate,
    TransactionDelete,
    InvestmentSummary,
    InvestmentAccountList,
    InvestmentAccountCreate,
    InvestmentAccountUpdate,
    InvestmentAccountDelete,
    InvestmentAssetList,
    InvestmentAssetCreate,
    InvestmentAssetUpdate,
    InvestmentAssetDelete,
    InvestmentPositionList,
    InvestmentPositionCreate,
    InvestmentPositionUpdate,
    InvestmentPositionDelete,
    InvestmentValuationList,
    InvestmentValuationCreate,
    InvestmentValuationDelete,
    InvestmentCashflowList,
    InvestmentCashflowCreate,
    InvestmentCashflowUpdate,
    InvestmentCashflowDelete,
    InvestmentWatchlistList,
    InvestmentWatchlistCreate,
    InvestmentWatchlistDelete,
    AgentList,
    AgentCreate,
    AgentUpdate,
    AgentDelete,
}

pub(super) struct AppDataTool {
    pub(super) state: Arc<AppState>,
    pub(super) action: AppAction,
}

#[async_trait]
impl ToolHandler for AppDataTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let value = self.execute_value(args).await?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "data": value,
        })))
    }
}

impl AppDataTool {
    async fn execute_value(&self, args: &Value) -> Result<Value, ToolError> {
        let state = self.state.as_ref();
        match &self.action {
            AppAction::GetAgentPrompts { agent_profile } => {
                let profile = required_profile(agent_profile)?;
                json_result(
                    crate::services::agent_prompts::get_prompts(
                        state,
                        AgentPromptQuery {
                            profile: Some(profile.to_string()),
                        },
                    )
                    .await,
                )
            }
            AppAction::UpdateAgentPrompts { agent_profile } => {
                let profile = required_profile(agent_profile)?;
                json_result(
                    crate::services::agent_prompts::update_prompts(
                        state,
                        AgentPromptQuery {
                            profile: Some(profile.to_string()),
                        },
                        typed(args)?,
                    )
                    .await,
                )
            }
            AppAction::SessionList => {
                json_result(chat::list_sessions(state, typed_session_query(args)?).await)
            }
            AppAction::SessionRead => {
                json_result(chat::get_messages(state, uuid_arg(args, "id")?).await)
            }
            AppAction::GoalList => {
                json_result(goals_service::list_goals(state, typed_goal_query(args)?).await)
            }
            AppAction::GoalGet => {
                json_result(goals_service::get_goal(state, uuid_arg(args, "id")?).await)
            }
            AppAction::GoalCreate => {
                json_result(goals_service::create_goal(state, typed(args)?).await)
            }
            AppAction::GoalUpdate => json_result(
                goals_service::update_goal(state, uuid_arg(args, "id")?, typed_data(args)?).await,
            ),
            AppAction::GoalDelete => {
                json_bool(goals_service::delete_goal(state, uuid_arg(args, "id")?).await)
            }
            AppAction::KeyResultCreate => json_result(
                goals_service::create_key_result(
                    state,
                    uuid_arg(args, "goalId")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::KeyResultUpdate => json_result(
                goals_service::update_key_result(
                    state,
                    uuid_arg(args, "goalId")?,
                    uuid_arg(args, "id")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::KeyResultDelete => json_bool(
                goals_service::delete_key_result(
                    state,
                    uuid_arg(args, "goalId")?,
                    uuid_arg(args, "id")?,
                )
                .await,
            ),
            AppAction::CalendarList => {
                json_result(calendar_service::list_events(state, typed_event_query(args)?).await)
            }
            AppAction::CalendarCreate => {
                json_result(calendar_service::create_event(state, typed(args)?).await)
            }
            AppAction::CalendarUpdate => json_result(
                calendar_service::update_event(state, uuid_arg(args, "id")?, typed_data(args)?)
                    .await,
            ),
            AppAction::CalendarDelete => {
                json_bool(calendar_service::delete_event(state, uuid_arg(args, "id")?).await)
            }
            AppAction::TaskList => {
                let filter = TaskFilter {
                    project_id: optional_uuid_field(args, "projectId")?,
                    status: string_field(args, "status"),
                };
                json_result(
                    tasks_service::list_tasks(&state.db, filter)
                        .await
                        .map(|tasks| serde_json::json!({ "tasks": tasks })),
                )
            }
            AppAction::TaskCreate => json_result(
                tasks_service::create_task(&state.db, typed(args)?)
                    .await
                    .map(|task| serde_json::json!({ "task": task })),
            ),
            AppAction::TaskUpdate => json_result(
                tasks_service::update_task(&state.db, uuid_arg(args, "id")?, typed_data(args)?)
                    .await
                    .map(|task| serde_json::json!({ "task": task })),
            ),
            AppAction::TaskDelete => {
                json_bool(tasks_service::delete_task(&state.db, uuid_arg(args, "id")?).await)
            }
            AppAction::KnowledgeTree => json_result(
                knowledge_service::list_tree(state, typed_knowledge_tree_query(args)?).await,
            ),
            AppAction::KnowledgeSearch => {
                json_result(knowledge_service::search(state, typed(args)?).await)
            }
            AppAction::KnowledgeGet => {
                json_result(knowledge_service::get_by_id(state, uuid_arg(args, "id")?).await)
            }
            AppAction::KnowledgeList => {
                json_result(knowledge_service::list_flat(state, typed(args)?).await)
            }
            AppAction::KnowledgeCreate => {
                json_result(knowledge_service::create(state, typed(args)?).await)
            }
            AppAction::KnowledgeUpdate => json_result(
                knowledge_service::update(state, uuid_arg(args, "id")?, typed_data(args)?).await,
            ),
            AppAction::KnowledgeMove => json_result(
                knowledge_service::move_node(state, uuid_arg(args, "id")?, typed_data(args)?).await,
            ),
            AppAction::KnowledgeDelete => {
                json_bool(knowledge_service::delete(state, uuid_arg(args, "id")?).await)
            }
            AppAction::NoteList => {
                json_result(notes_service::list_notes(state, typed_note_query(args)?).await)
            }
            AppAction::NoteSearch => {
                json_result(notes_service::search_notes(state, typed(args)?).await)
            }
            AppAction::NoteCreate => {
                json_result(notes_service::create_note(state, typed(args)?).await)
            }
            AppAction::NoteUpdate => json_result(
                notes_service::update_note(state, uuid_arg(args, "id")?, typed_data(args)?).await,
            ),
            AppAction::NoteDelete => {
                json_bool(notes_service::delete_note(state, uuid_arg(args, "id")?).await)
            }
            AppAction::DriveList => {
                json_result(drive_service::list(state, string_field(args, "path").as_deref()).await)
            }
            AppAction::DriveRead => {
                json_result(drive_service::read_file(state, required_str(args, "path")?).await)
            }
            AppAction::DriveWrite => {
                let req: WriteDriveFileRequest = typed(args)?;
                json_result(
                    drive_service::write_file(state, &req.path, &req.content)
                        .await
                        .map(|_| serde_json::json!({"success": true, "path": req.path})),
                )
            }
            AppAction::DriveMkdir => {
                let req: CreateDriveFolderRequest = typed(args)?;
                json_result(
                    drive_service::create_folder(state, &req.path)
                        .await
                        .map(|_| serde_json::json!({"success": true, "path": req.path})),
                )
            }
            AppAction::DriveDelete => json_result(
                drive_service::delete_path(state, required_str(args, "path")?)
                    .await
                    .map(|_| serde_json::json!({"success": true})),
            ),
            AppAction::DriveRestore => {
                json_result(drive_service::restore_trash(state, uuid_arg(args, "id")?).await)
            }
            AppAction::ProcessList { agent_profile } => json_result(
                sandbox::list_processes(
                    state,
                    Some(required_profile(agent_profile)?),
                    string_field(args, "projectId").as_deref(),
                )
                .await,
            ),
            AppAction::ProcessStart { agent_profile } => {
                let mut body = args.clone();
                body["agentProfile"] = serde_json::json!(required_profile(agent_profile)?);
                let req: StartSandboxProcessRequest = typed(&body)?;
                json_result(sandbox::start_process(state, req).await)
            }
            AppAction::ProcessLogs => {
                json_result(sandbox::process_logs(state, uuid_arg(args, "id")?).await)
            }
            AppAction::ProcessStop => {
                json_result(sandbox::stop_process(state, uuid_arg(args, "id")?).await)
            }
            AppAction::ProcessKill => {
                json_result(sandbox::kill_process(state, uuid_arg(args, "id")?).await)
            }
            AppAction::TransactionList => json_result(
                transactions_service::list_transactions(state, typed_transaction_query(args)?)
                    .await,
            ),
            AppAction::TransactionSummary => json_result(
                transactions_service::transaction_summary(state, typed_transaction_query(args)?)
                    .await,
            ),
            AppAction::TransactionCreate => {
                json_result(transactions_service::create_transaction(state, typed(args)?).await)
            }
            AppAction::TransactionUpdate => json_result(
                transactions_service::update_transaction(
                    state,
                    uuid_arg(args, "id")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::TransactionDelete => json_bool(
                transactions_service::delete_transaction(state, uuid_arg(args, "id")?).await,
            ),
            AppAction::InvestmentSummary => json_result(investments_service::summary(state).await),
            AppAction::InvestmentAccountList => {
                json_result(investments_service::list_accounts(state).await)
            }
            AppAction::InvestmentAccountCreate => {
                json_result(investments_service::create_account(state, typed(args)?).await)
            }
            AppAction::InvestmentAccountUpdate => json_result(
                investments_service::update_account(
                    state,
                    uuid_arg(args, "id")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::InvestmentAccountDelete => {
                json_bool(investments_service::delete_account(state, uuid_arg(args, "id")?).await)
            }
            AppAction::InvestmentAssetList => {
                json_result(investments_service::list_assets(state).await)
            }
            AppAction::InvestmentAssetCreate => {
                json_result(investments_service::create_asset(state, typed(args)?).await)
            }
            AppAction::InvestmentAssetUpdate => json_result(
                investments_service::update_asset(state, uuid_arg(args, "id")?, typed_data(args)?)
                    .await,
            ),
            AppAction::InvestmentAssetDelete => {
                json_bool(investments_service::delete_asset(state, uuid_arg(args, "id")?).await)
            }
            AppAction::InvestmentPositionList => {
                json_result(investments_service::list_positions(state).await)
            }
            AppAction::InvestmentPositionCreate => {
                json_result(investments_service::create_position(state, typed(args)?).await)
            }
            AppAction::InvestmentPositionUpdate => json_result(
                investments_service::update_position(
                    state,
                    uuid_arg(args, "id")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::InvestmentPositionDelete => {
                json_bool(investments_service::delete_position(state, uuid_arg(args, "id")?).await)
            }
            AppAction::InvestmentValuationList => json_result(
                investments_service::list_valuation_snapshots(state, typed(args)?).await,
            ),
            AppAction::InvestmentValuationCreate => json_result(
                investments_service::create_valuation_snapshot(state, typed(args)?).await,
            ),
            AppAction::InvestmentValuationDelete => json_bool(
                investments_service::delete_valuation_snapshot(state, uuid_arg(args, "id")?).await,
            ),
            AppAction::InvestmentCashflowList => json_result(
                investments_service::list_cashflows(state, typed_investment_list_query(args)?)
                    .await,
            ),
            AppAction::InvestmentCashflowCreate => {
                json_result(investments_service::create_cashflow(state, typed(args)?).await)
            }
            AppAction::InvestmentCashflowUpdate => json_result(
                investments_service::update_cashflow(
                    state,
                    uuid_arg(args, "id")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::InvestmentCashflowDelete => {
                json_bool(investments_service::delete_cashflow(state, uuid_arg(args, "id")?).await)
            }
            AppAction::InvestmentWatchlistList => {
                json_result(investments_service::list_watchlist(state).await)
            }
            AppAction::InvestmentWatchlistCreate => {
                json_result(investments_service::create_watchlist_item(state, typed(args)?).await)
            }
            AppAction::InvestmentWatchlistDelete => json_bool(
                investments_service::delete_watchlist_item(state, uuid_arg(args, "id")?).await,
            ),
            AppAction::AgentList => json_result(agents_service::list_agents(state).await),
            AppAction::AgentCreate => {
                json_result(agents_service::create_agent(state, typed(args)?).await)
            }
            AppAction::AgentUpdate => json_result(
                agents_service::update_agent(
                    state,
                    required_str(args, "profile")?,
                    typed_data(args)?,
                )
                .await,
            ),
            AppAction::AgentDelete => json_result(
                agents_service::delete_agent(state, required_str(args, "profile")?).await,
            ),
        }
    }
}

fn typed<T: DeserializeOwned>(args: &Value) -> Result<T, ToolError> {
    serde_json::from_value(args.clone())
        .map_err(|err| ToolError::InvalidArgs(format!("invalid arguments: {err}")))
}

fn typed_data<T: DeserializeOwned>(args: &Value) -> Result<T, ToolError> {
    let data = args
        .get("data")
        .ok_or_else(|| ToolError::InvalidArgs("missing data".to_string()))?;
    serde_json::from_value(data.clone())
        .map_err(|err| ToolError::InvalidArgs(format!("invalid data: {err}")))
}

fn typed_session_query(args: &Value) -> Result<SessionQuery, ToolError> {
    Ok(SessionQuery {
        project_id: string_field(args, "projectId"),
        profile: string_field(args, "profile"),
    })
}

fn typed_goal_query(args: &Value) -> Result<GoalQuery, ToolError> {
    Ok(GoalQuery {
        status: string_field(args, "status"),
        r#type: string_field(args, "type"),
        period: string_field(args, "period"),
    })
}

fn typed_event_query(args: &Value) -> Result<EventQuery, ToolError> {
    Ok(EventQuery {
        project_id: string_field(args, "projectId"),
        from: string_field(args, "from"),
        to: string_field(args, "to"),
    })
}

fn typed_note_query(args: &Value) -> Result<NoteQuery, ToolError> {
    Ok(NoteQuery {
        project_id: string_field(args, "projectId"),
    })
}

fn typed_knowledge_tree_query(args: &Value) -> Result<KnowledgeTreeQuery, ToolError> {
    Ok(KnowledgeTreeQuery {
        project_id: string_field(args, "projectId"),
    })
}

fn typed_transaction_query(args: &Value) -> Result<TransactionQuery, ToolError> {
    Ok(TransactionQuery {
        project_id: string_field(args, "projectId"),
        r#type: string_field(args, "type"),
        from: string_field(args, "from"),
        to: string_field(args, "to"),
        category: string_field(args, "category"),
        status: string_field(args, "status"),
    })
}

fn typed_investment_list_query(args: &Value) -> Result<InvestmentListQuery, ToolError> {
    Ok(InvestmentListQuery {
        limit: args.get("limit").and_then(Value::as_i64),
    })
}

fn uuid_arg(args: &Value, key: &str) -> Result<Uuid, ToolError> {
    Uuid::parse_str(required_str(args, key)?)
        .map_err(|err| ToolError::InvalidArgs(format!("invalid {key}: {err}")))
}

fn optional_uuid_field(args: &Value, key: &str) -> Result<Option<Uuid>, ToolError> {
    string_field(args, key)
        .map(|value| {
            Uuid::parse_str(&value)
                .map_err(|err| ToolError::InvalidArgs(format!("invalid {key}: {err}")))
        })
        .transpose()
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

fn string_field(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn required_profile(profile: &Option<String>) -> Result<&str, ToolError> {
    profile
        .as_deref()
        .ok_or_else(|| ToolError::Unavailable("agent profile is not configured".to_string()))
}

fn json_result<T: serde::Serialize>(result: Result<T, AppError>) -> Result<Value, ToolError> {
    let value = result.map_err(app_error_to_tool)?;
    serde_json::to_value(value)
        .map_err(|err| ToolError::Execution(format!("result serialization failed: {err}")))
}

fn json_bool(result: Result<bool, AppError>) -> Result<Value, ToolError> {
    json_result(result.map(|success| serde_json::json!({ "success": success })))
}

fn app_error_to_tool(err: AppError) -> ToolError {
    match err {
        AppError::BadRequest(message) | AppError::NotFound(message) => {
            ToolError::InvalidArgs(message)
        }
        AppError::Unauthorized(message) => ToolError::Unavailable(message),
        AppError::Conflict(message) | AppError::Internal(message) => ToolError::Execution(message),
        AppError::Database(err) => ToolError::Execution(err.to_string()),
        AppError::Io(err) => ToolError::Execution(err.to_string()),
    }
}
