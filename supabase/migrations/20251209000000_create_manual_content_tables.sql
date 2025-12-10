-- Manual Content Tables for AI-accessible vehicle manual content
-- Stores both section-level and full content for efficient retrieval

-- Enable pgvector extension for semantic search (Phase 2)
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- MANUAL SECTIONS TABLE
-- Primary retrieval unit for AI agents - stores content by section
-- =============================================================================
CREATE TABLE IF NOT EXISTS manual_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manual_id UUID NOT NULL REFERENCES vehicle_manuals(id) ON DELETE CASCADE,

    -- Hierarchy and ordering
    section_path TEXT NOT NULL,              -- "1", "1.2", "1.2.3" for ordering
    section_title TEXT NOT NULL,             -- "Checking Tire Pressure"
    parent_id UUID REFERENCES manual_sections(id) ON DELETE CASCADE,
    depth INTEGER NOT NULL DEFAULT 0,        -- 0=chapter, 1=section, 2=subsection
    sort_order INTEGER NOT NULL DEFAULT 0,   -- Order within parent

    -- Content
    content_markdown TEXT NOT NULL,
    content_plain TEXT,                      -- Plain text for full-text search

    -- Token/size metadata for AI context budgeting
    word_count INTEGER,
    char_count INTEGER,
    token_count INTEGER,                     -- Estimated tokens (chars/4 approx)

    -- Retrieval helpers
    keywords TEXT[],                         -- Extracted keywords for filtering
    page_start INTEGER,                      -- Original PDF page number
    page_end INTEGER,

    -- Semantic search embedding (Phase 2)
    -- Using 1536 dimensions for OpenAI ada-002 compatibility
    embedding vector(1536),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT manual_sections_path_unique UNIQUE (manual_id, section_path)
);

-- =============================================================================
-- MANUAL FULL CONTENT TABLE
-- Complete markdown for full-manual retrieval (use sparingly)
-- =============================================================================
CREATE TABLE IF NOT EXISTS manual_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manual_id UUID NOT NULL REFERENCES vehicle_manuals(id) ON DELETE CASCADE UNIQUE,

    -- Full content
    content_markdown TEXT NOT NULL,

    -- Structured table of contents
    table_of_contents JSONB,                 -- [{path, title, depth, token_count}]

    -- Metadata
    total_word_count INTEGER,
    total_char_count INTEGER,
    total_token_count INTEGER,
    total_pages INTEGER,

    -- Extraction info
    extraction_method TEXT,                  -- 'pdf-parse', 'ocr', 'hybrid'
    extraction_quality FLOAT,                -- 0-1 confidence score
    extraction_errors JSONB,                 -- Any errors during extraction

    -- Timestamps
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Section retrieval indexes
CREATE INDEX IF NOT EXISTS idx_manual_sections_manual_id
    ON manual_sections(manual_id);
CREATE INDEX IF NOT EXISTS idx_manual_sections_depth
    ON manual_sections(manual_id, depth);
CREATE INDEX IF NOT EXISTS idx_manual_sections_path
    ON manual_sections(manual_id, section_path);
CREATE INDEX IF NOT EXISTS idx_manual_sections_parent
    ON manual_sections(parent_id);

