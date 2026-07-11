//! Dedicated, bounded execution pool for document conversion.
//!
//! ZIP/XML conversion must not consume Tokio's general blocking pool or build
//! an unbounded queue under load. Jobs run on a small fixed set of named OS
//! threads behind a bounded channel. A thread-local cooperative budget is
//! checked by package admission and parser loops, so timeout or request-drop
//! cancellation stops expansion work instead of merely abandoning its future.

use std::cell::RefCell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender, TrySendError};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

const DEFAULT_WORKERS: usize = 2;
const DEFAULT_QUEUE_CAPACITY: usize = 2;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_WORKERS: usize = 16;
const MAX_QUEUE_CAPACITY: usize = 64;
const MAX_TIMEOUT_SECS: u64 = 300;

type ConversionJob = Box<dyn FnOnce() + Send + 'static>;

thread_local! {
    static CURRENT_BUDGET: RefCell<Option<ConversionBudget>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct ConversionBudget {
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
}

#[derive(Clone)]
pub struct DocumentConversionPool {
    sender: Sender<ConversionJob>,
    timeout: Duration,
}

impl DocumentConversionPool {
    pub fn from_environment() -> Self {
        let workers = bounded_env_usize(
            "MYMY_DOCUMENT_CONVERSION_WORKERS",
            DEFAULT_WORKERS,
            1,
            MAX_WORKERS,
        );
        let queue_capacity = bounded_env_usize(
            "MYMY_DOCUMENT_CONVERSION_QUEUE",
            DEFAULT_QUEUE_CAPACITY,
            0,
            MAX_QUEUE_CAPACITY,
        );
        let timeout_secs = bounded_env_u64(
            "MYMY_DOCUMENT_CONVERSION_TIMEOUT_SECS",
            DEFAULT_TIMEOUT_SECS,
            1,
            MAX_TIMEOUT_SECS,
        );
        Self::new(workers, queue_capacity, Duration::from_secs(timeout_secs))
    }

    fn new(workers: usize, queue_capacity: usize, timeout: Duration) -> Self {
        let (sender, receiver) = crossbeam_channel::bounded(queue_capacity);
        for index in 0..workers {
            let receiver = receiver.clone();
            std::thread::Builder::new()
                .name(format!("mymy-document-conversion-{index}"))
                .spawn(move || worker_loop(receiver))
                .expect("document conversion worker thread must start");
        }
        Self { sender, timeout }
    }

    pub async fn run<T, F>(&self, operation: &'static str, work: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        let started = Instant::now();
        let cancelled = Arc::new(AtomicBool::new(false));
        let budget = ConversionBudget {
            cancelled: cancelled.clone(),
            deadline: Instant::now() + self.timeout,
        };
        let (result_tx, result_rx) = oneshot::channel();
        let job = Box::new(move || {
            let result = catch_unwind(AssertUnwindSafe(|| with_budget(budget, work)))
                .unwrap_or_else(|_| {
                    metrics::counter!(
                        "mymy_document_conversion_failures_total",
                        "operation" => operation,
                        "reason" => "worker_panic"
                    )
                    .increment(1);
                    Err(AppError::Internal(
                        "document conversion worker panicked".into(),
                    ))
                });
            let _ = result_tx.send(result);
        }) as ConversionJob;

        match self.sender.try_send(job) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                metrics::counter!(
                    "mymy_document_conversion_failures_total",
                    "operation" => operation,
                    "reason" => "overloaded"
                )
                .increment(1);
                return Err(AppError::ServiceUnavailable(
                    "document_conversion_overloaded: document conversion capacity is busy; retry later"
                        .into(),
                ));
            }
            Err(TrySendError::Disconnected(_)) => {
                return Err(AppError::Internal(
                    "document conversion worker pool is unavailable".into(),
                ));
            }
        }

        let mut cancellation_guard = CancellationOnDrop::new(cancelled);
        let result = match tokio::time::timeout(self.timeout, result_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AppError::Internal(
                "document conversion worker ended without a result".into(),
            )),
            Err(_) => {
                cancellation_guard.cancel_now();
                metrics::counter!(
                    "mymy_document_conversion_failures_total",
                    "operation" => operation,
                    "reason" => "timeout"
                )
                .increment(1);
                Err(AppError::ServiceUnavailable(
                    "document_conversion_timeout: document conversion exceeded its time budget"
                        .into(),
                ))
            }
        };
        cancellation_guard.disarm();
        metrics::histogram!(
            "mymy_document_conversion_duration_seconds",
            "operation" => operation,
            "outcome" => if result.is_ok() { "completed" } else { "failed" }
        )
        .record(started.elapsed().as_secs_f64());
        result
    }
}

