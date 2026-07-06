-- Per-agent tool permissions.
--
-- Permissions are stored separately from native_agents so the agent identity
-- record can stay small while each domain can evolve independently. The
-- values intentionally match the product language: an allowed domain can
-- execute write tools, a read-only domain exposes only read tools, and a
-- denied domain is hidden from the model.

CREATE TABLE IF NOT EXISTS native_agent_tool_permissions (
    profile    TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    domain     TEXT NOT NULL CHECK (
        domain IN (
            'prompts',
            'memory',
            'sessions',
            'goals',
            'calendar',
            'tasks',
            'knowledge',
            'notes',
            'drive',
            'processes',
            'finance',
            'investments',
            'agents'
        )
    ),
    access     TEXT NOT NULL CHECK (access IN ('access', 'read_only', 'denied')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile, domain)
);

INSERT INTO native_agent_tool_permissions (profile, domain, access)
SELECT a.profile, d.domain, d.access
FROM native_agents a
CROSS JOIN (
    VALUES
        ('prompts', 'access'),
        ('memory', 'access'),
        ('sessions', 'read_only'),
        ('goals', 'access'),
        ('calendar', 'access'),
        ('tasks', 'access'),
        ('knowledge', 'access'),
        ('notes', 'access'),
        ('drive', 'access'),
        ('processes', 'access'),
        ('finance', 'access'),
        ('investments', 'access'),
        ('agents', 'read_only')
) AS d(domain, access)
ON CONFLICT (profile, domain) DO NOTHING;