-- Keyword search (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_manual_sections_keywords
    ON manual_sections USING GIN(keywords);

-- Full-text search on plain content
CREATE INDEX IF NOT EXISTS idx_manual_sections_fts
    ON manual_sections USING GIN(to_tsvector('english', COALESCE(content_plain, '')));

-- Vector similarity search (Phase 2)
CREATE INDEX IF NOT EXISTS idx_manual_sections_embedding
    ON manual_sections USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Full content indexes
CREATE INDEX IF NOT EXISTS idx_manual_content_manual_id
    ON manual_content(manual_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_manual_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS manual_sections_updated_at ON manual_sections;
CREATE TRIGGER manual_sections_updated_at
    BEFORE UPDATE ON manual_sections
    FOR EACH ROW
    EXECUTE FUNCTION update_manual_sections_updated_at();

DROP TRIGGER IF EXISTS manual_content_updated_at ON manual_content;
CREATE TRIGGER manual_content_updated_at
    BEFORE UPDATE ON manual_content
    FOR EACH ROW
    EXECUTE FUNCTION update_manual_sections_updated_at();

-- Auto-calculate token count on insert/update
CREATE OR REPLACE FUNCTION calculate_section_tokens()
RETURNS TRIGGER AS $$
BEGIN
    -- Approximate token count: chars / 4
    NEW.char_count = LENGTH(NEW.content_markdown);
    NEW.token_count = CEIL(NEW.char_count::FLOAT / 4);
    NEW.word_count = array_length(regexp_split_to_array(NEW.content_markdown, '\s+'), 1);

    -- Generate plain text by stripping markdown
    NEW.content_plain = regexp_replace(NEW.content_markdown, '\[([^\]]+)\]\([^\)]+\)', '\1', 'g'); -- links
    NEW.content_plain = regexp_replace(NEW.content_plain, '[#*_`~]', '', 'g'); -- formatting

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS manual_sections_calc_tokens ON manual_sections;
CREATE TRIGGER manual_sections_calc_tokens
    BEFORE INSERT OR UPDATE OF content_markdown ON manual_sections
    FOR EACH ROW
    EXECUTE FUNCTION calculate_section_tokens();

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE manual_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_content ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "manual_sections_public_read"
    ON manual_sections FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "manual_content_public_read"
    ON manual_content FOR SELECT TO PUBLIC USING (true);

-- Service role write access
CREATE POLICY "manual_sections_service_write"
    ON manual_sections FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "manual_content_service_write"
    ON manual_content FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Get sections for a manual with token budgeting
CREATE OR REPLACE FUNCTION get_manual_sections(
    p_manual_id UUID,
    p_max_depth INTEGER DEFAULT NULL,
    p_max_tokens INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    section_path TEXT,
    section_title TEXT,
    depth INTEGER,
    token_count INTEGER,
    content_markdown TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_running_tokens INTEGER := 0;
BEGIN
    RETURN QUERY
    SELECT
        ms.id,
        ms.section_path,
        ms.section_title,
        ms.depth,
        ms.token_count,
        CASE
            WHEN p_max_tokens IS NULL OR v_running_tokens + ms.token_count <= p_max_tokens
            THEN ms.content_markdown
            ELSE NULL
        END
    FROM manual_sections ms
    WHERE ms.manual_id = p_manual_id
      AND (p_max_depth IS NULL OR ms.depth <= p_max_depth)
    ORDER BY ms.section_path;
END;
$$;

-- Search sections by keyword with token budget
CREATE OR REPLACE FUNCTION search_manual_sections(
    p_manual_id UUID,
    p_query TEXT,
    p_max_sections INTEGER DEFAULT 5,
    p_max_tokens INTEGER DEFAULT 4000
)
RETURNS TABLE (
    id UUID,
    section_path TEXT,
    section_title TEXT,
    token_count INTEGER,
    relevance FLOAT,
    content_markdown TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT
            ms.id,
            ms.section_path,
            ms.section_title,
            ms.token_count,
            ts_rank(to_tsvector('english', COALESCE(ms.content_plain, '')),
                    plainto_tsquery('english', p_query)) AS relevance,
            ms.content_markdown,
            SUM(ms.token_count) OVER (ORDER BY
                ts_rank(to_tsvector('english', COALESCE(ms.content_plain, '')),
                        plainto_tsquery('english', p_query)) DESC
            ) AS running_tokens
        FROM manual_sections ms
        WHERE ms.manual_id = p_manual_id
          AND (
              to_tsvector('english', COALESCE(ms.content_plain, '')) @@ plainto_tsquery('english', p_query)
              OR ms.section_title ILIKE '%' || p_query || '%'
              OR p_query = ANY(ms.keywords)
          )
    )
    SELECT
        r.id,
        r.section_path,
        r.section_title,
        r.token_count,
        r.relevance,
        r.content_markdown
    FROM ranked r
    WHERE r.running_tokens <= p_max_tokens
    ORDER BY r.relevance DESC
    LIMIT p_max_sections;
END;
$$;

-- Get table of contents for a manual
CREATE OR REPLACE FUNCTION get_manual_toc(p_manual_id UUID)
RETURNS TABLE (
    section_path TEXT,
    section_title TEXT,
    depth INTEGER,
    token_count INTEGER,
    has_children BOOLEAN
)
LANGUAGE sql
AS $$
    SELECT
        ms.section_path,
        ms.section_title,
        ms.depth,
        ms.token_count,
        EXISTS(SELECT 1 FROM manual_sections child WHERE child.parent_id = ms.id) AS has_children
    FROM manual_sections ms
    WHERE ms.manual_id = p_manual_id
    ORDER BY ms.section_path;
$$;

-- Find manual by vehicle and get sections
CREATE OR REPLACE FUNCTION get_vehicle_manual_sections(
    p_year INTEGER,
    p_make TEXT,
    p_model TEXT,
    p_query TEXT DEFAULT NULL,
    p_max_tokens INTEGER DEFAULT 4000
)
RETURNS TABLE (
    manual_id UUID,
    year INTEGER,
    make TEXT,
    model TEXT,
    section_id UUID,
    section_path TEXT,
    section_title TEXT,
    token_count INTEGER,
    content_markdown TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_manual_id UUID;
BEGIN
    -- Find the manual
    SELECT vm.id INTO v_manual_id
    FROM vehicle_manuals vm
    WHERE vm.year = p_year
      AND LOWER(vm.make) = LOWER(p_make)
      AND LOWER(vm.model) ILIKE '%' || LOWER(p_model) || '%'
    LIMIT 1;

    IF v_manual_id IS NULL THEN
        RETURN;
    END IF;

    -- If query provided, search; otherwise return all within token budget
    IF p_query IS NOT NULL THEN
        RETURN QUERY
        SELECT
            v_manual_id,
            p_year,
            p_make,
            p_model,
            s.id,
            s.section_path,
            s.section_title,
            s.token_count,
            s.content_markdown
        FROM search_manual_sections(v_manual_id, p_query, 10, p_max_tokens) s;
    ELSE
        RETURN QUERY
        SELECT
            v_manual_id,
            p_year,
            p_make,
            p_model,
            s.id,
            s.section_path,
            s.section_title,
            s.token_count,
            s.content_markdown
        FROM get_manual_sections(v_manual_id, NULL, p_max_tokens) s;
    END IF;
END;
$$;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE manual_sections IS 'Section-level content from vehicle owner''s manuals. Primary retrieval unit for AI agents.';
COMMENT ON TABLE manual_content IS 'Full markdown content of vehicle owner''s manuals. Use sparingly due to size.';
COMMENT ON COLUMN manual_sections.token_count IS 'Estimated token count for AI context budgeting (chars/4).';
COMMENT ON COLUMN manual_sections.embedding IS 'Vector embedding for semantic similarity search (Phase 2).';
COMMENT ON FUNCTION search_manual_sections IS 'Search manual sections with token budgeting for AI context windows.';

-- =============================================================================
-- UPDATE vehicle_manuals TO TRACK CONTENT STATUS
-- =============================================================================

ALTER TABLE vehicle_manuals
ADD COLUMN IF NOT EXISTS content_status TEXT DEFAULT 'pending'
CHECK (content_status IN ('pending', 'extracting', 'extracted', 'failed'));

ALTER TABLE vehicle_manuals
ADD COLUMN IF NOT EXISTS content_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN vehicle_manuals.content_status IS 'Status of markdown content extraction from PDF.';
