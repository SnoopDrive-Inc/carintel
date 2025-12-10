-- Add PostgreSQL Full-Text Search for manual sections
-- This provides language-aware searching with stemming and ranking

-- 1. Add tsvector column for search
ALTER TABLE manual_sections
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create function to update search vector with weighted fields
CREATE OR REPLACE FUNCTION update_manual_search_vector()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.section_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content_plain, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger to auto-update search vector on insert/update
DROP TRIGGER IF EXISTS manual_sections_search_update ON manual_sections;
CREATE TRIGGER manual_sections_search_update
    BEFORE INSERT OR UPDATE ON manual_sections
    FOR EACH ROW EXECUTE FUNCTION update_manual_search_vector();

-- 4. Create GIN index for fast full-text searching
CREATE INDEX IF NOT EXISTS idx_manual_sections_search
ON manual_sections USING GIN(search_vector);

-- 5. Update existing rows to populate search_vector
UPDATE manual_sections
SET search_vector =
    setweight(to_tsvector('english', coalesce(section_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_plain, '')), 'B')
WHERE search_vector IS NULL;

-- 6. Create the full-text search function
CREATE OR REPLACE FUNCTION search_manual_fulltext(
    p_manual_id uuid,
    p_query text,
    p_limit int DEFAULT 10
)
RETURNS TABLE(
    id uuid,
    section_title text,
    content_plain text,
    char_count int,
    rank real
)
LANGUAGE sql STABLE
AS $$
    SELECT
        ms.id,
        ms.section_title,
        ms.content_plain,
        ms.char_count,
        ts_rank(ms.search_vector, websearch_to_tsquery('english', p_query)) as rank
    FROM manual_sections ms
    WHERE ms.manual_id = p_manual_id
      AND ms.search_vector @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit;
$$;

-- 7. Grant access to the function
GRANT EXECUTE ON FUNCTION search_manual_fulltext TO anon, authenticated, service_role;
