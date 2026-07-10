-- State-machine guards for durable runs and queued session inputs.
--
-- Every writer, including recovery code and future scheduler workers, shares
-- these transitions. Keeping the invariant in PostgreSQL prevents a stale or
-- newly introduced code path from resuming terminal work.

CREATE OR REPLACE FUNCTION enforce_agent_run_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
       OR (OLD.status = 'running' AND NEW.status IN (
            'queued', 'waiting_decision', 'completed', 'failed', 'cancelled'
       ))
       OR (OLD.status = 'waiting_decision' AND NEW.status IN (
            'queued', 'running', 'failed', 'cancelled'
       )) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid agent run status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS trg_agent_run_status_transition ON agent_runs;
CREATE TRIGGER trg_agent_run_status_transition
BEFORE UPDATE OF status ON agent_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_agent_run_status_transition();

CREATE OR REPLACE FUNCTION enforce_session_run_input_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF (OLD.status = 'queued' AND NEW.status IN ('claimed', 'cancelled'))
       OR (OLD.status = 'claimed' AND NEW.status IN ('queued', 'applied', 'cancelled')) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid session run input status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS trg_session_run_input_status_transition ON session_run_inputs;
CREATE TRIGGER trg_session_run_input_status_transition
BEFORE UPDATE OF status ON session_run_inputs
FOR EACH ROW
EXECUTE FUNCTION enforce_session_run_input_status_transition();