pub(crate) fn checkpoint() -> AppResult<()> {
    CURRENT_BUDGET.with(|current| {
        let current = current.borrow();
        let Some(budget) = current.as_ref() else {
            return Ok(());
        };
        if budget.cancelled.load(Ordering::Relaxed) {
            return Err(AppError::ServiceUnavailable(
                "document_conversion_cancelled: document conversion was cancelled".into(),
            ));
        }
        if Instant::now() >= budget.deadline {
            budget.cancelled.store(true, Ordering::Relaxed);
            return Err(AppError::ServiceUnavailable(
                "document_conversion_timeout: document conversion exceeded its time budget".into(),
            ));
        }
        Ok(())
    })
}

fn with_budget<T, F>(budget: ConversionBudget, work: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T>,
{
    CURRENT_BUDGET.with(|current| {
        let previous = current.replace(Some(budget));
        // Restoration must also happen while unwinding. A converter panic is
        // deliberately caught at the job boundary, and leaving its cancelled
        // budget installed would contaminate every later job on that worker.
        let _restore = BudgetRestore { previous };
        work()
    })
}

struct BudgetRestore {
    previous: Option<ConversionBudget>,
}

impl Drop for BudgetRestore {
    fn drop(&mut self) {
        CURRENT_BUDGET.with(|current| {
            current.replace(self.previous.take());
        });
    }
}

fn worker_loop(receiver: Receiver<ConversionJob>) {
    while let Ok(job) = receiver.recv() {
        job();
    }
}

struct CancellationOnDrop {
    cancelled: Arc<AtomicBool>,
    armed: bool,
}

impl CancellationOnDrop {
    fn new(cancelled: Arc<AtomicBool>) -> Self {
        Self {
            cancelled,
            armed: true,
        }
    }

    fn cancel_now(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CancellationOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.cancel_now();
        }
    }
}

fn bounded_env_usize(key: &str, default: usize, minimum: usize, maximum: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .map(|value| value.clamp(minimum, maximum))
        .unwrap_or(default)
}

fn bounded_env_u64(key: &str, default: u64, minimum: u64, maximum: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(minimum, maximum))
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::*;

    #[tokio::test]
    async fn saturation_is_retryable_and_pool_recovers() {
        let pool = DocumentConversionPool::new(1, 1, Duration::from_secs(1));
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_pool = pool.clone();
        let first = tokio::spawn(async move {
            first_pool
                .run("test", move || {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(1)
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(1), started_rx)
            .await
            .unwrap()
            .unwrap();

        let queued_pool = pool.clone();
        let queued = tokio::spawn(async move { queued_pool.run("test", || Ok(2)).await });
        while pool.sender.is_empty() {
            tokio::task::yield_now().await;
        }
        let overloaded = pool.run("test", || Ok(99)).await.unwrap_err();
        assert!(matches!(overloaded, AppError::ServiceUnavailable(_)));
        release_tx.send(()).unwrap();
        assert_eq!(first.await.unwrap().unwrap(), 1);
        assert_eq!(queued.await.unwrap().unwrap(), 2);
        assert_eq!(pool.run("test", || Ok(3)).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn timeout_cancels_cooperative_work_and_pool_recovers() {
        let pool = DocumentConversionPool::new(1, 1, Duration::from_millis(20));
        let timeout = pool
            .run::<(), _>("test", || loop {
                checkpoint()?;
                std::thread::yield_now();
            })
            .await
            .unwrap_err();
        assert!(matches!(timeout, AppError::ServiceUnavailable(_)));
        assert_eq!(pool.run("test", || Ok(7)).await.unwrap(), 7);
    }

    #[tokio::test]
    async fn worker_panic_is_classified_and_next_job_succeeds() {
        let pool = DocumentConversionPool::new(1, 1, Duration::from_secs(1));
        let failure = pool
            .run::<(), _>("test", || panic!("injected worker crash"))
            .await
            .unwrap_err();
        assert!(matches!(failure, AppError::Internal(_)));
        assert_eq!(pool.run("test", || Ok(9)).await.unwrap(), 9);
    }
}
