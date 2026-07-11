//! App-data action vocabulary and authorization capabilities.
//!
//! Registration and execution share this closed action set so a newly exposed
//! operation cannot omit its effect, resource family, or sensitivity policy.

use crate::agent::tools::{DataSensitivity, ToolCapability, ToolEffect};

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
    TaskLink,
    KnowledgeTree,
    KnowledgeSearch,
    KnowledgeGet,
    KnowledgeList,
    KnowledgeCreate,
    KnowledgeUpdate,
    KnowledgeMove,
    KnowledgeDelete,
    KnowledgeResourceList,
    KnowledgeResourceAttach,
    KnowledgeResourceDetach,
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

impl AppAction {
    pub(super) fn capability(&self) -> ToolCapability {
        use AppAction::*;

        match self {
            GetAgentPrompts { .. } => ToolCapability::read("agent_prompt"),
            UpdateAgentPrompts { .. } => {
                ToolCapability::mutation(ToolEffect::Update, "agent_prompt")
            }
            SessionList | SessionRead => ToolCapability::read("session"),
            GoalList | GoalGet => ToolCapability::read("goal"),
            GoalCreate | KeyResultCreate => ToolCapability::mutation(ToolEffect::Create, "goal"),
            GoalUpdate | KeyResultUpdate => ToolCapability::mutation(ToolEffect::Update, "goal"),
            GoalDelete | KeyResultDelete => ToolCapability::mutation(ToolEffect::Delete, "goal"),
            CalendarList => ToolCapability::read("calendar"),
            CalendarCreate => ToolCapability::mutation(ToolEffect::Create, "calendar"),
            CalendarUpdate => ToolCapability::mutation(ToolEffect::Update, "calendar"),
            CalendarDelete => ToolCapability::mutation(ToolEffect::Delete, "calendar"),
            TaskList => ToolCapability::read("task"),
            TaskCreate => ToolCapability::mutation(ToolEffect::Create, "task"),
            TaskUpdate | TaskLink => ToolCapability::mutation(ToolEffect::Update, "task"),
            TaskDelete => ToolCapability::mutation(ToolEffect::Delete, "task"),
            KnowledgeTree | KnowledgeSearch | KnowledgeGet | KnowledgeList => {
                ToolCapability::read("knowledge")
            }
            KnowledgeCreate => ToolCapability::mutation(ToolEffect::Create, "knowledge"),
            KnowledgeUpdate | KnowledgeMove => {
                ToolCapability::mutation(ToolEffect::Update, "knowledge")
            }
            KnowledgeDelete => ToolCapability::mutation(ToolEffect::Delete, "knowledge"),
            KnowledgeResourceList => {
                ToolCapability::read("knowledge_resource").with_resource_argument("knowledgeId")
            }
            KnowledgeResourceAttach => {
                ToolCapability::mutation(ToolEffect::Create, "knowledge_resource")
                    .with_resource_argument("knowledgeId")
            }
            KnowledgeResourceDetach => {
                ToolCapability::mutation(ToolEffect::Delete, "knowledge_resource")
                    .with_resource_argument("resourceId")
            }
            NoteList | NoteSearch => ToolCapability::read("note"),
            NoteCreate => ToolCapability::mutation(ToolEffect::Create, "note"),
            NoteUpdate => ToolCapability::mutation(ToolEffect::Update, "note"),
            NoteDelete => ToolCapability::mutation(ToolEffect::Delete, "note"),
            DriveList | DriveRead => ToolCapability::read("file").with_resource_argument("path"),
            DriveWrite | DriveMkdir | DriveRestore => {
                ToolCapability::mutation(ToolEffect::Update, "file").with_resource_argument("path")
            }
            DriveDelete => {
                ToolCapability::mutation(ToolEffect::Delete, "file").with_resource_argument("path")
            }
            ProcessList { .. } | ProcessLogs => ToolCapability::read("process"),
            ProcessStart { .. } | ProcessStop | ProcessKill => ToolCapability::process(),
            TransactionList | TransactionSummary => {
                ToolCapability::read("finance").with_sensitivity(DataSensitivity::Financial)
            }
            TransactionCreate => ToolCapability::mutation(ToolEffect::Create, "finance")
                .with_sensitivity(DataSensitivity::Financial),
            TransactionUpdate => ToolCapability::mutation(ToolEffect::Update, "finance")
                .with_sensitivity(DataSensitivity::Financial),
            TransactionDelete => ToolCapability::mutation(ToolEffect::Delete, "finance")
                .with_sensitivity(DataSensitivity::Financial),
            InvestmentSummary
            | InvestmentAccountList
            | InvestmentAssetList
            | InvestmentPositionList
            | InvestmentValuationList
            | InvestmentCashflowList
            | InvestmentWatchlistList => {
                ToolCapability::read("investment").with_sensitivity(DataSensitivity::Financial)
            }
            InvestmentAccountCreate
            | InvestmentAssetCreate
            | InvestmentPositionCreate
            | InvestmentValuationCreate
            | InvestmentCashflowCreate
            | InvestmentWatchlistCreate => {
                ToolCapability::mutation(ToolEffect::Create, "investment")
                    .with_sensitivity(DataSensitivity::Financial)
            }
            InvestmentAccountUpdate
            | InvestmentAssetUpdate
            | InvestmentPositionUpdate
            | InvestmentCashflowUpdate => {
                ToolCapability::mutation(ToolEffect::Update, "investment")
                    .with_sensitivity(DataSensitivity::Financial)
            }
            InvestmentAccountDelete
            | InvestmentAssetDelete
            | InvestmentPositionDelete
            | InvestmentValuationDelete
            | InvestmentCashflowDelete
            | InvestmentWatchlistDelete => {
                ToolCapability::mutation(ToolEffect::Delete, "investment")
                    .with_sensitivity(DataSensitivity::Financial)
            }
            AgentList => ToolCapability::read("agent"),
            AgentCreate => ToolCapability::mutation(ToolEffect::Create, "agent"),
            AgentUpdate => ToolCapability::mutation(ToolEffect::Update, "agent"),
            AgentDelete => ToolCapability::mutation(ToolEffect::Delete, "agent"),
        }
    }
}
